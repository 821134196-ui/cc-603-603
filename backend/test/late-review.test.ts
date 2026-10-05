/* 不变量：故障期间晚到的刷卡记录必须客服复核后才参与行程处理 */
import { ConflictException, BadRequestException } from '@nestjs/common';
import { resetTestDb, createServices, seedGate, minutesFromNow } from './setup';

describe('晚到日志复核', () => {
  it('晚到日志复核前不入账，复核通过后才配对，驳回永不处理', async () => {
    resetTestDb();
    const { db, logs, faults, simulator, trips } = await createServices();
    const gate = await seedGate(db, 'T-GATE-04', '世纪大道');

    const fault = await faults.register({
      gateCode: gate.code,
      occurredAt: minutesFromNow(-5),
      description: '出站闸机屏幕黑屏',
      stationAgent: '站务D',
    });

    // CARD-9001 的出站刷卡时间远早于当前 → 晚到，待复核
    const lateUpload = await simulator.simulate(fault.id, 'late');
    expect(lateUpload.acceptedCount).toBe(1);
    expect(lateUpload.latePendingCount).toBe(1);

    // 复核前：没有任何行程生成
    expect(await trips.listForFault(fault.id)).toHaveLength(0);
    const [lateLog] = await logs.listForFault(fault.id);
    expect(lateLog.isLate).toBe(true);
    expect(lateLog.reviewed).toBe(false);

    // 再给一张卡的即时进站日志，形成一段缺出站的行程（晚到日志不参与）
    await logs.upload(fault.id, {
      logs: [
        {
          gateCode: gate.code,
          station: '人民广场',
          cardId: 'CARD-9001',
          eventType: 'ENTRY',
          eventTime: minutesFromNow(-1),
        },
      ],
    });
    let tripList = await trips.listForFault(fault.id);
    expect(tripList).toHaveLength(1);
    expect(tripList[0].exitLogId).toBeNull();

    // 重复复核被拒绝
    await logs.review(lateLog.id, {
      approve: true,
      reviewer: '客服甲',
      reviewNote: '与乘客陈述一致',
    });
    await expect(
      logs.review(lateLog.id, { approve: true }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 复核通过后重新对账：同一张卡的既有行程被补全，而非新增第二趟
    tripList = await trips.listForFault(fault.id);
    expect(tripList).toHaveLength(1);
    expect(tripList[0].exitLogId).toBe(lateLog.id);
    expect(tripList[0].correctFare).toBeGreaterThan(0);

    await db.$disconnect();
  });

  it('复核驳回的晚到日志永不参与行程', async () => {
    resetTestDb();
    const { db, logs, faults, simulator, trips } = await createServices();
    const gate = await seedGate(db, 'T-GATE-05', '静安寺');

    const fault = await faults.register({
      gateCode: gate.code,
      occurredAt: minutesFromNow(-5),
      description: '闸机扇门卡顿',
      stationAgent: '站务E',
    });

    const lateUpload = await simulator.simulate(fault.id, 'late');
    const lateLogId = lateUpload.latePending[0];
    await logs.review(lateLogId, {
      approve: false,
      reviewer: '客服乙',
      reviewNote: '卡号与申报不符',
    });

    // 驳回后再对账也无行程产生
    await trips.reconcile(fault.id);
    expect(await trips.listForFault(fault.id)).toHaveLength(0);
    const logRow = await db.gateLog.findUniqueOrThrow({ where: { id: lateLogId } });
    expect(logRow.reviewNote).toContain('复核驳回');

    await db.$disconnect();
  });
});
