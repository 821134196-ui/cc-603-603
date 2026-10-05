import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_FARE, calcFare } from '../common/fare.util';
import { GATE_EVENT, TRIP_STATUS } from '../common/status';

export interface RegisterTripDto {
  operator: string; // 客服
  entryStation?: string; // 进站记录缺失时人工补登
  exitStation?: string; // 出站记录缺失时人工补登
  note?: string;
}

export interface RefundDto {
  operator: string;
  reason?: string;
}

const tripInclude = {
  receipt: true,
  refund: true,
  entryLog: true,
  exitLog: true,
  faultReport: { include: { gate: true, ticketCase: true } },
};

@Injectable()
export class TripsService {
  constructor(private readonly db: PrismaService) {}

  /** 日志是否已获准参与行程处理：即时日志直接可用；晚到日志必须复核通过 */
  private isEligible(log: { isLate: boolean; reviewed: boolean; reviewNote: string | null }) {
    if (!log.isLate) return true;
    return log.reviewed === true && (log.reviewNote ?? '').startsWith('复核通过');
  }

  /**
   * 依据已生效日志重建行程：
   * - 同一故障下同一张卡最多一段行程（@@unique([faultReportId, cardId]) 兜底）
   * - 重复日志在入库阶段已被 logHash 拦截，这里看到的每个事件天然只有一条
   * - 只填补缺失的进/出站关联；已补登或已退款的行程不再被自动改动
   */
  async reconcile(faultId: string) {
    const logs = await this.db.gateLog.findMany({
      where: { faultReportId: faultId },
      orderBy: { eventTime: 'asc' },
    });
    const eligible = logs.filter((l) => this.isEligible(l));

    const byCard = new Map<string, typeof eligible>();
    for (const log of eligible) {
      const list = byCard.get(log.cardId) ?? [];
      list.push(log);
      byCard.set(log.cardId, list);
    }

    const results: string[] = [];
    for (const [cardId, cardLogs] of byCard) {
      const entry = cardLogs.find((l) => l.eventType === GATE_EVENT.ENTRY);
      const exit = cardLogs.find((l) => l.eventType === GATE_EVENT.EXIT);

      const existing = await this.db.trip.findUnique({
        where: { faultReportId_cardId: { faultReportId: faultId, cardId } },
      });

      if (!existing) {
        try {
          const trip = await this.db.trip.create({
            data: {
              faultReportId: faultId,
              cardId,
              status: TRIP_STATUS.MISSING,
              entryLogId: entry?.id ?? null,
              exitLogId: exit?.id ?? null,
              entryStation: entry?.station ?? null,
              exitStation: exit?.station ?? null,
              correctFare: entry && exit ? calcFare(entry.station, exit.station) : 0,
            },
          });
          results.push(trip.id);
        } catch (e) {
          // 并发下唯一约束兜底：同卡同故障不可能出现两段行程
          if (
            !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          )
            throw e;
        }
        continue;
      }

      // 已结案（已补登/已退款）的行程不自动改写，防止晚到日志冲掉客服结论
      if (existing.status !== TRIP_STATUS.MISSING) continue;

      await this.db.trip.update({
        where: { id: existing.id },
        data: {
          entryLogId: existing.entryLogId ?? entry?.id ?? null,
          exitLogId: existing.exitLogId ?? exit?.id ?? null,
          entryStation: existing.entryStation ?? entry?.station ?? null,
          exitStation: existing.exitStation ?? exit?.station ?? null,
          correctFare:
            existing.correctFare > 0
              ? existing.correctFare
              : entry && exit
                ? calcFare(entry.station, exit.station)
                : 0,
        },
      });
      results.push(existing.id);
    }
    return results;
  }

  async listForFault(faultId: string) {
    return this.db.trip.findMany({
      where: { faultReportId: faultId },
      include: { receipt: true, refund: true, entryLog: true, exitLog: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const trip = await this.db.trip.findUnique({ where: { id }, include: tripInclude });
    if (!trip) throw new NotFoundException('行程不存在');
    return trip;
  }

  /**
   * 客服核对乘客行程后补登：
   * 进/出站记录缺失的一侧由人工填写站点；补登时生成本地模拟支付回执
   * （故障期间 AFC 已按最高票价预收）。
   */
  async register(tripId: string, dto: RegisterTripDto) {
    if (!dto.operator?.trim()) throw new BadRequestException('客服工号必填');
    const trip = await this.get(tripId);
    if (trip.status !== TRIP_STATUS.MISSING)
      throw new ConflictException('该行程已补登，不能重复补登');

    const entryStation = trip.entryStation ?? dto.entryStation?.trim() ?? null;
    const exitStation = trip.exitStation ?? dto.exitStation?.trim() ?? null;
    if (!entryStation || !exitStation)
      throw new BadRequestException(
        '进、出站站点均须确定（缺记录的一侧请人工补登站点）后才能补登',
      );

    const correctFare = calcFare(entryStation, exitStation);

    return this.db.$transaction(async (tx) => {
      const registered = await tx.trip.update({
        where: { id: tripId },
        data: {
          status: TRIP_STATUS.REGISTERED,
          entryStation,
          exitStation,
          manualExitNote:
            !trip.exitLog && dto.exitStation
              ? `客服人工补登出站：${dto.exitStation}${dto.note ? `（${dto.note}）` : ''}`
              : dto.note?.trim() || null,
          correctFare,
          registeredAt: new Date(),
          registeredBy: dto.operator.trim(),
        },
      });

      // 本地模拟支付回执：故障期间按全网最高票价预收
      const receipt = await tx.paymentReceipt.upsert({
        where: { tripId },
        update: {},
        create: {
          receiptNo: `RCP-${trip.cardId}-${trip.id.slice(-6)}`,
          tripId,
          amountCharged: MAX_FARE,
          correctAmount: correctFare,
        },
      });

      return { ...registered, receipt };
    });
  }

  /**
   * 退还差价。一趟行程最多退款一次 —— RefundRecord.tripId 唯一约束硬保证，
   * 重复请求（包括重复日志触发的重放）只会得到 409。
   */
  async refund(tripId: string, dto: RefundDto) {
    if (!dto.operator?.trim()) throw new BadRequestException('客服工号必填');
    const trip = await this.get(tripId);
    if (trip.status === TRIP_STATUS.MISSING)
      throw new BadRequestException('行程尚未补登核对，不能退款');
    if (trip.status === TRIP_STATUS.REFUNDED || trip.refund)
      throw new ConflictException('该趟行程已退款，一趟行程最多退款一次');

    const receipt = trip.receipt;
    if (!receipt) throw new BadRequestException('缺少支付回执，无法退款');
    const diff = receipt.amountCharged - receipt.correctAmount;
    if (diff <= 0)
      throw new BadRequestException('实收不高于应收，无差价可退');

    try {
      return await this.db.$transaction(async (tx) => {
        const refund = await tx.refundRecord.create({
          data: {
            tripId,
            receiptId: receipt.id,
            amount: diff,
            reason: dto.reason?.trim() || '闸机故障按最高票价预收，核对后退差价',
            operator: dto.operator.trim(),
          },
        });
        await tx.paymentReceipt.update({
          where: { id: receipt.id },
          data: { status: 'REFUNDED' },
        });
        const updated = await tx.trip.update({
          where: { id: tripId },
          data: { status: TRIP_STATUS.REFUNDED },
          include: tripInclude,
        });
        return { refund, trip: updated };
      });
    } catch (e) {
      // 并发重复退款由数据库唯一约束兜底
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('该趟行程已退款，一趟行程最多退款一次');
      throw e;
    }
  }
}
