import { useCallback, useEffect, useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { RegisterFaultPage } from './pages/RegisterFaultPage';
import { FaultDetailPage } from './pages/FaultDetailPage';

type Route = { name: 'dashboard' } | { name: 'register' } | { name: 'detail'; id: string };

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });

  const go = useCallback((r: Route) => {
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);

  // 浏览器前进后退
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(location.search).get('fault');
      setRoute(id ? { name: 'detail', id } : { name: 'dashboard' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openFault = (id: string) => {
    history.pushState(null, '', `?fault=${id}`);
    go({ name: 'detail', id });
  };

  return (
    <>
      <header className="topbar">
        <h1>🚇 闸机故障票务补登系统</h1>
        <nav>
          <button
            className={route.name === 'dashboard' ? 'active' : ''}
            onClick={() => {
              history.pushState(null, '', '/');
              go({ name: 'dashboard' });
            }}
          >
            设备告警看板
          </button>
          <button
            className={route.name === 'register' || route.name === 'detail' ? 'active' : ''}
            onClick={() => go({ name: 'register' })}
          >
            故障登记 / 工单受理
          </button>
        </nav>
      </header>
      <main>
        {route.name === 'dashboard' && <DashboardPage onOpen={openFault} />}
        {route.name === 'register' && (
          <RegisterFaultPage onRegistered={openFault} onCancel={() => go({ name: 'dashboard' })} />
        )}
        {route.name === 'detail' && (
          <FaultDetailPage faultId={route.id} onBack={() => go({ name: 'dashboard' })} />
        )}
      </main>
    </>
  );
}
