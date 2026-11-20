import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { extractionMessages, parseFacts, profileApi, type Item } from './facts';
import { complete, groqBase, groqModel, interviewPrompt, listModels, type Connection, type Message } from './llm';

type Turn = { id: string; prompt: string; reply: string | null; created_at: string; facts_checked?: boolean };
type Extracted = { items: Item[]; skipped: { index: number; reason: string }[]; already_processed: boolean };
function factSummary(result: Extracted) {
  const found = result.items.length;
  const unconfirmed = result.skipped.filter(row => row.reason === 'evidence').length;
  const main = found ? `Найдено фактов: ${found}. Проверьте и подтвердите их в профиле.` : 'Новых фактов для профиля в этом сообщении нет.';
  return unconfirmed ? `${main} Не подтверждено цитатой и пропущено: ${unconfirmed}.` : main;
}
class SignInRequired extends Error {}
async function api<T>(path = '', body?: object, method = 'POST', signal?: AbortSignal): Promise<T> {
  let result: Response;
  try {
    result = await fetch('/api/chat' + path, { credentials: 'same-origin', method: body ? method : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: signal ?? AbortSignal.timeout(30000) });
  } catch (error) { throw new Error('Сервер интервью не ответил. Повторите проверку входа и истории.', { cause: error }); }
  if (result.status === 401) throw new SignInRequired('Войдите в аккаунт Career Agent, чтобы сохранять интервью. API-ключ модели не заменяет вход в приложение.');
  if (result.status >= 500) throw new Error('Сервер интервью временно недоступен. Повторите проверку входа и истории позже.');
  if (!result.ok) { const data = await result.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось сохранить сообщение. Повторите запрос.'); }
  return result.json();
}
export function ChatPage() {
  const [config, setConfig] = useState<Connection>({ kind: 'ollama', base: 'http://127.0.0.1:11434', model: '', key: '' });
  const [provider, setProvider] = useState<'groq' | 'custom'>('groq');
  const [models, setModels] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [unsaved, setUnsaved] = useState<{ id: string; reply: string } | null>(null);
  const [pendingSend, setPendingSend] = useState<{ id: string; prompt: string } | null>(null);
  const [factNotes, setFactNotes] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    api<Turn[]>('', undefined, 'GET', controller.signal).then(rows => { if (active) { setTurns(rows); setReady(true); setHistoryError(''); setNeedsLogin(false); } })
      .catch(err => { if (active) { setReady(false); setHistoryError(err.message); setNeedsLogin(err instanceof SignInRequired); } }).finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [historyAttempt]);
  useEffect(() => () => abort.current?.abort(), []);
  function retryHistory() { setLoading(true); setHistoryAttempt(value => value + 1); }
  function update(change: Partial<Connection>) { setConfig(c => ({ ...c, ...change })); setModels([]); setNotice(''); }
  function chooseProvider(value: 'groq' | 'custom') {
    setProvider(value);
    update({ base: value === 'groq' ? groqBase : '', model: value === 'groq' ? groqModel : '', key: '' });
    setError('');
  }
  async function check() {
    setBusy(true); setError(''); setNotice('');
    try { const names = await listModels(config); setModels(names); setConfig(c => ({ ...c, model: c.model || names[0] || '' })); setNotice(names.length ? 'Список моделей получен. Выберите модель; генерация проверяется при отправке сообщения.' : 'API ответил без списка моделей. Введите название модели вручную.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  async function findFacts(turn: Turn, history: Turn[], signal: AbortSignal) {
    // A failure here never loses the saved conversation: the user can retry per message.
    try {
      const index = history.findIndex(row => row.id === turn.id);
      const question = index > 0 ? history[index - 1].reply : null;
      const facts = parseFacts(await complete(config, extractionMessages(question, turn.prompt), signal));
      const result = await profileApi<Extracted>('/items/extracted', 'POST', { turn_id: turn.id, facts });
      setTurns(rows => rows.map(row => row.id === turn.id ? { ...row, facts_checked: true } : row));
      setFactNotes(notes => ({ ...notes, [turn.id]: factSummary(result) }));
    } catch (err) {
      setFactNotes(notes => ({ ...notes, [turn.id]: 'Факты не извлечены: ' + (err instanceof Error ? err.message : 'ошибка модели') }));
    }
  }
  async function retryFacts(turn: Turn) {
    if (busy) return;
    setBusy(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 180000);
    try { await findFacts(turn, turns, controller.signal); }
    finally { clearTimeout(timer); abort.current = null; setBusy(false); }
  }
  async function run(event?: React.FormEvent) {
    event?.preventDefault(); if (busy || !ready) return;
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
      if (!saved.facts_checked) await findFacts(saved, history.map(row => row.id === saved.id ? saved : row), controller.signal);
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка подключения'); }
    finally { clearTimeout(timer); abort.current = null; setBusy(false); }
  }
  const pending = turns.some(row => row.reply === null);
  const sendHint = !ready ? 'Поле сообщения откроется после успешной проверки входа и истории.'
    : unsaved ? ''
    : !config.base.trim() ? 'Укажите адрес сервера модели.'
    : config.kind === 'api' && provider === 'groq' && !config.key.trim() ? 'Вставьте свой API-ключ Groq.'
    : !config.model.trim() ? 'Выберите модель или введите её название.' : '';
  return <section className="profile-page chat-page"><span className="eyebrow">ЗНАКОМСТВО</span><h1>Карьерное интервью</h1>
    <p>Расскажите, где учитесь и какие проекты делали. Агент поможет уточнить ваш опыт. История сохраняется в аккаунте. После ответа агент ищет в вашем сообщении навыки, проекты, опыт и образование и предлагает их в профиль — там вы подтверждаете или исправляете каждый факт.</p>
    {loading && <p role="status">Загружаем историю…</p>}
    {!ready && <div role="status"><p>{historyError || 'Чтобы открыть поле сообщения, проверяем вход в Career Agent и загружаем историю.'}</p>
      {needsLogin && <><Link to="/profile" target="_blank" rel="noreferrer">Войти в аккаунт в новой вкладке</Link><p>После входа вернитесь сюда и повторите проверку. Введённый ключ останется на этой странице.</p></>}
      {!loading && <button className="button secondary" onClick={retryHistory}>Повторить проверку входа и истории</button>}
    </div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !!unsaved}><legend>Подключение модели</legend>
      <label>Режим<select value={config.kind} onChange={e => { const kind = e.target.value as Connection['kind']; setProvider('groq'); update({ kind, base: kind === 'ollama' ? 'http://127.0.0.1:11434' : groqBase, model: kind === 'ollama' ? '' : groqModel, key: '' }); setError(''); }}><option value="ollama">Ollama на моём компьютере</option><option value="api">Совместимый API (прямой запрос)</option></select></label>
      {config.kind === 'api' && <label>Провайдер<select value={provider} onChange={e => chooseProvider(e.target.value as 'groq' | 'custom')}><option value="groq">Groq</option><option value="custom">Другой совместимый API</option></select></label>}
      <label>Адрес сервера<input value={config.base} readOnly={config.kind === 'api' && provider === 'groq'} placeholder="https://provider.example/v1" maxLength={500} onChange={e => update({ base: e.target.value, key: '' })} /></label>
      {config.kind === 'api' && <><label>API-ключ<input type="password" autoComplete="off" spellCheck={false} value={config.key} maxLength={1000} onChange={e => update({ key: e.target.value })} /></label><button className="button secondary" disabled={!config.key} onClick={() => update({ key: '' })}>Очистить ключ</button></>}
      <button className="button secondary" disabled={!config.base.trim() || (config.kind === 'api' && provider === 'groq' && !config.key.trim())} onClick={() => void check()}>Проверить подключение</button>
      <label>Модель<input list="llm-models" value={config.model} maxLength={200} onChange={e => setConfig(c => ({ ...c, model: e.target.value }))} /></label><datalist id="llm-models">{models.map(name => <option key={name} value={name} />)}</datalist>
      <p>{config.kind === 'ollama' ? 'Запустите Ollama с опубликованным портом и разрешите CORS для адреса нашего сайта. Модель вызывается вашим браузером.' : 'Используйте свой ключ провайдера. Запросы идут напрямую из браузера; ключ не передаётся нашему backend и не сохраняется в браузерном хранилище. При уходе со страницы ключ очищается.'}</p>
      {config.kind === 'api' && <><p>Поддерживается OpenAI-совместимый Chat Completions API. Укажите базовый URL, обычно с /v1, без /chat/completions. Если список моделей недоступен, введите модель вручную. Провайдер должен разрешать запросы браузера (CORS).</p>{provider === 'groq' && <p><a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Создать личный ключ Groq</a>. Лимиты относятся к вашему аккаунту Groq. Входной контекст и ответ вместе расходуют квоту токенов; история пока ограничена 20 последними парами сообщений, а не точным числом токенов.</p>}</>}
      {config.kind === 'api' && <p role="note">Каждое сообщение и переданный контекст расходуют токены и квоту вашего API. После ответа выполняется ещё один короткий запрос — поиск фактов в вашем сообщении. Стоимость зависит от тарифа провайдера.</p>}
      <p>Выбранной модели передаются последние 20 пар сообщений интервью. История хранится в вашем аккаунте Career Agent.</p>
    </fieldset>
    <div className="chat-history" aria-label="История интервью">{turns.length === 0 && ready && <p>Начните с рассказа о себе или напишите «Помоги определить мои интересы».</p>}{turns.map(row => <div key={row.id}><article><strong>Вы</strong><p>{row.prompt}</p></article><article><strong>Агент</strong><p>{row.reply ?? (unsaved?.id === row.id ? unsaved.reply : 'Ответ ещё не получен. Можно повторить запрос.')}</p></article>
      {(factNotes[row.id] || (row.reply && row.facts_checked === false)) && <div className="chat-facts" role="status">{factNotes[row.id] && <p>{factNotes[row.id]}</p>}
        {row.facts_checked && <Link to="/profile">Открыть профиль</Link>}
        {row.reply && row.facts_checked === false && <button className="button secondary" type="button" disabled={busy || !config.model.trim() || !config.base.trim() || (config.kind === 'api' && provider === 'groq' && !config.key.trim())} onClick={() => void retryFacts(row)}>Найти факты в этом сообщении</button>}</div>}</div>)}</div>
    {busy && <p role="status">Ожидаем ответ и сохраняем сообщения…</p>}
    <form onSubmit={event => void run(event)}>
      {sendHint && <p id="chat-send-help" role="status">{sendHint}</p>}
      {!pending && !unsaved && <label>Ваше сообщение<textarea required maxLength={4000} value={text} aria-describedby={sendHint ? 'chat-send-help' : undefined} disabled={busy || !ready || !!pendingSend} onChange={e => setText(e.target.value)} /></label>}
      <button className="button" aria-describedby={sendHint ? 'chat-send-help' : undefined} disabled={busy || !ready || (!unsaved && (!config.model.trim() || !config.base.trim() || (config.kind === 'api' && provider === 'groq' && !config.key.trim())))}>{unsaved ? 'Сохранить полученный ответ' : pending ? 'Повторить получение ответа' : 'Отправить'}</button>
      {busy && <button className="button secondary" type="button" onClick={() => abort.current?.abort()}>Остановить ожидание модели</button>}
    </form>
  </section>;
}
