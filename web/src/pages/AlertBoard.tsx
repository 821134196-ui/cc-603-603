import { useEffect, useState } from 'react';
import { api, fmtTime, REPAIR_STATUS_LABEL, TICKET_STATUS_LABEL } from '../api';
import type { AlertItem, Meta } from '../types';

// 告警看板：设备异常提示保留到维修确认完成为止；票务进度不影响看板。
export default function AlertBoard() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [a, m] = await Promise.all([api<AlertItem[]>('/dashboard/alerts'), api<Meta>('/meta')]);
    setAlerts(a);
    setMeta(m);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);

  const faultyCodes = new Set(alerts.map((a) => a.gate.code));

  return (
    <div>
      <section className="card">
        <h2>告警看板</h2>
        <p className="muted">设备异常提示将一直保留，直到维修工单确认完成。票务结案不会撤下告警。</p>
        {error && <div className="banner error">⚠ {error}</div>}
      </section>
      <div className="gate-grid">
        {meta?.gates.map((g) => {
          const alert = alerts.find((a) => a.gate.code === g.code);
          const faulty = faultyCodes.has(g.code);
          return (
            <div key={g.code} className={faulty ? 'gate-card fault' : 'gate-card'}>
              <h3>
                {g.code} · {g.name}
              </h3>
              <p className={faulty ? 'status-fault' : 'status-ok'}>{faulty ? '⚠ 设备异常' : '✓ 运行正常'}</p>
              {alert?.incident && (
                <div className="alert-detail">
                  <p>发生：{fmtTime(alert.incident.occurredAt)}</p>
                  <p>登记人：{alert.incident.reportedBy}</p>
                  <p>
                    维修工单：<span className={`badge r-${alert.incident.repairOrder.status}`}>
                      {REPAIR_STATUS_LABEL[alert.incident.repairOrder.status]}
                    </span>{' '}
                    票务工单：<span className={`badge t-${alert.incident.ticketOrder.status}`}>
                      {TICKET_STATUS_LABEL[alert.incident.ticketOrder.status]}
                    </span>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
