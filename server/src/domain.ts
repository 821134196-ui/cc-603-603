// 领域常量与票价规则（本地模拟）。

// 线路站点（顺序即站序），票价按站间距计算。
export const STATIONS = [
  '罗湖',
  '国贸',
  '老街',
  '大剧院',
  '科学馆',
  '华强路',
  '岗厦',
  '会展中心',
  '购物公园',
  '香蜜湖',
  '车公庙',
] as const;

export const BASE_FARE = 200; // 起步价 2 元（分）
export const FARE_PER_3_STOPS = 100; // 每 3 站加 1 元
export const MAX_FARE = 1500; // 全程最高 15 元：缺出站行程先按最高价扣

export function fareBetween(fromStation: string, toStation: string): number {
  const i = STATIONS.indexOf(fromStation as any);
  const j = STATIONS.indexOf(toStation as any);
  if (i < 0 || j < 0) throw new Error(`未知站点: ${fromStation} -> ${toStation}`);
  const stops = Math.abs(i - j);
  return BASE_FARE + Math.floor(stops / 3) * FARE_PER_3_STOPS;
}

// 闸机状态
export const GateStatus = { NORMAL: 'NORMAL', FAULT: 'FAULT' } as const;

// 维修工单状态机：PENDING -> IN_PROGRESS -> RESOLVED
export const RepairStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
} as const;

// 票务工单状态机：PENDING -> PROCESSING -> CLOSED
export const TicketStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  CLOSED: 'CLOSED',
} as const;

// 行程状态
export const TripStatus = {
  NORMAL: 'NORMAL', // 进出站完整，无需处理
  MISSING_EXIT: 'MISSING_EXIT', // 缺出站，待补登
  NEEDS_REVIEW: 'NEEDS_REVIEW', // 故障期间晚到记录，须先复核
  COMPLETED: 'COMPLETED', // 已补登（无差价）
  REFUNDED: 'REFUNDED', // 已补登并退还差价 / 已退款
} as const;

// 票务工单允许关闭前必须清零的行程状态
export const BLOCKING_TRIP_STATUSES = [TripStatus.NEEDS_REVIEW, TripStatus.MISSING_EXIT];
