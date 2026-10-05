import { useEffect, useState } from 'react';
import { api, DashboardOverview } from '../api';
import { fmtTime } from '../format';

export function DashboardPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api
      .dashboard()
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // 5s 轮询，模拟看板实时性
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="msg err">看板加载失败：{error}（后端是否已启动？）</div>;
  if (!data) return <div className="muted">加载中…</div>;

  return (
    <>
      <div className="stat-row">
        <div className="stat alert">
          <div className="num">{data.alertCount}</div>
          <div className="label">设备告警闸机（维修未确认完成）</div>
        </div>
        <div className="stat ticket">
          <div className="num">{data.openTicketCount}</div>
          <div className="label">处理中票务工单</div>
        </div>
        <div className="stat refund">
          <div className="num">{data.pendingRefundCount}</div>
          <div className="label">待退差价行程</div>
        </div>
      </div>

      <div className="card">
        <h2>设备异常提示</h2>
        <p className="muted">
          看板仅依据<b>维修工单</b>状态：只有维修员确认修复后，告警才会消失；票务工单是否结案不影响看板。
        </p>
        {data.alertGates.length === 0 ? (
          <div className="msg ok">当前无设备告警，所有闸机运行正常。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>闸机</th>
                <th>站点</th>
                <th>故障时间</th>
                <th>故障描述</th>
                <th>登记站务</th>
                <th>票务工单</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.alertGates.flatMap((g) =>
                g.activeFaults.map((f) => (
                  <tr key={f.faultId} className="clickable" onClick={() => onOpen(f.faultId)}>
                    <td className="mono">{g.gateCode}</td>
                    <td>{g.station}</td>
                    <td>{fmtTime(f.occurredAt)}</td>
                    <td>{f.description}</td>
                    <td>{f.stationAgent}</td>
                    <td>
                      {f.ticketStatus === 'CLOSED' ? (
                        <span className="badge green">票务已结案</span>
                      ) : (
                        <span className="badge amber">票务处理中</span>
                      )}
                      <div className="muted" style={{ fontSize: 12 }}>
                        （票务状态不影响本告警）
                      </div>
                    </td>
                    <td>
                      <span className="badge red">维修告警中</span>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
