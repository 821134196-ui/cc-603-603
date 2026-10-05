/* 测试基础设施：每个测试套件使用独立的 test.db，并在开始时强制重建 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'prisma', 'test.db');
process.env.DATABASE_URL = `file:${dbPath}`;

import { PrismaService } from '../src/prisma/prisma.service';
import { FaultsService } from '../src/faults/faults.service';
import { LogsService } from '../src/logs/logs.service';
import { TripsService } from '../src/trips/trips.service';
import { TicketsService } from '../src/tickets/tickets.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { SimulatorService } from '../src/simulator/simulator.service';

export function resetTestDb() {
  execSync('npx prisma db push --force-reset --skip-generate', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'ignore',
  });
}

export async function createServices() {
  const db = new PrismaService();
  await db.onModuleInit();
  const trips = new TripsService(db);
  const logs = new LogsService(db, trips);
  const faults = new FaultsService(db);
  const tickets = new TicketsService(db);
  const dashboard = new DashboardService(db);
  const simulator = new SimulatorService(db, logs);
  return { db, trips, logs, faults, tickets, dashboard, simulator };
}

export async function seedGate(
  db: PrismaService,
  code: string,
  station = '人民广场',
  name = '测试闸机',
) {
  return db.gate.create({ data: { code, station, name, status: 'NORMAL' } });
}

export function minutesFromNow(min: number) {
  return new Date(Date.now() + min * 60_000).toISOString();
}
