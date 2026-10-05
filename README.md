# 城市地铁闸机故障票务补登系统

一次闸机故障同时引出两类互相独立的工作：

- 🔧 **维修工单（FaultReport）**：站务员登记故障设备与发生时间，维修员处理闸机并确认结案。
- 🎫 **票务工单（TicketCase）**：客服核对乘客缺失行程，补登进/出站记录，退还故障期间多收的差价。

系统保证：**两类工单分别结案、互不代替**；设备修好不会自动关闭乘客问题，乘客问题处理完也不会让尚未恢复的闸机从告警看板消失。

技术栈：TypeScript + NestJS + Prisma + SQLite（后端），React + Vite（前端），闸机日志与支付回执均在本地模拟。

## 一条本地命令启动

```bash
npm start
```

首次运行会自动完成：安装依赖 → 同步 SQLite 表结构 → 写入 5 台演示闸机 → 构建前后端 → 启动。

启动后访问：

- 系统页面：<http://localhost:3001>（后端同时托管前端构建产物，单端口）
- 后端 API：<http://localhost:3001/api>

其他命令：

```bash
npm test          # 运行后端不变量测试（独立 test.db）
npm run build     # 仅构建
npm run start:dev # 开发模式（Nest watch + Vite dev server，端口 5173 代理 /api）
```

## 演示流程

1. **登记故障**：在「故障登记 / 工单受理」页选择闸机（如 `RM-A01`）、填写故障时间与描述，提交后同时生成维修工单与票务工单，闸机立即出现在告警看板。
2. **模拟日志**：进入工单受理页，使用三个模拟按钮：
   - 「模拟上传正常批次」：两张卡的故障时段刷卡（其中一卡缺出站记录）。
   - 「重复上传同一批」：验证内容指纹去重——同一段日志重复上传只形成一次有效记录，不生成两段相同行程。
   - 「模拟上传晚到日志」：补传一条 2 小时前的刷卡记录，进入「晚到待复核」状态，客服在页面上**复核通过 / 驳回**后才会处理。
3. **票务处理（右侧面板）**：对缺失行程人工补登缺失的进站或出站站点 → 生成模拟支付回执（故障期间按全网最高票价 ¥6.00 预收）→ 核对应收票价后**退还差价**。每段行程的退款按钮只能成功一次，再次点击返回 409。
4. **维修结案（左侧面板）**：维修员填写维修记录后「确认修复并结案」。
5. 观察两个结案互不影响：
   - 只结案票务：闸机仍留在「设备告警看板」，维修状态仍为告警中。
   - 只结案维修：告警撤下、闸机恢复正常，但票务工单仍是处理中。
6. 看板 5 秒自动刷新；只有维修工单确认完成，设备异常提示才会消失。

## 关键业务不变量

| 不变量 | 实现保证 |
| --- | --- |
| 相同故障日志重复上传只形成一次有效记录 | 日志入库前计算内容指纹 `sha256(闸机\|卡号\|事件类型\|刷卡时刻)`，`GateLog.logHash` 数据库唯一约束 + 上传前查重，并发冲突再由 P2002 兜底 |
| 不生成两段相同行程 | `Trip` 上 `@@unique([faultReportId, cardId])`，同一故障下同一张卡最多一段行程 |
| 晚到日志须复核后处理 | 刷卡时刻早于到达时刻超过 15 分钟，或维修结案后才到达的日志标记 `isLate`，未复核通过不参与行程配对 |
| 一趟行程最多退款一次 | `RefundRecord.tripId` 唯一约束；服务层先查状态（MISSING 不可退、REFUNDED 返回 409），并发下由唯一约束兜底 |
| 维修结案不代替票务结案 | `repairClose` 只更新 FaultReport/Gate，不触碰 TicketCase；重复结案返回 409 |
| 票务结案不撤下设备告警 | 看板只查询 `status = ALERT` 的 FaultReport，与 TicketCase 状态完全无关；票务结案只更新 TicketCase |
| 票务结案保护 | 仍有 MISSING 行程时默认拒绝结案（确认无乘客主张可 `force` 强制结案） |

## 自动化测试

`backend/test/` 下 5 个用例（Jest + 独立 test.db）：

- `duplicate-logs.test.ts`：重复上传 3 条日志全部拦截、行程数不增长、退款成功一次后重复退款抛 Conflict、两张卡各只退一次。
- `ticket-closure.test.ts`：票务结案后维修仍 ALERT 且看板仍有告警；维修结案后看板清空但票务工单状态不变；两个方向的重复结案均被拒绝。
- `late-review.test.ts`：晚到日志复核前不产生行程，复核通过后补全既有行程而非新增，驳回永不处理。

## 目录结构

```
backend/
  prisma/schema.prisma     # Gate / FaultReport / TicketCase / GateLog / Trip / PaymentReceipt / RefundRecord
  prisma/seed.ts           # 演示闸机
  src/
    faults/                # 故障登记 + 维修工单结案
    tickets/               # 票务工单结案（独立于维修）
    logs/                  # 日志上传、内容指纹去重、晚到复核
    trips/                 # 行程配对、人工补登、差价退款（每趟一次）
    simulator/             # 本地模拟闸机日志批次 normal/duplicate/late
    dashboard/             # 设备异常看板（仅依据维修状态）
    gates/                 # 闸机台账
frontend/src/
  pages/DashboardPage.tsx       # 设备告警看板
  pages/RegisterFaultPage.tsx   # 故障登记 + 工单受理列表
  pages/FaultDetailPage.tsx     # 受理页：维修/票务并列双面板、日志与行程处理
scripts/start.mjs          # npm start 的一键编排
```

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/faults` | 站务员登记故障（自动生成票务工单，闸机置为告警） |
| POST | `/api/faults/:id/repair-close` | 维修员确认修复并结案 |
| POST | `/api/faults/:id/logs/upload` | 上传日志批次（自动去重、晚到识别、行程配对） |
| POST | `/api/simulator/faults/:id/logs/:scenario` | 模拟 `normal` / `duplicate` / `late` 批次 |
| POST | `/api/logs/:id/review` | 晚到日志复核（approve=true/false） |
| POST | `/api/trips/:id/register` | 客服补登缺失进/出站站点，生成支付回执 |
| POST | `/api/trips/:id/refund` | 退还差价（一趟最多一次，重复返回 409） |
| POST | `/api/tickets/:id/close` | 客服结案票务工单（有未处理行程时默认拒绝） |
| GET | `/api/dashboard/overview` | 设备异常看板（维修未完成则持续提示） |
