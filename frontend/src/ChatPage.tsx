import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { complete, interviewPrompt, listModels, type Connection, type Message } from './llm';

type Turn = { id: string; prompt: string; reply: string | null; created_at: string };
async function api<T>(path = '', body?: object, method = 'POST'): Promise<T> {
  const result = await fetch('/api/chat' + path, { credentials: 'same-origin', method: body ? method : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (result.status === 401) throw new Error('Войдите в аккаунт, чтобы сохранять интервью.');
  if (!result.ok) { const data = await result.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось сохранить сообщение. Повторите запрос.'); }
  return result.json();
}
export function ChatPage() {
  const [config, setConfig] = useState<Connection>({ kind: 'ollama', base: 'http://127.0.0.1:11434', model: '', key: '' });
  const [models, setModels] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [unsaved, setUnsaved] = useState<{ id: string; reply: string } | null>(null);
  const [pendingSend, setPendingSend] = useState<{ id: string; prompt: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    api<Turn[]>().then(rows => { if (active) { setTurns(rows); setReady(true); } })
      .catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; abort.current?.abort(); };
  }, []);
  function update(change: Partial<Connection>) { setConfig(c => ({ ...c, ...change })); setModels([]); setNotice(''); setConsent(false); }
  async function check() {
    setBusy(true); setError(''); setNotice('');
    try { const names = await listModels(config); setModels(names); setConfig(c => ({ ...c, model: names.includes(c.model) ? c.model : names[0] ?? '' })); setNotice(names.length ? 'Соединение установлено. Выберите модель.' : 'Соединение установлено, но модели не найдены. Загрузите модель на сервере.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  async function run(event?: React.FormEvent) {
    event?.preventDefault(); if (busy || !ready || !consent) return;
    setBusy(true); setError(''); setNotice('');
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      if (unsaved) {
        const saved = await api<Turn>('/' + unsaved.id, { reply: unsaved.reply }, 'PATCH');
        setTurns(rows => rows.map(row => row.id === saved.id ? saved : row)); setUnsaved(null); return;
      }
      let history = turns;
      let pending = history.find(row => row.reply === null);
      if (!pending) {
        if (!text.trim()) return;
        const data = pendingSend ?? { id: crypto.randomUUID(), prompt: text.trim() };
        setPendingSend(data);
        pending = await api<Turn>('', data);
        setPendingSend(null);
        history = [...history, pending]; setTurns(history); setText('');
      }
      const messages: Message[] = [{ role: 'system', content: interviewPrompt }];
      for (const row of history.slice(-20)) {
        messages.push({ role: 'user', content: row.prompt });
        if (row.reply) messages.push({ role: 'assistant', content: row.reply });
      }
      const reply = await complete(config, messages, controller.signal);
      const answer = { id: pending.id, reply }; setUnsaved(answer);
      const saved = await api<Turn>('/' + pending.id, { reply }, 'PATCH');
      setTurns(rows => rows.map(row => row.id === saved.id ? saved : row)); setUnsaved(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка подключения'); }
    finally { clearTimeout(timer); abort.current = null; setBusy(false); }
  }
  const pending = turns.some(row => row.reply === null);
  return <section className="profile-page chat-page"><span className="eyebrow">ЗНАКОМСТВО</span><h1>Карьерное интервью</h1>
    <p>Расскажите, где учитесь и какие проекты делали. Агент поможет уточнить ваш опыт. История сохраняется в аккаунте; профиль пока редактируется отдельно.</p>
    {loading && <p role="status">Загружаем историю…</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!ready && !loading && <><Link to="/profile">Войти в аккаунт</Link><p>После входа или восстановления соединения обновите эту страницу.</p></>}
    <fieldset disabled={busy || !!unsaved}><legend>Подключение модели</legend>
      <label>Режим<select value={config.kind} onChange={e => { const kind = e.target.value as Connection['kind']; update({ kind, base: kind === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.example.com/v1', model: '', key: '' }); setConsent(false); }}><option value="ollama">Ollama на моём компьютере</option><option value="api">Совместимый API (прямой запрос)</option></select></label>
      <label>Адрес сервера<input value={config.base} maxLength={500} onChange={e => update({ base: e.target.value })} /></label>
      {config.kind === 'api' && <label>API-ключ<input type="password" autoComplete="off" value={config.key} maxLength={1000} onChange={e => update({ key: e.target.value })} /></label>}
      <button className="button secondary" onClick={() => void check()}>Проверить подключение</button>
      <label>Модель<input list="llm-models" value={config.model} maxLength={200} onChange={e => setConfig(c => ({ ...c, model: e.target.value }))} /></label><datalist id="llm-models">{models.map(name => <option key={name} value={name} />)}</datalist>
      <p>{config.kind === 'ollama' ? 'Запустите Ollama с опубликованным портом и разрешите CORS для адреса нашего сайта. Модель вызывается вашим браузером.' : 'Укажите адрес совместимого API с окончанием /v1. Провайдер должен разрешать запросы браузера (CORS). Ключ хранится только в памяти вкладки.'}</p>
      <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Разрешаю отправлять последние 20 пар сообщений интервью на выбранный сервер модели. История хранится в моём аккаунте Career Agent.</label>
    </fieldset>
    <div className="chat-history" aria-label="История интервью">{turns.length === 0 && ready && <p>Начните с рассказа о себе или напишите «Помоги определить мои интересы».</p>}{turns.map(row => <div key={row.id}><article><strong>Вы</strong><p>{row.prompt}</p></article><article><strong>Агент</strong><p>{row.reply ?? (unsaved?.id === row.id ? unsaved.reply : 'Ответ ещё не получен. Можно повторить запрос.')}</p></article></div>)}</div>
    {busy && <p role="status">Ожидаем ответ и сохраняем сообщения…</p>}
    <form onSubmit={event => void run(event)}>
      {!pending && !unsaved && <label>Ваше сообщение<textarea required maxLength={4000} value={text} disabled={busy || !ready || !!pendingSend} onChange={e => setText(e.target.value)} /></label>}
      <button className="button" disabled={busy || !ready || !consent || (!unsaved && !config.model.trim())}>{unsaved ? 'Сохранить полученный ответ' : pending ? 'Повторить получение ответа' : 'Отправить'}</button>
      {busy && <button className="button secondary" type="button" onClick={() => abort.current?.abort()}>Остановить ожидание модели</button>}
    </form>
  </section>;
}
