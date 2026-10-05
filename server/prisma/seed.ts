import { PrismaClient } from '@prisma/client';
import { STATIONS } from '../src/domain';

const prisma = new PrismaClient();

async function main() {
  // 每个重点站配一台闸机，便于演示
  const gates = [
    { code: 'G01', name: '老街站 1 号闸机', station: '老街' },
    { code: 'G02', name: '老街站 2 号闸机', station: '老街' },
    { code: 'G03', name: '大剧院站 1 号闸机', station: '大剧院' },
    { code: 'G04', name: '会展中心站 1 号闸机', station: '会展中心' },
    { code: 'G05', name: '车公庙站 1 号闸机', station: '车公庙' },
    { code: 'G06', name: '罗湖站 1 号闸机', station: '罗湖' },
  ];
  for (const g of gates) {
    await prisma.gate.upsert({ where: { code: g.code }, update: {}, create: g });
  }
  console.log(`已初始化 ${gates.length} 台闸机，线路站点 ${STATIONS.length} 个`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
