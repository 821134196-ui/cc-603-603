import { useEffect, useState } from 'react';
import { api, Fault, Gate } from '../api';
import { fmtTime, nowLocalInput } from '../format';

export function RegisterFaultPage({
  onRegistered,
  onCancel,
}: {
  onRegistered: (id: string) => void;
  onCancel: () => void;
}) {
  const [gates, setGates] = useState<Gate[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [form, setForm] = useState({
    gateCode: '',
    occurredAt: nowLocalInput(),
    description: '',
    stationAgent: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.gates(), api.faults()]).then(([g, f]) => {
      setGates(g);
      setFaults(f);
      if (!form.gateCode && g.length) setForm((s) => ({ ...s, gateCode: g[0].code }));
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const fault = await api.registerFault({
        gateCode: form.gateCode,
        occurredAt: new Date(form.occurredAt).toISOString(),
        description: form.description,
        stationAgent: form.stationAgent,
      });
      onRegistered(fault.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>站务员登记故障设备</h2>
        <p className="muted">
          登记后系统自动生成两张互相独立的工单：<b>维修工单</b>（维修员跟进）与
          <b> 票务工单</b>（客服跟进乘客缺失行程与差价），两者分别结案。
        </p>
        <label>故障闸机</label>
        <select
          value={form.gateCode}
          onChange={(e) => setForm({ ...form, gateCode: e.target.value })}
        >
          {gates.map((g) => (
            <option key={g.id} value={g.code}>
              {g.code} · {g.station} · {g.name}
              {g.status === 'FAULT' ? '（告警中）' : ''}
            </option>
          ))}
        </select>
        <label>故障发生时间</label>
        <input
          type="datetime-local"
          value={form.occurredAt}
          onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
        />
        <label>故障描述</label>
        <textarea
          placeholder="如：出站闸机扇门无法打开，乘客无法正常刷卡出站"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <label>登记站务员工号</label>
        <input
          placeholder="如：STA-0312"
          value={form.stationAgent}
          onChange={(e) => setForm({ ...form, stationAgent: e.target.value })}
        />
        {error && <div className="msg err">{error}</div>}
        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy} onClick={submit}>
            {busy ? '提交中…' : '登记故障并生成双工单'}
          </button>
          <button className="btn ghost" onClick={onCancel}>
            返回看板
          </button>
        </div>
      </div>

      <div className="card">
        <h2>工单受理列表</h2>
        <p className="muted">维修进度与票务进度并列展示，分别跟进、分别结案。</p>
        <table>
          <thead>
            <tr>
              <th>闸机/站点</th>
              <th>故障时间</th>
              <th>维修工单</th>
              <th>票务工单</th>
            </tr>
          </thead>
          <tbody>
            {faults.map((f) => (
              <tr key={f.id} className="clickable" onClick={() => onRegistered(f.id)}>
                <td>
                  <div className="mono">{f.gate.code}</div>
                  <div className="muted">{f.station}</div>
                </td>
                <td>{fmtTime(f.occurredAt)}</td>
                <td>
                  {f.status === 'ALERT' ? (
                    <span className="badge red">告警中</span>
                  ) : (
                    <span className="badge green">已修复结案</span>
                  )}
                </td>
                <td>
                  {f.ticketCase?.status === 'CLOSED' ? (
                    <span className="badge green">已结案</span>
                  ) : (
                    <span className="badge amber">处理中</span>
                  )}
                </td>
              </tr>
            ))}
            {faults.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  暂无工单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
