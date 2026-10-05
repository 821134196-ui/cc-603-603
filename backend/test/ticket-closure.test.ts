/* 不变量：维修结案不代替票务结案；票务结案不移除设备告警看板提示 */
import { ConflictException } from '@nestjs/common';
import { resetTestDb, createServices, seedGate, minutesFromNow } from './setup';

describe('双工单独立结案与告警看板', () => {
  it('维修结案不影响票务工单，票务结案也不撤下告警', async () => {
    resetTestDb();
    const { db, faults, tickets, simulator, trips, dashboard } =
      await createServices();
    const gate = await seedGate(db, 'T-GATE-02', '陆家嘴');

    const fault = await faults.register({
      gateCode: gate.code,
      occurredAt: minutesFromNow(-5),
      description: '读卡器无响应',
      stationAgent: '站务B',
    });
    const ticket = fault.ticketCase!;
    expect(ticket.status).toBe('OPEN');
    expect(fault.status).toBe('ALERT');

    // 看板：有 1 个告警闸机
    let ov = await dashboard.overview();
    expect(ov.alertCount).toBe(1);
    expect(ov.alertGates[0].gateCode).toBe(gate.code);

    // 先上传日志并处理票务工单（补登退款），随后只结案票务工单
    await simulator.simulate(fault.id, 'normal');
    const tripList = await trips.listForFault(fault.id);
    for (const t of tripList) {
      await trips.register(t.id, { operator: '客服甲', exitStation: '世纪大道' });
      await trips.refund(t.id, { operator: '客服甲' });
    }

    const closedTicket = await tickets.close(ticket.id, {
      operator: '客服甲',
      closeNote: '乘客差价已退',
    });
    expect(closedTicket.status).toBe('CLOSED');

    // 票务工单结案后：维修工单仍为 ALERT，闸机仍在看板上
    const faultAfterTicketClose = await faults.detail(fault.id);
    expect(faultAfterTicketClose.status).toBe('ALERT');
    expect(faultAfterTicketClose.ticketCase!.status).toBe('CLOSED');
    ov = await dashboard.overview();
    expect(ov.alertCount).toBe(1);

    // 重复结案票务工单被拒绝
    await expect(
      tickets.close(ticket.id, { operator: '客服甲' }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 再做维修结案：只关维修工单，票务工单保持 CLOSED 不动
    const closedFault = await faults.repairClose(fault.id, {
      repairedBy: '维修员赵',
      repairNote: '更换读卡器主板',
    });
    expect(closedFault.status).toBe('REPAIR_CLOSED');
    expect(closedFault.ticketCase!.status).toBe('CLOSED');

    // 维修结案后闸机恢复正常、看板告警消失
    const gateRow = await db.gate.findUniqueOrThrow({ where: { code: gate.code } });
    expect(gateRow.status).toBe('NORMAL');
    ov = await dashboard.overview();
    expect(ov.alertCount).toBe(0);

    // 重复维修结案被拒绝
    await expect(
      faults.repairClose(fault.id, { repairedBy: '维修员赵' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await db.$disconnect();
  });

  it('维修已结案但票务未结案时，看板提示与票务工单互不代替', async () => {
    resetTestDb();
    const { db, faults, tickets, simulator, dashboard } = await createServices();
    const gate = await seedGate(db, 'T-GATE-03', '徐家汇');

    const fault = await faults.register({
      gateCode: gate.code,
      occurredAt: minutesFromNow(-5),
      description: '闸门常开',
      stationAgent: '站务C',
    });
    await simulator.simulate(fault.id, 'normal');

    // 只做维修结案（票务工单仍有缺失行程，维修侧不受影响地关闭）
    await faults.repairClose(fault.id, { repairedBy: '维修员钱' });
    let ov = await dashboard.overview();
    expect(ov.alertCount).toBe(0); // 看板按维修状态消失

    // 票务工单仍处于 OPEN —— 维修结案没有代替它
    const ticket = await tickets.detailByFault(fault.id);
    expect(ticket.status).toBe('OPEN');
    const openTickets = await tickets.list('OPEN');
    expect(openTickets.some((t) => t.id === ticket.id)).toBe(true);

    // 反过来：结案票务时存在未处理行程默认被阻止（两类结案规则各自独立）
    await expect(
      tickets.close(ticket.id, { operator: '客服甲' }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 强制结案票务工单也不会让闸机重新告警
    await tickets.close(ticket.id, { operator: '客服甲', force: true });
    ov = await dashboard.overview();
    expect(ov.alertCount).toBe(0);

    await db.$disconnect();
  });
});
