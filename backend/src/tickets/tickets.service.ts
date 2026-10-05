import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TICKET_STATUS, TRIP_STATUS } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';

export interface CloseTicketDto {
  operator: string;
  closeNote?: string;
  // 是否允许在尚有缺失行程未处理时强制结案，默认不允许
  force?: boolean;
}

@Injectable()
export class TicketsService {
  constructor(private readonly db: PrismaService) {}

  list(status?: 'OPEN' | 'CLOSED') {
    return this.db.ticketCase.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        faultReport: { include: { gate: true } },
      },
    });
  }

  async detailByFault(faultId: string) {
    const ticket = await this.db.ticketCase.findUnique({
      where: { faultReportId: faultId },
      include: {
        faultReport: {
          include: {
            gate: true,
            trips: { include: { receipt: true, refund: true } },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException('票务工单不存在');
    return ticket;
  }

  /**
   * 客服结案票务工单 —— 只关闭 TicketCase：
   * 不修改 FaultReport 状态、不修改闸机状态，未恢复的闸机继续留在告警看板。
   */
  async close(id: string, dto: CloseTicketDto) {
    if (!dto.operator?.trim()) throw new BadRequestException('客服工号必填');
    const ticket = await this.db.ticketCase.findUnique({
      where: { id },
      include: { faultReport: { include: { trips: true } } },
    });
    if (!ticket) throw new NotFoundException('票务工单不存在');
    if (ticket.status === TICKET_STATUS.CLOSED)
      throw new ConflictException('票务工单已结案，不能重复结案');

    const pendingTrips = ticket.faultReport.trips.filter(
      (t) => t.status === TRIP_STATUS.MISSING,
    );
    if (pendingTrips.length > 0 && !dto.force)
      throw new ConflictException(
        `尚有 ${pendingTrips.length} 段缺失行程未补登核对，不能结案（确认无乘客主张可强制结案）`,
      );

    return this.db.ticketCase.update({
      where: { id },
      data: {
        status: TICKET_STATUS.CLOSED,
        closedBy: dto.operator.trim(),
        closedAt: new Date(),
        closeNote: dto.closeNote?.trim() || null,
      },
      include: { faultReport: { include: { gate: true } } },
    });
  }
}
