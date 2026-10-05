// 核心不变式的端到端验证：
//  1) 同一段故障日志重复上传 -> 只形成一次有效记录，不产生重复行程、不产生重复退款；
//  2) 一趟行程最多退款一次；
//  3) 故障期间晚到的刷卡记录须复核后才能处理；
//  4) 维修工单与票务工单独立结案：设备修好不自动关闭乘客问题，乘客问题处理完也不撤下未修复闸机的告警。
process.env.DATABASE_URL = 'file:./test.db';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'child_process';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma';

describe('闸机故障票务补登系统 · 核心不变式', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    execSync('npx prisma db push --force-reset --skip-generate', {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: 'file:./test.db' },
      stdio: 'inherit',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    for (const g of [
      { code: 'G01', name: '老街站 1 号闸机', station: '老街' },
      { code: 'G02', name: '大剧院站 1 号闸机', station: '大剧院' },
      { code: 'G03', name: '会展中心站 1 号闸机', station: '会展中心' },
      { code: 'G04', name: '车公庙站 1 号闸机', station: '车公庙' },
    ]) {
      await prisma.gate.create({ data: g });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- 场景 A：重复日志 -> 单次记录、单次退款（闸机 G01） ----------
  const occurredA = new Date(Date.now() - 3600_000).toISOString();
  const logA = {
    gateCode: 'G01',
    records: [
      { cardId: 'CARD-A1', entryTime: new Date(Date.now() - 1800_000).toISOString() },
      { cardId: 'CARD-A2', entryTime: new Date(Date.now() - 1500_000).toISOString() },
    ],
  };
  let incidentA: any;
  let tripA1: any;

  it('A0 站务员登记故障，同事务生成两类工单，闸机进入告警', async () => {
    const res = await api()
      .post('/api/incidents')
      .send({ gateCode: 'G01', occurredAt: occurredA, reportedBy: '站务员小王', description: '闸机读卡异常' })
      .expect(201);
    incidentA = res.body;
    expect(incidentA.repairOrder.status).toBe('PENDING');
    expect(incidentA.ticketOrder.status).toBe('PENDING');
    const alerts = await api().get('/api/dashboard/alerts').expect(200);
    expect(alerts.body.map((a: any) => a.gate.code)).toContain('G01');
  });

  it('A1 首次上传日志：形成有效记录，故障窗内晚到行程进入待复核', async () => {
    const res = await api().post('/api/logs/upload').send(logA).expect(201);
    expect(res.body.duplicated).toBe(false);
    expect(res.body.tripsCreated).toBe(2);
    expect(res.body.lateTrips).toBe(2);
    const trips = await prisma.tripRecord.findMany({ where: { cardId: { startsWith: 'CARD-A' } } });
    expect(trips).toHaveLength(2);
    expect(trips.every((t) => t.status === 'NEEDS_REVIEW' && t.late)).toBe(true);
  });

  it('A2 同一段日志重复上传：被幂等拦截，不产生任何新记录', async () => {
    const res = await api().post('/api/logs/upload').send(logA).expect(201);
    expect(res.body.duplicated).toBe(true);
    expect(res.body.tripsCreated).toBe(0);
    expect(await prisma.gateLog.count()).toBe(1);
    expect(await prisma.tripRecord.count()).toBe(2);
  });

  it('A3 内容有重叠的新日志：相同行程去重，只新增真正的新行程', async () => {
    const res = await api()
      .post('/api/logs/upload')
      .send({
        gateCode: 'G01',
        records: [...logA.records, { cardId: 'CARD-A3', entryTime: new Date(Date.now() - 1200_000).toISOString() }],
      })
      .expect(201);
    expect(res.body.duplicated).toBe(false);
    expect(res.body.tripsCreated).toBe(1);
    expect(res.body.duplicatesSkipped).toBe(2);
    expect(await prisma.tripRecord.count()).toBe(3);
  });

  it('A4 复核 + 补登退差价：一趟行程只产生一笔退款、一张退款回执', async () => {
    tripA1 = await prisma.tripRecord.findUniqueOrThrow({
      where: { dedupeKey: `CARD-A1|老街|${logA.records[0].entryTime}` },
    });
    await api().post(`/api/trips/${tripA1.id}/review`).expect(201);
    const done = await api()
      .post(`/api/trips/${tripA1.id}/complete`)
      .send({ exitStation: '车公庙', exitTime: new Date(Date.now() - 1500_000).toISOString() })
      .expect(201);
    // 老街->车公庙 8 站，应收 4 元；故障按最高价扣 15 元，退差价 11 元
    expect(done.body.trip.status).toBe('REFUNDED');
    expect(done.body.refund.amount).toBe(1100);
    expect(await prisma.refund.count({ where: { tripId: tripA1.id } })).toBe(1);
    expect(await prisma.paymentReceipt.count({ where: { kind: 'REFUND' } })).toBe(1);
  });

  it('A5 同一行程再次退款被拒绝（一趟行程最多退款一次）', async () => {
    const res = await api().post(`/api/trips/${tripA1.id}/refund`).send({ amount: 100 }).expect(409);
    expect(res.body.message).toContain('最多退款一次');
    expect(await prisma.refund.count({ where: { tripId: tripA1.id } })).toBe(1);
    expect(await prisma.paymentReceipt.count({ where: { kind: 'REFUND' } })).toBe(1);
  });

  it('A6 再次重复上传同一日志：行程数与退款数均不变', async () => {
    await api().post('/api/logs/upload').send(logA).expect(201);
    expect(await prisma.tripRecord.count()).toBe(3);
    expect(await prisma.refund.count()).toBe(1);
  });

  // ---------- 场景 B：两类工单关闭互不影响（闸机 G02 / G03） ----------
  let incidentB: any;

  it('B1 票务工单结案不会撤下告警、不动维修工单', async () => {
    incidentB = (
      await api()
        .post('/api/incidents')
        .send({ gateCode: 'G02', occurredAt: new Date().toISOString(), reportedBy: '站务员小李' })
        .expect(201)
    ).body;
    // 无待处理行程，票务工单可直接结案
    await api().post(`/api/ticket-orders/${incidentB.ticketOrder.id}/close`).send({ handler: '客服小周' }).expect(201);
    const detail = await api().get(`/api/incidents/${incidentB.id}`).expect(200);
    expect(detail.body.ticketOrder.status).toBe('CLOSED');
    expect(detail.body.repairOrder.status).toBe('PENDING'); // 维修工单不受票务结案影响
    const alerts = await api().get('/api/dashboard/alerts').expect(200);
    expect(alerts.body.map((a: any) => a.gate.code)).toContain('G02'); // 闸机仍在告警看板
  });

  it('B2 维修确认后票务工单保持原状（不被自动关闭）', async () => {
    await api().post(`/api/repair-orders/${incidentB.repairOrder.id}/resolve`).send({ note: '更换读卡器' }).expect(201);
    const detail = await api().get(`/api/incidents/${incidentB.id}`).expect(200);
    expect(detail.body.repairOrder.status).toBe('RESOLVED');
    expect(detail.body.ticketOrder.status).toBe('CLOSED'); // 仅保持，不被维修动作改变
    const alerts = await api().get('/api/dashboard/alerts').expect(200);
    expect(alerts.body.map((a: any) => a.gate.code)).not.toContain('G02'); // 维修确认后撤板
  });

  it('B3 设备修好不能自动关闭乘客问题：未处理行程仍挡住票务结案', async () => {
    const inc = (
      await api()
        .post('/api/incidents')
        .send({ gateCode: 'G03', occurredAt: new Date(Date.now() - 1800_000).toISOString(), reportedBy: '站务员小王' })
        .expect(201)
    ).body;
    await api()
      .post('/api/logs/upload')
      .send({ gateCode: 'G03', records: [{ cardId: 'CARD-B1', entryTime: new Date(Date.now() - 900_000).toISOString() }] })
      .expect(201);
    // 维修先行确认 -> 闸机恢复，但票务工单与待复核行程原样保留
    await api().post(`/api/repair-orders/${inc.repairOrder.id}/resolve`).expect(201);
    const detail = await api().get(`/api/incidents/${inc.id}`).expect(200);
    expect(detail.body.repairOrder.status).toBe('RESOLVED');
    expect(detail.body.ticketOrder.status).not.toBe('CLOSED');
    expect(detail.body.tripStats.needsReview).toBe(1);
    const close = await api().post(`/api/ticket-orders/${inc.ticketOrder.id}/close`).expect(409);
    expect(close.body.message).toContain('NEEDS_REVIEW');
  });

  // ---------- 场景 C：晚到记录须复核；乘客问题处理完不撤告警（闸机 G04） ----------
  let incidentC: any;
  let tripC: any;

  it('C1 故障期间晚到的刷卡记录须先复核才能补登', async () => {
    incidentC = (
      await api()
        .post('/api/incidents')
        .send({ gateCode: 'G04', occurredAt: new Date(Date.now() - 1800_000).toISOString(), reportedBy: '站务员小李' })
        .expect(201)
    ).body;
    await api()
      .post('/api/logs/upload')
      .send({ gateCode: 'G04', records: [{ cardId: 'CARD-C1', entryTime: new Date(Date.now() - 600_000).toISOString() }] })
      .expect(201);
    tripC = await prisma.tripRecord.findFirstOrThrow({ where: { cardId: 'CARD-C1' } });
    expect(tripC.status).toBe('NEEDS_REVIEW');
    // 未复核直接补登 -> 拒绝
    const res = await api()
      .post(`/api/trips/${tripC.id}/complete`)
      .send({ exitStation: '老街', exitTime: new Date().toISOString() })
      .expect(409);
    expect(res.body.message).toContain('先复核');
    // 票务工单也被待复核行程挡住
    await api().post(`/api/ticket-orders/${incidentC.ticketOrder.id}/close`).expect(409);
  });

  it('C2 复核 -> 补登退差价 -> 票务结案；但未修复的闸机仍在告警看板', async () => {
    await api().post(`/api/trips/${tripC.id}/review`).expect(201);
    const done = await api()
      .post(`/api/trips/${tripC.id}/complete`)
      .send({ exitStation: '老街', exitTime: new Date().toISOString() })
      .expect(201);
    expect(done.body.trip.status).toBe('REFUNDED');
    await api().post(`/api/ticket-orders/${incidentC.ticketOrder.id}/close`).send({ handler: '客服小周' }).expect(201);
    const detail = await api().get(`/api/incidents/${incidentC.id}`).expect(200);
    expect(detail.body.ticketOrder.status).toBe('CLOSED');
    expect(detail.body.repairOrder.status).toBe('PENDING'); // 维修仍未动
    const alerts = await api().get('/api/dashboard/alerts').expect(200);
    expect(alerts.body.map((a: any) => a.gate.code)).toContain('G04'); // 乘客问题处理完，告警不撤
  });
});
