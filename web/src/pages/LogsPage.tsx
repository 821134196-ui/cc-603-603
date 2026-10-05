import { useEffect, useState } from 'react';
import { api, fmtTime, post } from '../api';
import type { GateLog, Meta } from '../types';

interface UploadResult {
  duplicated: boolean;
  tripsCreated: number;
  duplicatesSkipped: number;
  lateTrips: number;
  message?: string;
}

// 日志模拟：本地生成闸机日志并上传；同一段日志可重复上传以验证幂等（只形成一次有效记录）。
export default function LogsPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [logs, setLogs] = useState<GateLog[]>([]);
  const [gateCode, setGateCode] = useState('');
  const [count, setCount] = useState(6);
  const [missingExit, setMissingExit] = useState(3);
  const [lastPayload, setLastPayload] = useState<any>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [m, l] = await Promise.all([api<Meta>('/meta'), api<GateLog[]>('/logs')]);
    setMeta(m);
    setLogs(l);
    if (!gateCode && m.gates.length) setGateCode(m.gates[0].code);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const simulate = async () => {
    setError('');
    try {
      const res = await post<{ payload: any; result: UploadResult }>('/logs/simulate', {
        gateCode,
        count,
        missingExit,
      });
      setLastPayload(res.payload);
      setResult(res.result);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reupload = async () => {
    setError('');
    try {
      const res = await post<UploadResult>('/logs/upload', lastPayload);
      setResult(res);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <section className="card">
        <h2>闸机日志模拟上传</h2>
        <p className="muted">
          日志与支付回执均在本地模拟。同一段日志重复上传只会形成一次有效记录；故障时间窗内晚到的记录会进入「待复核」。
        </p>
        <div className="form-row">
          <label>
            闸机
            <select value={gateCode} onChange={(e) => setGateCode(e.target.value)}>
              {meta?.gates.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code} · {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            记录条数
            <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(+e.target.value)} />
          </label>
          <label>
            其中缺出站
            <input type="number" min={0} max={count} value={missingExit} onChange={(e) => setMissingExit(+e.target.value)} />
          </label>
          <button className="primary" onClick={simulate}>
            模拟生成并上传
          </button>
          <button disabled={!lastPayload} onClick={reupload} title="用完全相同的报文再次上传">
            重复上传同一日志
          </button>
        </div>
        {error && <div className="banner error">⚠ {error}</div>}
        {result && (
          <div className={result.duplicated ? 'banner warn' : 'banner ok'}>
            {result.duplicated ? '🔁 重复上传被拦截' : '✓ 上传成功'}：新增行程 {result.tripsCreated} 条，去重跳过{' '}
            {result.duplicatesSkipped} 条，晚到待复核 {result.lateTrips} 条{result.message ? `。${result.message}` : ''}
          </div>
        )}
      </section>

      <table className="table">
        <thead>
          <tr>
            <th>日志哈希</th>
            <th>闸机</th>
            <th>记录数</th>
            <th>上传时间</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>
                <code>{l.contentHash.slice(0, 16)}…</code>
              </td>
              <td>
                {l.gate.code} · {l.gate.name}
              </td>
              <td>{l.recordCount}</td>
              <td>{fmtTime(l.uploadedAt)}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                暂无日志
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
