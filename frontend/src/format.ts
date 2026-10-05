export const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export const fmtTime = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleString('zh-CN', { hour12: false });

export function nowLocalInput() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
