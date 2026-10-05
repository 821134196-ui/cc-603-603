import { Injectable } from '@nestjs/common';
import { FAULT_STATUS, TICKET_STATUS, TRIP_STATUS } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly db: PrismaService) {}

  /**
   * 设备异常看板：只要存在维修未确认完成（ALERT）的故障，闸机就持续告警。
   * 票务工单是否结案对看板没有任何影响。
   */
  async overview() {
    const gates = await this.db.gate.findMany({
      orderBy: [{ status: 'desc' }, { code: 'asc' }],
      include: {
        faultReports: {
          where: { status: FAULT_STATUS.ALERT },
          orderBy: { occurredAt: 'desc' },
          include: { ticketCase: true },
        },
      },
    });

    const alertGates = gates.filter((g) => g.faultReports.length > 0);
    const openTickets = await this.db.ticketCase.count({
      where: { status: TICKET_STATUS.OPEN },
    });
    const pendingRefunds = await this.db.trip.count({
      where: {
        status: { in: [TRIP_STATUS.REGISTERED, TRIP_STATUS.MISSING] },
        receipt: { isNot: null },
      },
    });
    const alertCount = alertGates.length;

    return {
      alertCount,
      openTicketCount: openTickets,
      pendingRefundCount: pendingRefunds,
      alertGates: alertGates.map((g) => ({
        gateId: g.id,
        gateCode: g.code,
        gateName: g.name,
        station: g.station,
        status: g.status,
        activeFaults: g.faultReports.map((f) => ({
          faultId: f.id,
          occurredAt: f.occurredAt,
          description: f.description,
          stationAgent: f.stationAgent,
          // 即便票务工单已结案，只要维修未结案，告警依旧保留
          ticketStatus: f.ticketCase?.status ?? null,
        })),
      })),
    };
  }
}
