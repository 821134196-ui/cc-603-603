import { useEffect, useState } from 'react';
import { api, fmtMoney, fmtTime, post, REPAIR_STATUS_LABEL, TICKET_STATUS_LABEL } from '../api';
import type { Incident, Meta } from '../types';

// 受理页：站务员登记故障；每个故障并列展示 维修工单 与 票务工单 两条进度线，分别结案。
export default function AcceptancePage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [gateCode, setGateCode] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 16));
  const [reportedBy, setReportedBy] = useState('站务员小王');
  const [description, setDescription] = useState('闸机读卡异常，乘客无法正常刷卡进出站');

  const load = async () => {
    const [m, list] = await Promise.all([api<Meta>('/meta'), api<Incident[]>('/incidents')]);
    setMeta(m);
    setIncidents(list);
    if (!gateCode && m.gates.length) setGateCode(m.gates[0].code);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okMsg);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const register = () =>
    run(
      () =>
        post('/incidents', {
          gateCode,
          occurredAt: new Date(occurredAt).toISOString(),
          reportedBy,
          description,
        }),
      '故障已登记：已同时生成维修工单与票务工单',
    );

  return (
    <div>
      <section className="card">
        <h2>故障登记（站务员）</h2>
        <div className="form-row">
          <label>
            故障闸机
            <select value={gateCode} onChange={(e) => setGateCode(e.target.value)}>
              {meta?.gates.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code} · {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            发生时间
            <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </label>
          <label>
            登记人
            <input value={reportedBy} onChange={(e) => setReportedBy(e.target.value)} />
          </label>
          <label className="grow">
            故障描述
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button className="primary" onClick={register}>
            登记故障
          </button>
        </div>
      </section>

      {error && <div className="banner error">⚠ {error}</div>}
      {notice && <div className="banner ok">✓ {notice}</div>}

      {incidents.map((inc) => (
        <IncidentCard key={inc.id} incident={inc} run={run} />
      ))}
      {incidents.length === 0 && <p className="muted">暂无故障记录</p>}
    </div>
  );
}

function IncidentCard({
  incident: inc,
  run,
}: {
  incident: Incident;
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [assignee, setAssignee] = useState('维修员老赵');
  const [handler, setHandler] = useState('客服小周');
  const ro = inc.repairOrder;
  const to = inc.ticketOrder;
  const s = inc.tripStats;

  return (
    <section className="card incident">
      <header className="incident-head">
        <strong>
          {inc.gate.code} · {inc.gate.name}
        </strong>
        <span className="muted">发生：{fmtTime(inc.occurredAt)}</span>
        <span className="muted">登记人：{inc.reportedBy}</span>
        <span className="muted">{inc.description}</span>
      </header>
      <div className="two-col">
        <div className="col repair">
          <h3>
            🔧 维修工单 <span className={`badge r-${ro.status}`}>{REPAIR_STATUS_LABEL[ro.status]}</span>
          </h3>
          <p className="muted">
            维修员：{ro.assignee || '未指派'} ｜ 开始：{fmtTime(ro.startedAt)} ｜ 确认：{fmtTime(ro.resolvedAt)}
          </p>
          {ro.note && <p className="muted">备注：{ro.note}</p>}
          <div className="actions">
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="维修员" />
            <button
              disabled={ro.status !== 'PENDING'}
              onClick={() => run(() => post(`/repair-orders/${ro.id}/start`, { assignee }), '维修工单已开始')}
            >
              开始维修
            </button>
            <button
              className="primary"
              disabled={ro.status === 'RESOLVED'}
              onClick={() =>
                run(() => post(`/repair-orders/${ro.id}/resolve`, { note: '维修完成，设备恢复' }), '维修已确认，闸机撤下告警看板')
              }
            >
              确认修复
            </button>
          </div>
        </div>
        <div className="col ticket">
          <h3>
            🎫 票务工单 <span className={`badge t-${to.status}`}>{TICKET_STATUS_LABEL[to.status]}</span>
          </h3>
          <p className="muted">
            客服：{to.handler || '未指派'} ｜ 结案：{fmtTime(to.closedAt)}
          </p>
          <p>
            行程 {s.total} 条 ｜ <span className="warn">待复核 {s.needsReview}</span> ｜{' '}
            <span className="warn">待补登 {s.missingExit}</span> ｜ 已处理 {s.handled} ｜ 已退 {fmtMoney(s.refundedAmount)}
          </p>
          <div className="actions">
            <input value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="客服" />
            <button
              className="primary"
              disabled={to.status === 'CLOSED'}
              onClick={() => run(() => post(`/ticket-orders/${to.id}/close`, { handler }), '票务工单已结案（不影响维修与告警）')}
            >
              票务结案
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
