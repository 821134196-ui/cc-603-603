import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as express from 'express';
import { AppModule } from './app.module';

function resolveUiDist() {
  const candidates = [
    path.resolve(process.cwd(), 'frontend', 'dist'), // 从仓库根目录启动
    path.resolve(process.cwd(), '..', 'frontend', 'dist'), // 从 backend/ 启动
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) ?? null;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');

  // 生产模式：一条命令启动后由后端直接托管 React 构建产物（单端口）
  const uiDist = resolveUiDist();
  if (uiDist) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(uiDist));
    // SPA 回退：除 /api 外的 GET 一律交给前端路由
    expressApp.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(uiDist, 'index.html'));
    });
    Logger.log(`已托管前端页面: ${uiDist}`, 'Bootstrap');
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`系统已启动: http://localhost:${port}`, 'Bootstrap');
  Logger.log(`后端 API:  http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
