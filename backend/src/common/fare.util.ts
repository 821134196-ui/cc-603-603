// 本地模拟的线路与票价规则（单位：分）
// 一条线路按站序计价，故障时 AFC 通常先按全网最高票价预收，客服核对后退还差价。

export const STATIONS = [
  '人民广场',
  '南京东路',
  '陆家嘴',
  '世纪大道',
  '静安寺',
  '徐家汇',
  '虹桥火车站',
  '中山公园',
];

export const MAX_FARE = 600; // 最高票价 6 元

const FARE_BY_DISTANCE: Record<number, number> = {
  0: 300,
  1: 300,
  2: 400,
  3: 500,
};

export function calcFare(entryStation: string, exitStation: string): number {
  const i = STATIONS.indexOf(entryStation);
  const j = STATIONS.indexOf(exitStation);
  if (i === -1 || j === -1) return MAX_FARE; // 未知站点按最高票价保守处理
  const d = Math.abs(i - j);
  return FARE_BY_DISTANCE[d] ?? MAX_FARE;
}

export function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}
