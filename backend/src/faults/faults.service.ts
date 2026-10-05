import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FAULT_STATUS as FaultStatusEnum } from '../common/status';
const FaultStatus = FaultStatusEnum;

export interface RegisterFaultDto {
  gateCode: string;
  occurredAt: string; // ISO 时间
  description: string;
  stationAgent: string;
}

export interface RepairCloseDto {
  repairNote?: string;
  repairedBy: string;
}

const faultInclude = {
  gate: true,
  ticketCase: true,
  logs: { orderBy: { eventTime: 'asc' as Prisma.SortOrder } },
  trips: {
    include: {
      receipt: true,
      refund: true,
      entryLog: true,
      exitLog: true,
    },
    orderBy: { createdAt: 'asc' as Prisma.SortOrder },
  },
};

@Injectable()
export class FaultsService {
  constructor(private readonly db: PrismaService) {}

  /** 站务员登记故障设备与发生时间：同时生成维修工单与票务工单（两者随后独立跟进） */
  async register(dto: RegisterFaultDto) {
    if (!dto.gateCode?.trim()) throw new BadRequestException('闸机编号必填');
    if (!dto.occurredAt || Number.isNaN(Date.parse(dto.occurredAt)))
      throw new BadRequestException('故障发生时间无效');
    if (!dto.description?.trim()) throw new BadRequestException('故障描述必填');
    if (!dto.stationAgent?.trim()) throw new BadRequestException('登记人必填');

    const gate = await this.db.gate.findUnique({
      where: { code: dto.gateCode.trim() },
      include: { faultReports: { where: { status: 'ALERT' } } },
    });
    if (!gate) throw new NotFoundException(`闸机 ${dto.gateCode} 不存在`);
    if (gate.faultReports.length > 0)
      throw new BadRequestException(
        `闸机 ${gate.code} 已有告警中的故障（${gate.faultReports[0].id}），请先完成维修`,
      );

    return this.db.$transaction(async (tx) => {
      const fault = await tx.faultReport.create({
        data: {
          gateId: gate.id,
          station: gate.station,
          occurredAt: new Date(dto.occurredAt),
          description: dto.description.trim(),
          stationAgent: dto.stationAgent.trim(),
          status: FaultStatus.ALERT,
          ticketCase: { create: {} },
        },
        include: faultInclude,
      });
      await tx.gate.update({
        where: { id: gate.id },
        data: { status: 'FAULT' },
      });
      return fault;
    });
  }

  async list(status?: 'ALERT' | 'REPAIR_CLOSED') {
    return this.db.faultReport.findMany({
      where: status ? { status } : undefined,
      orderBy: { occurredAt: 'desc' },
      include: faultInclude,
    });
  }

  async detail(id: string) {
    const fault = await this.db.faultReport.findUnique({
      where: { id },
      include: faultInclude,
    });
    if (!fault) throw new NotFoundException('故障工单不存在');
    return fault;
  }

  /**
   * 维修员确认修复并结案 —— 只作用于维修工单：
   * 不触碰票务工单、行程与退款。仅当不存在其他告警时闸机才恢复正常。
   */
  async repairClose(id: string, dto: RepairCloseDto) {
    if (!dto.repairedBy?.trim()) throw new BadRequestException('维修员必填');
    const fault = await this.db.faultReport.findUnique({
      where: { id },
      include: { gate: true },
    });
    if (!fault) throw new NotFoundException('故障工单不存在');
    if (fault.status === FaultStatus.REPAIR_CLOSED)
      throw new ConflictException('维修工单已结案，不能重复结案');

    return this.db.$transaction(async (tx) => {
      const closed = await tx.faultReport.update({
        where: { id },
        data: {
          status: FaultStatus.REPAIR_CLOSED,
          repairNote: dto.repairNote?.trim() || null,
          repairedBy: dto.repairedBy.trim(),
          repairedAt: new Date(),
        },
        include: faultInclude,
      });

      // 看板提示是否消失，仅取决于是否还有 ALERT 维修工单，与票务工单无关
      const openRepairs = await tx.faultReport.count({
        where: { gateId: fault.gateId, status: 'ALERT' },
      });
      if (openRepairs === 0) {
        await tx.gate.update({
          where: { id: fault.gateId },
          data: { status: 'NORMAL' },
        });
      }
      return closed;
    });
  }
}
