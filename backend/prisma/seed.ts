/* 种子数据：本地演示用闸机 */
import { PrismaClient } from '@prisma/client';
import { GATE_STATUS } from '../src/common/status';
import * as path from 'node:path';

process.env.DATABASE_URL ??= `file:${path.resolve(process.cwd(), 'prisma', 'dev.db')}`;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const GATES = [
  { code: 'RM-A01', station: '人民广场', name: 'A口进站闸机 01' },
  { code: 'RM-B03', station: '人民广场', name: 'B口出站闸机 03' },
  { code: 'LJ-A02', station: '陆家嘴', name: 'A口进站闸机 02' },
  { code: 'SJ-C05', station: '世纪大道', name: 'C口出站闸机 05' },
  { code: 'XJ-A01', station: '徐家汇', name: 'A口进站闸机 01' },
];

async function main() {
  for (const g of GATES) {
    await prisma.gate.upsert({
      where: { code: g.code },
      update: {},
      create: { ...g, status: GATE_STATUS.NORMAL },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`种子数据完成：${GATES.length} 台闸机`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
