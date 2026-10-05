import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from './prisma';
import { fareBetween, MAX_FARE, RepairStatus, STATIONS, TripStatus } from './domain';

// ---- 闸机日志（本地模拟）----
// 幂等两道防线：
//  1) GateLog.contentHash 唯一 —— 同一段日志重复上传只形成一次有效记录；
//  2) TripRecord.dedupeKey 唯一 —— 即使不同日志内容有重叠，也不会生成两段相同行程。
// 故障时间窗内晚到的刷卡记录标记 late 并进入 NEEDS_REVIEW，须客服复核后才能处理。

interface UploadRecord {
  cardId: string;
  entryTime: string;
  exitStation?: string;
  exitTime?: string;
  chargedFare?: number;
}

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  async upload(dto: { gateCode: string; records: UploadRecord[]; uploadedAt?: string }) {
    if (!dto?.gateCode) throw new BadRequestException('gateCode 必填');
    if (!Array.isArray(dto.records) || dto.records.length === 0) {
      throw new BadRequestException('records 不能为空');
    }
    const gate = await this.prisma.gate.findUnique({ where: { code: dto.gateCode } });
    if (!gate) throw new NotFoundException(`闸机 ${dto.gateCode} 不存在`);

    // 内容哈希：同一段日志（闸机 + 记录序列完全一致）只入库一次
    const contentHash = createHash('sha256')
      .update(gate.code + '\n' + JSON.stringify(dto.records))
      .digest('hex');
    const existing = await this.prisma.gateLog.findUnique({ where: { contentHash } });
    if (existing) {
      return {
        duplicated: true,
        logId: existing.id,
        contentHash,
        recordCount: dto.records.length,
        tripsCreated: 0,
        duplicatesSkipped: dto.records.length,
        lateTrips: 0,
        message: '同一段日志已上传过，本次按重复上传拦截，未产生任何新记录',
      };
    }

    const summary = await this.prisma.$transaction(async (tx) => {
      const log = await tx.gateLog.create({
        data: {
          gateId: gate.id,
          contentHash,
          recordCount: dto.records.length,
          uploadedAt: dto.uploadedAt ? new Date(dto.uploadedAt) : new Date(),
        },
      });
      let tripsCreated = 0;
      let duplicatesSkipped = 0;
      let lateTrips = 0;

      for (const rec of dto.records) {
        if (!rec.cardId || !rec.entryTime) throw new BadRequestException('每条记录必须包含 cardId 与 entryTime');
        const entryTime = new Date(rec.entryTime);
        if (isNaN(entryTime.getTime())) throw new BadRequestException(`entryTime 无效: ${rec.entryTime}`);

        // 第二道防线：行程级去重
        const dedupeKey = `${rec.cardId}|${gate.station}|${entryTime.toISOString()}`;
        const dup = await tx.tripRecord.findUnique({ where: { dedupeKey } });
        if (dup) {
          duplicatesSkipped++;
          continue;
        }

        // 该刷卡是否落在某次故障的时间窗内（故障开始 <= 刷卡时间 <= 维修确认时间）
        const incident = await tx.incident.findFirst({
          where: { gateId: gate.id, occurredAt: { lte: entryTime } },
          orderBy: { occurredAt: 'desc' },
          include: { repairOrder: true },
        });
        const inWindow =
          !!incident &&
          (!incident.repairOrder?.resolvedAt || entryTime <= incident.repairOrder.resolvedAt);

        const hasExit = !!(rec.exitStation && rec.exitTime);
        const chargedFare =
          typeof rec.chargedFare === 'number'
            ? rec.chargedFare
            : hasExit
              ? fareBetween(gate.station, rec.exitStation!)
              : MAX_FARE; // 缺出站：支付系统按全程最高价扣费（本地模拟）
        const status = hasExit
          ? TripStatus.NORMAL
          : inWindow
            ? TripStatus.NEEDS_REVIEW // 故障期间晚到：先复核
            : TripStatus.MISSING_EXIT;

        const trip = await tx.tripRecord.create({
          data: {
            dedupeKey,
            cardId: rec.cardId,
            gateId: gate.id,
            entryStation: gate.station,
            entryTime,
            exitStation: rec.exitStation ?? null,
            exitTime: rec.exitTime ? new Date(rec.exitTime) : null,
            chargedFare,
            status,
            late: inWindow,
            incidentId: inWindow ? incident!.id : null,
            logId: log.id,
          },
        });
        // 支付回执（本地模拟）：扣费回执
        if (chargedFare > 0) {
          await tx.paymentReceipt.create({
            data: { receiptNo: `PAY-${trip.id}`, cardId: rec.cardId, amount: chargedFare, kind: 'CHARGE' },
          });
        }
        tripsCreated++;
        if (inWindow) lateTrips++;
      }
      return { logId: log.id, tripsCreated, duplicatesSkipped, lateTrips };
    });

    return { duplicated: false, contentHash, recordCount: dto.records.length, ...summary };
  }

  // 本地模拟生成一段闸机日志并走同一上传管线；返回原始报文便于“重复上传”验证幂等
  async simulate(dto: { gateCode: string; count?: number; missingExit?: number }) {
    const gate = await this.prisma.gate.findUnique({ where: { code: dto.gateCode } });
    if (!gate) throw new NotFoundException(`闸机 ${dto.gateCode} 不存在`);
    const count = Math.min(Math.max(dto.count ?? 6, 1), 50);
    const missingExit = Math.min(Math.max(dto.missingExit ?? Math.ceil(count / 2), 0), count);

    // 若该闸机有未修复故障，让记录落在故障时间窗内（模拟故障期间产生、晚到的刷卡记录）
    const openIncident = await this.prisma.incident.findFirst({
      where: { gateId: gate.id, OR: [{ repairOrder: null }, { repairOrder: { status: { not: RepairStatus.RESOLVED } } }] },
      orderBy: { occurredAt: 'desc' },
    });
    const now = Date.now();
    const windowStart = openIncident ? openIncident.occurredAt.getTime() : now - 40 * 60_000;
    const spanSeconds = Math.max(Math.floor((now - windowStart) / 1000), 60);

    const records: UploadRecord[] = [];
    for (let i = 0; i < count; i++) {
      const cardId = `CARD-${randomInt(100000, 999999)}`;
      const entryTime = new Date(windowStart + randomInt(1, spanSeconds) * 1000);
      if (i < missingExit) {
        // 故障场景：只有进站，没有出站，被按最高价扣费
        records.push({ cardId, entryTime: entryTime.toISOString() });
      } else {
        const exitStation = STATIONS[randomInt(0, STATIONS.length)];
        const exitTime = new Date(entryTime.getTime() + randomInt(10, 50) * 60_000);
        records.push({
          cardId,
          entryTime: entryTime.toISOString(),
          exitStation,
          exitTime: exitTime.toISOString(),
          chargedFare: fareBetween(gate.station, exitStation),
        });
      }
    }
    const payload = { gateCode: gate.code, records };
    const result = await this.upload(payload);
    return { payload, result };
  }

  list() {
    return this.prisma.gateLog.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: { gate: { select: { code: true, name: true, station: true } } },
      take: 50,
    });
  }
}

@Controller('logs')
export class LogsController {
  constructor(private svc: LogsService) {}

  @Post('upload')
  upload(@Body() dto: any) {
    return this.svc.upload(dto);
  }

  @Post('simulate')
  simulate(@Body() dto: any) {
    return this.svc.simulate(dto);
  }

  @Get()
  list() {
    return this.svc.list();
  }
}

@Module({
  controllers: [LogsController],
  providers: [LogsService, PrismaService],
})
export class LogsModule {}
