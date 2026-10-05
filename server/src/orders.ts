import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Body, Controller, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from './prisma';
import { BLOCKING_TRIP_STATUSES, GateStatus, RepairStatus, TicketStatus } from './domain';

// ---- 两类工单的生命周期 ----
// 关键约束：维修工单与票务工单各自独立结案。
//  - 维修确认（RESOLVED）只恢复闸机、撤下告警，绝不触碰票务工单；
//  - 票务结案（CLOSED）只关闭票务工单，绝不让未修复闸机从告警看板消失。

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async repairStart(id: string, dto: { assignee?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.repairOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('维修工单不存在');
      if (order.status !== RepairStatus.PENDING) throw new ConflictException(`工单状态为 ${order.status}，不能开始维修`);
      return tx.repairOrder.update({
        where: { id },
        data: { status: RepairStatus.IN_PROGRESS, assignee: dto?.assignee ?? '', startedAt: new Date() },
      });
    });
  }

  // 维修确认完成：仅推进维修工单 + 恢复闸机。票务工单保持原状。
  async repairResolve(id: string, dto: { note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.repairOrder.findUnique({ where: { id }, include: { incident: true } });
      if (!order) throw new NotFoundException('维修工单不存在');
      if (order.status === RepairStatus.RESOLVED) throw new ConflictException('维修工单已确认完成，不能重复操作');
      const updated = await tx.repairOrder.update({
        where: { id },
        data: { status: RepairStatus.RESOLVED, resolvedAt: new Date(), note: dto?.note ?? '' },
      });
      // 设备恢复 -> 闸机从告警看板撤下（这是唯一的撤板途径）
      await tx.gate.update({ where: { id: order.incident.gateId }, data: { status: GateStatus.NORMAL } });
      return updated;
    });
  }

  // 票务结案：仅关闭票务工单。闸机告警、维修工单均不受影响。
  async ticketClose(id: string, dto: { handler?: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.ticketOrder.findUnique({ where: { id }, include: { incident: true } });
      if (!order) throw new NotFoundException('票务工单不存在');
      if (order.status === TicketStatus.CLOSED) throw new ConflictException('票务工单已结案，不能重复结案');

      const blockingCount = await tx.tripRecord.count({
        where: { incidentId: order.incidentId, status: { in: [...BLOCKING_TRIP_STATUSES] } },
      });
      if (blockingCount > 0) {
        const breakdown = await tx.tripRecord.groupBy({
          by: ['status'],
          where: { incidentId: order.incidentId, status: { in: [...BLOCKING_TRIP_STATUSES] } },
          _count: { _all: true },
        });
        const detail = breakdown.map((b) => `${b.status}×${b._count._all}`).join('，');
        throw new ConflictException(`仍有未处理行程（${detail}），须复核/补登完成后才能结案`);
      }
      return tx.ticketOrder.update({
        where: { id },
        data: { status: TicketStatus.CLOSED, closedAt: new Date(), handler: dto?.handler ?? '', note: dto?.note ?? '' },
      });
    });
  }
}

@Controller('repair-orders')
export class RepairOrdersController {
  constructor(private svc: OrdersService) {}

  @Post(':id/start')
  start(@Param('id') id: string, @Body() dto: any) {
    return this.svc.repairStart(id, dto);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() dto: any) {
    return this.svc.repairResolve(id, dto);
  }
}

@Controller('ticket-orders')
export class TicketOrdersController {
  constructor(private svc: OrdersService) {}

  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: any) {
    return this.svc.ticketClose(id, dto);
  }
}

@Module({
  controllers: [RepairOrdersController, TicketOrdersController],
  providers: [OrdersService, PrismaService],
})
export class OrdersModule {}
