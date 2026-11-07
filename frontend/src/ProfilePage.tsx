import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

interface Profile { full_name: string; target_role: string; education: string; about: string }
const empty: Profile = { full_name: '', target_role: '', education: '', about: '' };
async function api(path: string, method = 'GET', body?: object) {
  const response = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Проверьте заполнение полей и повторите попытку.');
  }
  return response.status === 204 ? null : response.json();
}

export function ProfilePage() {
  const [user, setUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<Profile>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function checkSession() {
      // Only this read is retried. Never repeat registration or login automatically.
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const response = await fetch('/api/auth/me', {
            credentials: 'same-origin',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          });
          if (response.status === 401) return null;
          if (!response.ok) {
            if (![502, 503, 504].includes(response.status)) throw new Error('session-check-failed');
            throw new TypeError('temporary-unavailable');
          }
          return await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (attempt === 7 || (error instanceof Error && error.message === 'session-check-failed')) {
            throw new Error('Сервер пока недоступен. Повторите проверку входа.', { cause: error });
          }
          if (active) setRetrying(true);
          await new Promise<void>(resolve => setTimeout(resolve, 10000));
          if (controller.signal.aborted) throw error;
        }
      }
    }
    checkSession().then(async current => {
      if (!current) return;
      const saved = await api('/profile');
      if (active) { setProfile(saved); setUser(current.email); setIsAdmin(current.is_admin === true); }
    }).catch(error => { if (active) setMessage(String(error.message)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [checkAttempt]);

  async function authenticate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const current = await api('/auth/' + mode, 'POST', { email, password });
      setPassword('');
      const saved = await api('/profile');
      setProfile(saved); setUser(current.email); setIsAdmin(current.is_admin === true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { setProfile(await api('/profile', 'PATCH', profile)); setMessage('Профиль сохранён'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setMessage('');
    try { await api('/auth/logout', 'POST'); setUser(null); setProfile(empty); setIsAdmin(false); }
    catch { setMessage('Не удалось выйти. Повторите попытку.'); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">{retrying ? 'Ожидаем ответа сервера… После простоя запуск может занять около минуты.' : 'Проверяем вход…'}</p>;
  return <section className="placeholder profile-page"><span className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span>
    <h1>{user ? 'Ваш профиль' : mode === 'login' ? 'Вход' : 'Создать аккаунт'}</h1>
    {message && <p role="status">{message}</p>}
    {!user && message && <button className="button secondary" onClick={() => { setLoading(true); setRetrying(false); setMessage(''); setCheckAttempt(value => value + 1); }}>Повторить проверку входа</button>}
    {user ? <><p>{user}</p>{isAdmin && <Link className="button secondary" to="/admin">Панель администратора</Link>}<form onSubmit={save}>
      <label>Имя<input value={profile.full_name} maxLength={120} onChange={e => setProfile({ ...profile, full_name: e.target.value })} /></label>
      <label>Желаемая должность<input value={profile.target_role} maxLength={120} onChange={e => setProfile({ ...profile, target_role: e.target.value })} /></label>
      <label>Образование<textarea value={profile.education} maxLength={3000} onChange={e => setProfile({ ...profile, education: e.target.value })} /></label>
      <label>О себе и проектах<textarea value={profile.about} maxLength={5000} onChange={e => setProfile({ ...profile, about: e.target.value })} /></label>
      <button className="button" disabled={busy}>Сохранить профиль</button>
    </form><button className="button secondary" disabled={busy} onClick={() => void logout()}>Выйти</button></> : <>
      <form onSubmit={authenticate}>
        <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Пароль<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <small>От 12 до 128 символов. Для учебной версии используйте отдельный пароль.</small>
        <button className="button" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
      </form>
      <button className="button secondary" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(''); setPassword(''); }}>{mode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт'}</button>
    </>}
  </section>;
}
