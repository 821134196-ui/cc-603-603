import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GatesService {
  constructor(private readonly db: PrismaService) {}

  list() {
    return this.db.gate.findMany({
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
      include: {
        faultReports: {
          where: { status: 'ALERT' },
          orderBy: { occurredAt: 'desc' },
        },
      },
    });
  }

  async getByCode(code: string) {
    const gate = await this.db.gate.findUnique({ where: { code } });
    if (!gate) throw new NotFoundException(`闸机 ${code} 不存在`);
    return gate;
  }

  /** 站点是否有处于告警中的故障 */
  async hasActiveFault(gateId: string) {
    const count = await this.db.faultReport.count({
      where: { gateId, status: 'ALERT' },
    });
    return count > 0;
  }
}
