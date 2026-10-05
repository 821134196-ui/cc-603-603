import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildGateLogHash } from '../common/hash.util';
import { GATE_EVENT } from '../common/status';
import { TripsService } from '../trips/trips.service';

// 刷卡事件发生时间早于系统收到时间超过该阈值，视为晚到日志，必须人工复核
const LATE_THRESHOLD_MS = 15 * 60 * 1000;

export interface RawGateLog {
  gateCode?: string;
  station?: string;
  cardId: string;
  eventType: 'ENTRY' | 'EXIT';
  eventTime: string;
}

export interface UploadLogsDto {
  batchNo?: string;
  logs: RawGateLog[];
}

export interface ReviewLogDto {
  approve: boolean;
  reviewNote?: string;
  reviewer?: string;
}

@Injectable()
export class LogsService {
  constructor(
    private readonly db: PrismaService,
    private readonly trips: TripsService,
  ) {}

  /**
   * 上传/模拟导入一批闸机日志。
   * 同一内容指纹的日志重复上传时命中 GateLog.logHash 唯一约束：
   * 只形成一次有效记录，不会重复参与行程，更不会产生重复退款。
   */
  async upload(faultId: string, dto: UploadLogsDto) {
    if (!Array.isArray(dto.logs) || dto.logs.length === 0)
      throw new BadRequestException('日志批次为空');

    const fault = await this.db.faultReport.findUnique({
      where: { id: faultId },
      include: { gate: true },
    });
    if (!fault) throw new NotFoundException('故障工单不存在');

    const receivedAt = new Date();
    const accepted: string[] = [];
    const duplicates: string[] = [];
    const latePending: string[] = [];

    for (const row of dto.logs) {
      if (!row.cardId?.trim()) throw new BadRequestException('日志缺少票卡号');
      const eventType =
        row.eventType === 'ENTRY' || row.eventType === 'EXIT'
          ? row.eventType
          : null;
      if (!eventType) throw new BadRequestException('eventType 必须为 ENTRY/EXIT');
      if (!row.eventTime || Number.isNaN(Date.parse(row.eventTime)))
        throw new BadRequestException('日志刷卡时间无效');

      const gateCode = (row.gateCode ?? fault.gate.code).trim();
      const station = (row.station ?? fault.station).trim();
      const eventTime = new Date(row.eventTime);
      const logHash = buildGateLogHash({ gateCode, cardId: row.cardId, eventType, eventTime });

      const existed = await this.db.gateLog.findUnique({
        where: { logHash },
        include: { entryOfTrip: true, exitOfTrip: true },
      });
      if (existed) {
        // 重复上传：不新建任何记录、不触发任何行程或退款
        duplicates.push(logHash.slice(0, 12));
        continue;
      }

      // 维修已结案后到达，或刷卡时刻与到达时刻相差过久 → 晚到，待复核
      const isLate =
        fault.status === 'REPAIR_CLOSED' ||
        receivedAt.getTime() - eventTime.getTime() > LATE_THRESHOLD_MS;

      try {
        const log = await this.db.gateLog.create({
          data: {
            logHash,
            gateCode,
            station,
            cardId: row.cardId.trim(),
            eventType,
            eventTime,
            receivedAt,
            source: 'SIMULATED_UPLOAD',
            batchNo: dto.batchNo ?? null,
            isLate,
            reviewed: false,
            faultReportId: fault.id,
          },
        });
        accepted.push(log.id);
        if (isLate) latePending.push(log.id);
      } catch (e) {
        // 并发重复上传时由数据库唯一约束兜底
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          duplicates.push(logHash.slice(0, 12));
        } else {
          throw e;
        }
      }
    }

    // 仅即时（非晚到）日志可直接参与行程配对；晚到日志须复核后处理
    await this.trips.reconcile(faultId);

    return {
      faultId,
      received: dto.logs.length,
      acceptedCount: accepted.length,
      duplicateCount: duplicates.length,
      duplicates,
      latePendingCount: latePending.length,
      latePending: latePending,
      note:
        duplicates.length > 0
          ? '检测到重复日志，已按一次有效记录处理，未重复生成行程'
          : undefined,
    };
  }

  async listForFault(faultId: string) {
    return this.db.gateLog.findMany({
      where: { faultReportId: faultId },
      orderBy: [{ eventTime: 'asc' }],
    });
  }

  /** 客服复核晚到日志：通过后才参与行程配对；驳回则永不处理 */
  async review(logId: string, dto: ReviewLogDto) {
    const log = await this.db.gateLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('日志不存在');
    if (!log.isLate)
      throw new BadRequestException('该日志不是晚到日志，无需复核');
    if (log.reviewed)
      throw new ConflictException('该日志已复核，不能重复复核');

    const updated = await this.db.gateLog.update({
      where: { id: logId },
      data: {
        reviewed: true,
        reviewNote: dto.approve
          ? `复核通过：${dto.reviewNote ?? ''}`.trim()
          : `复核驳回：${dto.reviewNote ?? ''}`.trim(),
      },
    });

    if (dto.approve && log.faultReportId) {
      await this.trips.reconcile(log.faultReportId);
    }
    return updated;
  }
}
