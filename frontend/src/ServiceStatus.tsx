import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth, getReadiness } from './api';

type State = 'loading' | 'ready' | 'error';
const labels = { loading: 'Проверяем…', ready: 'Доступен', error: 'Нет соединения' };

export function ServiceStatus() {
  const [api, setApi] = useState<State>('loading');
  const [db, setDb] = useState<State>('loading');
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 10000);
    await Promise.all([
      getHealth(request.signal).then(() => { if (controller.current === request) setApi('ready'); })
        .catch(() => { if (controller.current === request) setApi('error'); }),
      getReadiness(request.signal).then(() => { if (controller.current === request) setDb('ready'); })
        .catch(() => { if (controller.current === request) setDb('error'); }),
    ]);
    clearTimeout(timeout);
  }, []);
  useEffect(() => {
    void check();
    return () => { controller.current?.abort(); controller.current = null; };
  }, [check]);

  return <section className="status-panel" aria-label="Состояние сервисов">
    <div><span className="eyebrow">СОЕДИНЕНИЕ</span><h2>Основа готова к работе</h2></div>
    <div className="service-list" aria-live="polite">
      <span>API <strong className={`badge ${api}`}>{labels[api]}</strong></span>
      <span>PostgreSQL <strong className={`badge ${db}`}>{labels[db]}</strong></span>
    </div>
    {(api === 'error' || db === 'error') && <p className="hint">Сервис может запускаться. Проверьте подключение и повторите попытку.</p>}
    <button className="button secondary" onClick={() => { setApi('loading'); setDb('loading'); void check(); }}>Проверить снова</button>
  </section>;
}
