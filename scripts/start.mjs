#!/usr/bin/env node
// 一条本地命令启动：初始化数据库 → 种子 → 构建 → 启动（单端口 3001 同时提供页面与 API）
import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: true, ...opts });
  if (r.status !== 0) {
    console.error(`\n❌ 命令失败: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

console.log('① 检查依赖…');
run('npm', ['install', '--silent']);

console.log('② 同步 SQLite 数据库结构（Prisma db push）…');
run('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  cwd: path.join(root, 'backend'),
  env: { DATABASE_URL: 'file:./dev.db', ...process.env },
});

console.log('③ 写入演示闸机种子数据…');
run('npx', ['ts-node', 'prisma/seed.ts'], { cwd: path.join(root, 'backend') });

console.log('④ 构建后端与前端…');
run('npm', ['run', 'build', '--workspaces']);

console.log('⑤ 启动服务…');
const child = spawn('node', ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  stdio: 'inherit',
  env: process.env,
});

const stop = () => child.kill('SIGTERM');
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
child.on('exit', (code) => process.exit(code ?? 0));
