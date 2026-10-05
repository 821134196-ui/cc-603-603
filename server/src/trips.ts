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
  Query,
} from '@nestjs/common';
import { PrismaService } from './prisma';
import { fareBetween, TicketStatus, TripStatus } from './domain';

// ---- 票务处理：复核 -> 补登 -> 退差价 / 退款 ----
// 不变式：一趟行程最多退款一次（Refund.tripId 唯一 + 服务层预检 + P2002 兜底）。

@Injectable()
export class TripsService {
  constructor(private prisma: PrismaService) {}

  list(query: { incidentId?: string; status?: string }) {
    return this.prisma.tripRecord.findMany({
      where: {
        ...(query.incidentId ? { incidentId: query.incidentId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { entryTime: 'desc' },
      include: { gate: { select: { code: true, name: true, station: true } }, refund: true },
      take: 200,
    });
  }

  refunds() {
    return this.prisma.refund.findMany({
      orderBy: { createdAt: 'desc' },
      include: { trip: { select: { cardId: true, entryStation: true, entryTime: true } } },
    });
  }

  receipts() {
    return this.prisma.paymentReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  private async touchTicketOrder(tx: any, incidentId: string | null) {
    // 客服一开始处理行程，票务工单自动进入 PROCESSING（不影响维修工单）
    if (!incidentId) return;
    await tx.ticketOrder.updateMany({
      where: { incidentId, status: TicketStatus.PENDING },
      data: { status: TicketStatus.PROCESSING },
    });
  }

  // 客服复核晚到记录：NEEDS_REVIEW -> MISSING_EXIT（缺出站）或 NORMAL（行程完整）
  async review(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.tripRecord.findUnique({ where: { id } });
      if (!trip) throw new NotFoundException('行程不存在');
      if (trip.status !== TripStatus.NEEDS_REVIEW) {
        throw new ConflictException(`当前状态为 ${trip.status}，无需复核`);
      }
      const next = trip.exitStation ? TripStatus.NORMAL : TripStatus.MISSING_EXIT;
      const updated = await tx.tripRecord.update({ where: { id }, data: { status: next } });
      await this.touchTicketOrder(tx, trip.incidentId);
      return updated;
    });
  }

  // 客服补登出站：核算应收票价，多扣则自动退还差价（一趟行程只会退一次）
  async complete(id: string, dto: { exitStation: string; exitTime: string }) {
    if (!dto?.exitStation || !dto?.exitTime) throw new BadRequestException('exitStation 与 exitTime 必填');
    const exitTime = new Date(dto.exitTime);
    if (isNaN(exitTime.getTime())) throw new BadRequestException('exitTime 时间格式无效');

    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.tripRecord.findUnique({ where: { id }, include: { refund: true } });
      if (!trip) throw new NotFoundException('行程不存在');
      if (trip.status === TripStatus.NEEDS_REVIEW) throw new ConflictException('晚到记录须先复核再补登');
      if (trip.status !== TripStatus.MISSING_EXIT) throw new ConflictException(`当前状态为 ${trip.status}，不能补登`);

      const correctFare = fareBetween(trip.entryStation, dto.exitStation);
      let refund = null;
      let status: string = TripStatus.COMPLETED;
      if (trip.chargedFare > correctFare && !trip.refund) {
        // 退还差价：Refund.tripId 唯一，重复补登/重复退款都会被拦截
        refund = await tx.refund.create({
          data: {
            tripId: trip.id,
            amount: trip.chargedFare - correctFare,
            reason: '闸机故障补登，退还差价',
            receiptNo: `REF-${trip.id}`,
          },
        });
        await tx.paymentReceipt.create({
          data: { receiptNo: `REF-${trip.id}`, cardId: trip.cardId, amount: refund.amount, kind: 'REFUND' },
        });
        status = TripStatus.REFUNDED;
      }
      const updated = await tx.tripRecord.update({
        where: { id },
        data: { exitStation: dto.exitStation, exitTime, correctFare, status },
        include: { refund: true },
      });
      await this.touchTicketOrder(tx, trip.incidentId);
      return { trip: updated, refund };
    });
  }

  // 人工退款（未补登也可退）。一趟行程最多退款一次。
  async refund(id: string, dto: { amount: number; reason?: string }) {
    const amount = Math.round(dto?.amount);
    if (!amount || amount <= 0) throw new BadRequestException('退款金额必须为正数（分）');

    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.tripRecord.findUnique({ where: { id }, include: { refund: true } });
      if (!trip) throw new NotFoundException('行程不存在');
      if (trip.refund) throw new ConflictException('该行程已退款，一趟行程最多退款一次');
      if (amount > trip.chargedFare) throw new BadRequestException('退款金额不能超过已扣费金额');
      try {
        const refund = await tx.refund.create({
          data: {
            tripId: trip.id,
            amount,
            reason: dto.reason ?? '人工退款',
            receiptNo: `REF-${trip.id}`,
          },
        });
        await tx.paymentReceipt.create({
          data: { receiptNo: `REF-${trip.id}`, cardId: trip.cardId, amount, kind: 'REFUND' },
        });
        await tx.tripRecord.update({ where: { id }, data: { status: TripStatus.REFUNDED } });
        await this.touchTicketOrder(tx, trip.incidentId);
        return refund;
      } catch (e: any) {
        // 唯一约束兜底（并发双击等）
        if (e?.code === 'P2002') throw new ConflictException('该行程已退款，一趟行程最多退款一次');
        throw e;
      }
    });
  }
}

@Controller()
export class TripsController {
  constructor(private svc: TripsService) {}

  @Get('trips')
  list(@Query() query: any) {
    return this.svc.list(query);
  }

  @Post('trips/:id/review')
  review(@Param('id') id: string) {
    return this.svc.review(id);
  }

  @Post('trips/:id/complete')
  complete(@Param('id') id: string, @Body() dto: any) {
    return this.svc.complete(id, dto);
  }

  @Post('trips/:id/refund')
  refund(@Param('id') id: string, @Body() dto: any) {
    return this.svc.refund(id, dto);
  }

  @Get('refunds')
  refunds() {
    return this.svc.refunds();
  }

  @Get('receipts')
  receipts() {
    return this.svc.receipts();
  }
}

@Module({
  controllers: [TripsController],
  providers: [TripsService, PrismaService],
})
export class TripsModule {}
