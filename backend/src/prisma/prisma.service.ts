import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as path from 'node:path';

// 未显式提供 DATABASE_URL 时，默认落在 backend/prisma/dev.db（相对后端工作目录）
const databaseUrl =
  process.env.DATABASE_URL ??
  `file:${path.resolve(process.cwd(), 'prisma', 'dev.db')}`;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: { db: { url: databaseUrl } },
      log: ['warn', 'error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`SQLite 已连接: ${databaseUrl}`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
