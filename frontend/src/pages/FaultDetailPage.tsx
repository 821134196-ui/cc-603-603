import { useCallback, useEffect, useState } from 'react';
import { api, Fault, UploadResult } from '../api';
import { fmtTime, yuan } from '../format';
import { STATIONS } from '../stations';

export function FaultDetailPage({
  faultId,
  onBack,
}: {
  faultId: string;
  onBack: () => void;
}) {
  const [fault, setFault] = useState<Fault | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .fault(faultId)
        .then(setFault)
        .catch((e) => setError(e.message)),
    [faultId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const r = await fn();
      setNotice(ok);
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !fault) return <div className="msg err">{error}</div>;
  if (!fault) return <div className="muted">加载中…</div>;

  const ticket = fault.ticketCase!;
  const lateLogs = fault.logs.filter((l) => l.isLate && !l.reviewed);

  return (
    <>
      <span className="back-link" onClick={onBack}>
        ← 返回告警看板
      </span>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="kv">
          <dt>故障工单</dt>
          <dd className="mono">{fault.id}</dd>
          <dt>闸机 / 站点</dt>
          <dd>
            <span className="mono">{fault.gate.code}</span> · {fault.station} · {fault.gate.name}
          </dd>
          <dt>故障时间</dt>
          <dd>{fmtTime(fault.occurredAt)}</dd>
          <dt>登记站务</dt>
          <dd>{fault.stationAgent}</dd>
          <dt>故障描述</dt>
          <dd>{fault.description}</dd>
        </div>
      </div>

      {/* 并列展示：维修进度 / 票务进度，分别结案、互不代替 */}
      <div className="panels">
        <RepairPanel fault={fault} busy={busy} onAction={run} />
        <TicketPanel fault={fault} busy={busy} onAction={run} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>闸机日志（本地模拟上传）</h2>
        <p className="muted">
          相同内容的日志重复上传只形成一次有效记录；刷卡时间远晚于发生时间或维修结案后到达的日志标记为
          <b> 晚到</b>，须客服复核后才处理。
        </p>
        <div className="sim-row">
          <button
            className="btn sm ghost"
            disabled={busy}
            onClick={() =>
              run(
                () => api.simulate(fault.id, 'normal'),
                '已模拟上传一批正常故障时段日志',
              ).then((r) => r && setNotice(simText(r as UploadResult)))
            }
          >
            模拟上传正常批次
          </button>
          <button
            className="btn sm ghost"
            disabled={busy}
            onClick={() =>
              run(
                () => api.simulate(fault.id, 'duplicate'),
                '已重复上传同一批日志',
              ).then((r) => r && setNotice(simText(r as UploadResult)))
            }
          >
            重复上传同一批（验证去重）
          </button>
          <button
            className="btn sm ghost"
            disabled={busy}
            onClick={() =>
              run(() => api.simulate(fault.id, 'late'), '已模拟上传一条晚到日志').then(
                (r) => r && setNotice(simText(r as UploadResult)),
              )
            }
          >
            模拟上传晚到日志（待复核）
          </button>
        </div>

        {lateLogs.length > 0 && (
          <div className="msg info">
            {lateLogs.length} 条晚到日志等待客服复核：
            {lateLogs.map((l) => (
              <LateReview key={l.id} log={l} busy={busy} onReviewed={() => run(load, '复核完成')} />
            ))}
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th>刷卡时间</th>
              <th>卡号</th>
              <th>类型</th>
              <th>站点</th>
              <th>到达系统</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {fault.logs.map((l) => (
              <tr
                key={l.id}
                className={`log-row ${l.isLate && !l.reviewed ? 'late' : ''} ${
                  l.reviewed && l.reviewNote?.startsWith('复核驳回') ? 'late-rejected' : ''
                }`}
              >
                <td>{fmtTime(l.eventTime)}</td>
                <td className="mono">{l.cardId}</td>
                <td>{l.eventType === 'ENTRY' ? '进站' : '出站'}</td>
                <td>{l.station}</td>
                <td>{fmtTime(l.receivedAt)}</td>
                <td>
                  {!l.isLate && <span className="badge blue">即时有效</span>}
                  {l.isLate && !l.reviewed && <span className="badge amber">晚到待复核</span>}
                  {l.isLate && l.reviewed && l.reviewNote?.startsWith('复核通过') && (
                    <span className="badge green">复核通过</span>
                  )}
                  {l.isLate && l.reviewed && l.reviewNote?.startsWith('复核驳回') && (
                    <span className="badge red">复核驳回</span>
                  )}
                  {l.batchNo && <div className="muted mono" style={{ fontSize: 11 }}>{l.batchNo}</div>}
                </td>
              </tr>
            ))}
            {fault.logs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  暂无日志，请使用上方按钮模拟上传
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>乘客行程与差价处理</h2>
        <p className="muted">
          客服核对乘客行程后补登缺失记录；故障期间按最高票价 ¥6.00 预收，补登生成支付回执，核对后退差价。
          <b> 一趟行程最多退款一次</b>。
        </p>
        {fault.trips.map((t) => (
          <TripBox
            key={t.id}
            trip={t}
            disabled={busy || ticket.status === 'CLOSED'}
            onAction={run}
          />
        ))}
        {fault.trips.length === 0 && <div className="muted">暂无行程（上传有效日志后自动生成）</div>}
      </div>

      {notice && <div className="msg ok">{notice}</div>}
      {error && <div className="msg err">{error}</div>}
    </>
  );
}

function simText(r: UploadResult) {
  return `接收 ${r.received} 条，新记录 ${r.acceptedCount} 条，重复拦截 ${r.duplicateCount} 条，晚到待复核 ${r.latePendingCount} 条${
    r.note ? `（${r.note}）` : ''
  }`;
}

/* ---------------- 维修工单面板 ---------------- */

function RepairPanel({
  fault,
  busy,
  onAction,
}: {
  fault: Fault;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>, ok: string) => Promise<unknown>;
}) {
  const [repairedBy, setRepairedBy] = useState('维修员-01');
  const [repairNote, setRepairNote] = useState('');
  const closed = fault.status === 'REPAIR_CLOSED';

  return (
    <div className="card" style={closed ? { borderColor: '#86d5a3' } : { borderColor: '#f0a5a5' }}>
      <div className="panel-head">
        <h2>🔧 维修工单</h2>
        {closed ? (
          <span className="badge green">维修已结案</span>
        ) : (
          <span className="badge red">告警中 · 看板持续提示</span>
        )}
      </div>
      <dl className="kv">
        <dt>状态</dt>
        <dd>{closed ? '设备已恢复，告警已从看板撤下' : '等待维修员确认修复'}</dd>
        {closed && (
          <>
            <dt>维修员</dt>
            <dd>{fault.repairedBy}</dd>
            <dt>修复时间</dt>
            <dd>{fmtTime(fault.repairedAt)}</dd>
            <dt>维修记录</dt>
            <dd>{fault.repairNote || '—'}</dd>
          </>
        )}
      </dl>
      {!closed && (
        <>
          <label>维修处理记录</label>
          <textarea
            placeholder="如：更换主控板，连续刷卡 20 次测试正常"
            value={repairNote}
            onChange={(e) => setRepairNote(e.target.value)}
          />
          <label>维修员</label>
          <input value={repairedBy} onChange={(e) => setRepairedBy(e.target.value)} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              className="btn green"
              disabled={busy}
              onClick={() =>
                onAction(
                  () => api.repairClose(fault.id, { repairedBy, repairNote }),
                  '维修工单已结案（不影响票务工单）',
                )
              }
            >
              确认修复并结案
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            维修结案只关闭维修侧；乘客行程与退款由右侧票务工单独立处理。
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------- 票务工单面板 ---------------- */

function TicketPanel({
  fault,
  busy,
  onAction,
}: {
  fault: Fault;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>, ok: string) => Promise<unknown>;
}) {
  const [operator, setOperator] = useState('客服-01');
  const [closeNote, setCloseNote] = useState('');
  const ticket = fault.ticketCase!;
  const closed = ticket.status === 'CLOSED';
  const pending = fault.trips.filter((t) => t.status === 'MISSING').length;

  return (
    <div className="card" style={closed ? { borderColor: '#86d5a3' } : { borderColor: '#f3cf8a' }}>
      <div className="panel-head">
        <h2>🎫 票务工单</h2>
        {closed ? <span className="badge green">票务已结案</span> : <span className="badge amber">客服处理中</span>}
      </div>
      <dl className="kv">
        <dt>缺失行程</dt>
        <dd>{fault.trips.length} 段（待补登 {pending} 段）</dd>
        <dt>已退款</dt>
        <dd>{fault.trips.filter((t) => t.refund).length} 笔</dd>
        {closed && (
          <>
            <dt>结案客服</dt>
            <dd>{ticket.closedBy}</dd>
            <dt>结案时间</dt>
            <dd>{fmtTime(ticket.closedAt)}</dd>
            <dt>结案备注</dt>
            <dd>{ticket.closeNote || '—'}</dd>
          </>
        )}
      </dl>
      {!closed && (
        <>
          <label>结案备注</label>
          <input
            placeholder="如：2 名乘客行程已补登，差价已退"
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
          />
          <label>客服工号</label>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                onAction(
                  () =>
                    api.closeTicket(ticket.id, {
                      operator,
                      closeNote,
                      force: pending === 0 ? undefined : window.confirm(
                        `尚有 ${pending} 段缺失行程未补登。确认无乘客主张、强制结案？`,
                      ),
                    }),
                  '票务工单已结案（不影响设备告警看板）',
                )
              }
            >
              结案票务工单
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {pending > 0
              ? `尚有 ${pending} 段缺失行程未处理，默认不能结案。`
              : '票务结案不改变维修工单状态；闸机未修复前仍保留在告警看板。'}
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------- 晚到日志复核行 ---------------- */

function LateReview({
  log,
  busy,
  onReviewed,
}: {
  log: Fault['logs'][number];
  busy: boolean;
  onReviewed: () => void;
}) {
  const [note, setNote] = useState('');
  const [reviewer, setReviewer] = useState('客服-01');
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #c2d3ec' }}>
      <div>
        <span className="mono">{log.cardId}</span> · {log.eventType === 'ENTRY' ? '进站' : '出站'} ·{' '}
        {log.station} · {fmtTime(log.eventTime)}
      </div>
      <div className="row-actions" style={{ marginTop: 6 }}>
        <input style={{ maxWidth: 130 }} placeholder="复核人" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        <input style={{ maxWidth: 240 }} placeholder="复核意见" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="btn sm green"
          disabled={busy}
          onClick={async () => {
            await api.reviewLog(log.id, { approve: true, reviewNote: note, reviewer });
            onReviewed();
          }}
        >
          复核通过
        </button>
        <button
          className="btn sm danger"
          disabled={busy}
          onClick={async () => {
            await api.reviewLog(log.id, { approve: false, reviewNote: note || '不予认可', reviewer });
            onReviewed();
          }}
        >
          驳回
        </button>
      </div>
    </div>
  );
}

/* ---------------- 行程处理卡片 ---------------- */

function TripBox({
  trip,
  disabled,
  onAction,
}: {
  trip: Fault['trips'][number];
  disabled: boolean;
  onAction: (fn: () => Promise<unknown>, ok: string) => Promise<unknown>;
}) {
  const [operator, setOperator] = useState('客服-01');
  const [exitStation, setExitStation] = useState(STATIONS[3]);
  const [entryStation, setEntryStation] = useState(STATIONS[0]);

  const needsExit = !trip.exitStation;
  const needsEntry = !trip.entryStation;
  const diff = trip.receipt ? trip.receipt.amountCharged - trip.receipt.correctAmount : 0;

  return (
    <div className="trip-box">
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <div>
          <b className="mono">{trip.cardId}</b>{' '}
          {trip.status === 'MISSING' && <span className="badge amber">缺失待补登</span>}
          {trip.status === 'REGISTERED' && <span className="badge blue">已补登待退款</span>}
          {trip.status === 'REFUNDED' && <span className="badge green">已退差价（完结）</span>}
        </div>
        <div className="muted">
          {trip.entryStation ?? '？'} → {trip.exitStation ?? '？'} · 应收{' '}
          {trip.correctFare > 0 ? yuan(trip.correctFare) : '—'}
        </div>
      </div>

      <table style={{ marginTop: 6 }}>
        <tbody>
          <tr>
            <td style={{ width: 90 }}>进站记录</td>
            <td>
              {trip.entryLog
                ? `${fmtTime(trip.entryLog.eventTime)} @ ${trip.entryStation}（日志有效）`
                : '缺失'}
            </td>
          </tr>
          <tr>
            <td>出站记录</td>
            <td>
              {trip.exitLog
                ? `${fmtTime(trip.exitLog.eventTime)} @ ${trip.exitStation}（日志有效）`
                : '缺失'}
              {trip.manualExitNote && <span className="badge gray" style={{ marginLeft: 8 }}>{trip.manualExitNote}</span>}
            </td>
          </tr>
          {trip.receipt && (
            <tr>
              <td>支付回执</td>
              <td>
                <span className="mono">{trip.receipt.receiptNo}</span> · 预收{' '}
                {yuan(trip.receipt.amountCharged)}，应收 {yuan(trip.receipt.correctAmount)}，应退差价{' '}
                <b>{yuan(diff)}</b> ·{' '}
                {trip.receipt.status === 'REFUNDED' ? (
                  <span className="badge green">已退</span>
                ) : (
                  <span className="badge amber">未退</span>
                )}
              </td>
            </tr>
          )}
          {trip.refund && (
            <tr>
              <td>退款记录</td>
              <td>
                已退 <b>{yuan(trip.refund.amount)}</b> · 操作人 {trip.refund.operator} ·{' '}
                {trip.refund.reason}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {trip.status === 'MISSING' && (
        <div className="row-actions" style={{ marginTop: 8 }}>
          {needsEntry && (
            <>
              <span className="muted">补登进站：</span>
              <select style={{ maxWidth: 140 }} value={entryStation} onChange={(e) => setEntryStation(e.target.value)}>
                {STATIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </>
          )}
          {needsExit && (
            <>
              <span className="muted">补登出站：</span>
              <select style={{ maxWidth: 140 }} value={exitStation} onChange={(e) => setExitStation(e.target.value)}>
                {STATIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </>
          )}
          <input style={{ maxWidth: 130 }} placeholder="客服工号" value={operator} onChange={(e) => setOperator(e.target.value)} />
          <button
            className="btn sm"
            disabled={disabled}
            onClick={() =>
              onAction(
                () =>
                  api.registerTrip(trip.id, {
                    operator,
                    entryStation: needsEntry ? entryStation : undefined,
                    exitStation: needsExit ? exitStation : undefined,
                  }),
                '行程已补登，支付回执已生成',
              )
            }
          >
            核对并补登
          </button>
        </div>
      )}

      {trip.status === 'REGISTERED' && trip.receipt && diff > 0 && (
        <div className="row-actions" style={{ marginTop: 8 }}>
          <input style={{ maxWidth: 130 }} placeholder="客服工号" value={operator} onChange={(e) => setOperator(e.target.value)} />
          <button
            className="btn sm green"
            disabled={disabled}
            onClick={() => onAction(() => api.refund(trip.id, { operator }), `已退还差价 ${yuan(diff)}`)}
          >
            退还差价 {yuan(diff)}
          </button>
        </div>
      )}
      {trip.status === 'REFUNDED' && (
        <div className="muted" style={{ marginTop: 6 }}>
          该趟行程已完成退款，重复退款请求会被系统拒绝（一趟行程最多退款一次）。
        </div>
      )}
    </div>
  );
}
