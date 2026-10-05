import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from './prisma';
import { GateStatus, MAX_FARE, RepairStatus, STATIONS } from './domain';

// ---- 告警看板 ----
// 规则：闸机只要处于 FAULT（即维修工单未确认完成）就保留在告警看板上。
// 票务处理进度不影响看板；唯一的撤板途径是维修确认。

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async alerts() {
    const gates = await this.prisma.gate.findMany({
      where: { status: GateStatus.FAULT },
      include: {
        incidents: {
          where: { repairOrder: { status: { not: RepairStatus.RESOLVED } } },
          include: { repairOrder: true, ticketOrder: true },
          orderBy: { occurredAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { code: 'asc' },
    });
    return gates.map((g) => ({
      gate: { id: g.id, code: g.code, name: g.name, station: g.station, status: g.status },
      incident: g.incidents[0] ?? null,
    }));
  }
}

@Controller()
export class MetaController {
  constructor(private prisma: PrismaService, private dashboard: DashboardService) {}

  @Get('meta')
  async meta() {
    const gates = await this.prisma.gate.findMany({ orderBy: { code: 'asc' } });
    return { gates, stations: STATIONS, maxFare: MAX_FARE };
  }

  @Get('dashboard/alerts')
  alerts() {
    return this.dashboard.alerts();
  }
}

@Module({
  controllers: [MetaController],
  providers: [DashboardService, PrismaService],
})
export class DashboardModule {}
