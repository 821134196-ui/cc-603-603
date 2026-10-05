import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { PrismaService } from './prisma';
import { GateStatus, RepairStatus, TripStatus } from './domain';

// ---- 故障登记与受理查询 ----
// 站务员登记故障：同事务创建 维修工单 + 票务工单，闸机进入 FAULT。
// 受理页数据：一个故障并列携带两类工单进度。

function tripStats(trips: any[]) {
  return {
    total: trips.length,
    needsReview: trips.filter((t) => t.status === TripStatus.NEEDS_REVIEW).length,
    missingExit: trips.filter((t) => t.status === TripStatus.MISSING_EXIT).length,
    handled: trips.filter((t) => [TripStatus.COMPLETED, TripStatus.REFUNDED].includes(t.status)).length,
    refundedAmount: trips.reduce((s, t) => s + (t.refund?.amount ?? 0), 0),
  };
}

@Injectable()
export class IncidentsService {
  constructor(private prisma: PrismaService) {}

  async register(dto: { gateCode: string; occurredAt: string; description?: string; reportedBy: string }) {
    if (!dto.gateCode || !dto.occurredAt || !dto.reportedBy) {
      throw new BadRequestException('gateCode、occurredAt、reportedBy 均为必填');
    }
    const gate = await this.prisma.gate.findUnique({ where: { code: dto.gateCode } });
    if (!gate) throw new NotFoundException(`闸机 ${dto.gateCode} 不存在`);
    const occurredAt = new Date(dto.occurredAt);
    if (isNaN(occurredAt.getTime())) throw new BadRequestException('occurredAt 时间格式无效');

    // 同一闸机存在未修复故障时不允许重复登记
    const open = await this.prisma.incident.findFirst({
      where: { gateId: gate.id, OR: [{ repairOrder: null }, { repairOrder: { status: { not: RepairStatus.RESOLVED } } }] },
    });
    if (open) throw new ConflictException('该闸机存在尚未修复的故障，不能重复登记');

    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          gateId: gate.id,
          occurredAt,
          reportedBy: dto.reportedBy,
          description: dto.description ?? '',
          // 一次故障同时派生两类工单，后续各自独立流转、分别结案
          repairOrder: { create: {} },
          ticketOrder: { create: {} },
        },
        include: { repairOrder: true, ticketOrder: true, gate: true },
      });
      await tx.gate.update({ where: { id: gate.id }, data: { status: GateStatus.FAULT } });
      // 故障登记前已到达、落在故障时间窗内的行程归入本故障（它们不算晚到，状态不变）
      await tx.tripRecord.updateMany({
        where: { gateId: gate.id, incidentId: null, entryTime: { gte: occurredAt } },
        data: { incidentId: incident.id },
      });
      return incident;
    });
  }

  async list() {
    const incidents = await this.prisma.incident.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        gate: true,
        repairOrder: true,
        ticketOrder: true,
        trips: { include: { refund: true } },
      },
    });
    return incidents.map(({ trips, ...i }) => ({ ...i, tripStats: tripStats(trips) }));
  }

  async detail(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        gate: true,
        repairOrder: true,
        ticketOrder: true,
        trips: { include: { refund: true }, orderBy: { entryTime: 'asc' } },
      },
    });
    if (!incident) throw new NotFoundException('故障不存在');
    return { ...incident, tripStats: tripStats(incident.trips) };
  }
}

@Controller('incidents')
export class IncidentsController {
  constructor(private svc: IncidentsService) {}

  @Post()
  register(@Body() dto: any) {
    return this.svc.register(dto);
  }

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }
}

@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService, PrismaService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
