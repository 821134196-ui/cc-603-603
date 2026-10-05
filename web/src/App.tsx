import { useState } from 'react';
import AcceptancePage from './pages/AcceptancePage';
import AlertBoard from './pages/AlertBoard';
import TripsPage from './pages/TripsPage';
import LogsPage from './pages/LogsPage';
import RefundsPage from './pages/RefundsPage';

const TABS = [
  { key: 'acceptance', label: '受理页' },
  { key: 'alerts', label: '告警看板' },
  { key: 'trips', label: '票务处理' },
  { key: 'logs', label: '日志模拟' },
  { key: 'refunds', label: '退款与回执' },
] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('acceptance');
  return (
    <div className="app">
      <header>
        <h1>🚇 地铁闸机故障票务补登系统</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'acceptance' && <AcceptancePage key="acceptance" />}
        {tab === 'alerts' && <AlertBoard key="alerts" />}
        {tab === 'trips' && <TripsPage key="trips" />}
        {tab === 'logs' && <LogsPage key="logs" />}
        {tab === 'refunds' && <RefundsPage key="refunds" />}
      </main>
    </div>
  );
}
