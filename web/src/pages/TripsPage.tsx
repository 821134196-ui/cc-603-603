import { useEffect, useState } from 'react';
import { api, fmtMoney, fmtTime, post, TRIP_STATUS_LABEL } from '../api';
import type { Incident, Meta, Trip } from '../types';

// 票务处理：客服复核晚到记录 -> 补登出站（自动退差价）-> 必要时人工退款（一趟行程最多一次）。
export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [incidentId, setIncidentId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [exitStation, setExitStation] = useState('');
  const [exitTime, setExitTime] = useState(() => new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 16));
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundYuan, setRefundYuan] = useState('');

  const load = async () => {
    const qs = new URLSearchParams();
    if (incidentId) qs.set('incidentId', incidentId);
    if (status) qs.set('status', status);
    const [t, i, m] = await Promise.all([
      api<Trip[]>(`/trips?${qs}`),
      api<Incident[]>('/incidents'),
      api<Meta>('/meta'),
    ]);
    setTrips(t);
    setIncidents(i);
    setMeta(m);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [incidentId, status]);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okMsg);
      setCompletingId(null);
      setRefundingId(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <section className="card">
        <h2>票务处理（客服）</h2>
        <div className="form-row">
          <label>
            故障单
            <select value={incidentId} onChange={(e) => setIncidentId(e.target.value)}>
              <option value="">全部</option>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.gate.code} · {fmtTime(i.occurredAt)}
                </option>
              ))}
            </select>
          </label>
          <label>
            行程状态
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(TRIP_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => load()}>刷新</button>
        </div>
        {error && <div className="banner error">⚠ {error}</div>}
        {notice && <div className="banner ok">✓ {notice}</div>}
      </section>

      <table className="table">
        <thead>
          <tr>
            <th>卡号</th>
            <th>闸机</th>
            <th>进站</th>
            <th>出站</th>
            <th>已扣费</th>
            <th>应收</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((t) => (
            <tr key={t.id}>
              <td>{t.cardId}</td>
              <td>{t.gate.code}</td>
              <td>
                {t.entryStation} {fmtTime(t.entryTime)}
              </td>
              <td>{t.exitStation ? `${t.exitStation} ${fmtTime(t.exitTime)}` : '—'}</td>
              <td>{fmtMoney(t.chargedFare)}</td>
              <td>{fmtMoney(t.correctFare)}</td>
              <td>
                <span className={`badge trip-${t.status}`}>{TRIP_STATUS_LABEL[t.status]}</span>
                {t.late && <span className="badge late">晚到</span>}
                {t.refund && <span className="muted"> 退{fmtMoney(t.refund.amount)}</span>}
              </td>
              <td className="actions">
                {t.status === 'NEEDS_REVIEW' && (
                  <button onClick={() => run(() => post(`/trips/${t.id}/review`), '复核完成')}>复核</button>
                )}
                {t.status === 'MISSING_EXIT' &&
                  (completingId === t.id ? (
                    <span className="inline-form">
                      <select value={exitStation} onChange={(e) => setExitStation(e.target.value)}>
                        <option value="">出站站点</option>
                        {meta?.stations.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <input type="datetime-local" value={exitTime} onChange={(e) => setExitTime(e.target.value)} />
                      <button
                        className="primary"
                        disabled={!exitStation}
                        onClick={() =>
                          run(
                            () =>
                              post(`/trips/${t.id}/complete`, {
                                exitStation,
                                exitTime: new Date(exitTime).toISOString(),
                              }),
                            '补登完成，差价已自动退还',
                          )
                        }
                      >
                        确认补登
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setCompletingId(t.id);
                        setExitStation('');
                      }}
                    >
                      补登
                    </button>
                  ))}
                {!t.refund &&
                  t.status !== 'NEEDS_REVIEW' &&
                  (refundingId === t.id ? (
                    <span className="inline-form">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="金额(元)"
                        value={refundYuan}
                        onChange={(e) => setRefundYuan(e.target.value)}
                      />
                      <button
                        className="primary"
                        onClick={() =>
                          run(
                            () =>
                              post(`/trips/${t.id}/refund`, {
                                amount: Math.round(parseFloat(refundYuan || '0') * 100),
                                reason: '客服人工退款',
                              }),
                            '退款成功（该行程不可再退）',
                          )
                        }
                      >
                        确认退款
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setRefundingId(t.id);
                        setRefundYuan('');
                      }}
                    >
                      退款
                    </button>
                  ))}
              </td>
            </tr>
          ))}
          {trips.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                暂无行程记录（可先到「日志模拟」上传闸机日志）
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
