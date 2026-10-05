const BASE = '/api';

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join('；') : body.message;
    throw new Error(msg ?? `请求失败 (${res.status})`);
  }
  return body as T;
}

export const post = <T = any>(path: string, data?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const fmtMoney = (cents?: number | null) =>
  cents == null ? '—' : `¥${(cents / 100).toFixed(2)}`;

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

export const TRIP_STATUS_LABEL: Record<string, string> = {
  NORMAL: '行程完整',
  MISSING_EXIT: '待补登',
  NEEDS_REVIEW: '待复核',
  COMPLETED: '已补登',
  REFUNDED: '已退款',
};

export const REPAIR_STATUS_LABEL: Record<string, string> = {
  PENDING: '待派修',
  IN_PROGRESS: '维修中',
  RESOLVED: '已修复',
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理',
  PROCESSING: '处理中',
  CLOSED: '已结案',
};
