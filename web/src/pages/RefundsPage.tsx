import { useEffect, useState } from 'react';
import { api, fmtMoney, fmtTime } from '../api';
import type { Receipt, Refund } from '../types';

// 退款与支付回执（本地模拟支付系统）。
export default function RefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<Refund[]>('/refunds'), api<Receipt[]>('/receipts')])
      .then(([r, p]) => {
        setRefunds(r);
        setReceipts(p);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      {error && <div className="banner error">⚠ {error}</div>}
      <section className="card">
        <h2>退款记录</h2>
        <p className="muted">一趟行程最多退款一次（Refund.tripId 唯一约束保证）。</p>
        <table className="table">
          <thead>
            <tr>
              <th>回执号</th>
              <th>卡号</th>
              <th>进站</th>
              <th>金额</th>
              <th>原因</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.receiptNo}</code>
                </td>
                <td>{r.trip?.cardId}</td>
                <td>
                  {r.trip?.entryStation} {fmtTime(r.trip?.entryTime)}
                </td>
                <td>{fmtMoney(r.amount)}</td>
                <td>{r.reason}</td>
                <td>{fmtTime(r.createdAt)}</td>
              </tr>
            ))}
            {refunds.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  暂无退款
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>支付回执（本地模拟）</h2>
        <table className="table">
          <thead>
            <tr>
              <th>回执号</th>
              <th>卡号</th>
              <th>类型</th>
              <th>金额</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.receiptNo}</code>
                </td>
                <td>{r.cardId}</td>
                <td>
                  <span className={r.kind === 'REFUND' ? 'badge t-CLOSED' : 'badge'}>
                    {r.kind === 'REFUND' ? '退款' : '扣费'}
                  </span>
                </td>
                <td>{fmtMoney(r.amount)}</td>
                <td>{fmtTime(r.createdAt)}</td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  暂无回执
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
