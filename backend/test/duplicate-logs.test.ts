/* 不变量：同一段故障日志重复上传只形成一次有效记录；一趟行程最多退款一次 */
import { ConflictException } from '@nestjs/common';
import {
  resetTestDb,
  createServices,
  seedGate,
  minutesFromNow,
} from './setup';
import { buildGateLogHash } from '../src/common/hash.util';
import { STATIONS } from '../src/common/fare.util';

describe('重复日志与重复退款', () => {
  it('相同日志重复上传不产生重复行程，且退款只能一次', async () => {
    resetTestDb();
    const { db, faults, logs, trips, simulator } = await createServices();
    const gate = await seedGate(db, 'T-GATE-01');

    // 站务员登记故障（发生时间 5 分钟前，保证模拟刷卡时间不被判为晚到）
    const fault = await faults.register({
      gateCode: gate.code,
      occurredAt: minutesFromNow(-5),
      description: '扇门无法打开',
      stationAgent: '站务A',
    });

    // 第一次模拟上传：CARD-1001 完整进出站，CARD-1002 只有进站
    const first = await simulator.simulate(fault.id, 'normal');
    expect(first.acceptedCount).toBe(3);
    expect(first.duplicateCount).toBe(0);

    const tripsAfterFirst = await trips.listForFault(fault.id);
    expect(tripsAfterFirst).toHaveLength(2);
    const card1001 = tripsAfterFirst.find((t) => t.cardId === 'CARD-1001')!;
    const card1002 = tripsAfterFirst.find((t) => t.cardId === 'CARD-1002')!;
    expect(card1001.entryLogId).toBeTruthy();
    expect(card1001.exitLogId).toBeTruthy();
    expect(card1001.correctFare).toBe(500); // 人民广场 → 世纪大道 3 站 5 元
    expect(card1002.exitLogId).toBeNull();

    // 同一段日志原样再传一次：全部识别为重复，不新增任何记录
    const second = await simulator.simulate(fault.id, 'duplicate');
    expect(second.received).toBe(3);
    expect(second.acceptedCount).toBe(0);
    expect(second.duplicateCount).toBe(3);

    // 行程数依旧为 2，没有出现两段相同行程
    const tripsAfterSecond = await trips.listForFault(fault.id);
    expect(tripsAfterSecond).toHaveLength(2);
    const logCount = await db.gateLog.count({ where: { faultReportId: fault.id } });
    expect(logCount).toBe(3);

    // 即便再触发一次对账，结果也不变
    await logs.upload(fault.id, {
      batchNo: 'manual-replay',
      logs: [
        {
          gateCode: gate.code,
          station: STATIONS[0],
          cardId: 'CARD-1001',
          eventType: 'ENTRY',
          eventTime: new Date(new Date(fault.occurredAt).getTime() + 2 * 60_000).toISOString(),
        },
      ],
    });
    expect(await db.trip.count({ where: { faultReportId: fault.id } })).toBe(2);

    // 补登 CARD-1001 并退差价（预收 6 元 - 应收 5 元 = 1 元）
    await trips.register(card1001.id, { operator: '客服甲' });
    const refund1 = await trips.refund(card1001.id, { operator: '客服甲' });
    expect(refund1.refund.amount).toBe(100);

    // 重复退款必须被拒绝
    await expect(
      trips.refund(card1001.id, { operator: '客服甲' }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 数据库层也只有一条退款记录
    expect(
      await db.refundRecord.count({ where: { tripId: card1001.id } }),
    ).toBe(1);
    expect(
      await db.paymentReceipt.findUniqueOrThrow({ where: { tripId: card1001.id } }),
    ).toMatchObject({ status: 'REFUNDED' });

    // 缺出站的 CARD-1002：客服人工补登出站后退款一次
    await trips.register(card1002.id, {
      operator: '客服乙',
      exitStation: STATIONS[3],
    });
    const refund2 = await trips.refund(card1002.id, { operator: '客服乙' });
    expect(refund2.refund.amount).toBe(100);
    await expect(
      trips.refund(card1002.id, { operator: '客服乙' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.refundRecord.count()).toBe(2);

    // 内容指纹稳定：同一负载任意重复计算均相同
    const h1 = buildGateLogHash({
      gateCode: gate.code,
      cardId: 'CARD-1001',
      eventType: 'ENTRY',
      eventTime: new Date(new Date(fault.occurredAt).getTime() + 2 * 60_000),
    });
    const h2 = buildGateLogHash({
      gateCode: gate.code,
      cardId: 'CARD-1001',
      eventType: 'ENTRY',
      eventTime: new Date(new Date(fault.occurredAt).getTime() + 2 * 60_000),
    });
    expect(h1).toBe(h2);

    await db.$disconnect();
  });
});
