import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { STATIONS } from '../common/fare.util';

export type SimScenario = 'normal' | 'duplicate' | 'late';

@Injectable()
export class SimulatorService {
  constructor(
    private readonly db: PrismaService,
    private readonly logs: LogsService,
  ) {}

  /**
   * 本地模拟闸机日志上传。
   * - normal：故障时段两张卡的进站/出站刷卡（其中一卡缺出站记录）
   * - duplicate：把上一批日志原样再传一次，应全部识别为重复
   * - late：补传一条刷卡时间远早于当前的日志，须复核后处理
   */
  async simulate(faultId: string, scenario: SimScenario) {
    const fault = await this.db.faultReport.findUnique({
      where: { id: faultId },
      include: { gate: true },
    });
    if (!fault) throw new NotFoundException('故障工单不存在');

    const base = fault.occurredAt.getTime();
    const station = fault.station;
    const gateCode = fault.gate.code;

    if (scenario === 'late') {
      // 刷卡时间在 2 小时前，到达时间是现在 → 晚到日志
      return this.logs.upload(faultId, {
        batchNo: `SIM-LATE-${faultId.slice(-6)}`,
        logs: [
          {
            gateCode,
            station,
            cardId: 'CARD-9001',
            eventType: 'EXIT',
            eventTime: new Date(base - 2 * 60 * 60 * 1000).toISOString(),
          },
        ],
      });
    }

    // normal / duplicate 使用完全相同的内容（相同卡号、相同刷卡时刻），
    // 因此第二次上传必然命中内容指纹去重
    const entryStation = STATIONS[0];
    const exitStation = STATIONS[3];
    const logs = [
      {
        gateCode,
        station: entryStation,
        cardId: 'CARD-1001',
        eventType: 'ENTRY' as const,
        eventTime: new Date(base + 2 * 60 * 1000).toISOString(),
      },
      {
        gateCode,
        station: exitStation,
        cardId: 'CARD-1001',
        eventType: 'EXIT' as const,
        eventTime: new Date(base + 25 * 60 * 1000).toISOString(),
      },
      // 该卡只有进站、没有出站 —— 典型缺失行程，需客服补登后退差价
      {
        gateCode,
        station: entryStation,
        cardId: 'CARD-1002',
        eventType: 'ENTRY' as const,
        eventTime: new Date(base + 5 * 60 * 1000).toISOString(),
      },
    ];

    return this.logs.upload(faultId, {
      batchNo: `SIM-${scenario.toUpperCase()}-${faultId.slice(-6)}`,
      logs,
    });
  }
}
