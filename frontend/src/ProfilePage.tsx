import { useEffect, useState } from 'react';

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
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<Profile>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(async response => {
      if (response.status === 401) return;
      if (!response.ok) throw new Error('Не удалось проверить вход. Повторите позже.');
      const current = await response.json();
      const saved = await api('/profile');
      if (active) { setProfile(saved); setUser(current.email); }
    }).catch(error => { if (active) setMessage(String(error.message)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function authenticate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const current = await api('/auth/' + mode, 'POST', { email, password });
      setPassword('');
      const saved = await api('/profile');
      setProfile(saved); setUser(current.email);
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
    try { await api('/auth/logout', 'POST'); setUser(null); setProfile(empty); }
    catch { setMessage('Не удалось выйти. Повторите попытку.'); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Проверяем вход…</p>;
  return <section className="placeholder profile-page"><span className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span>
    <h1>{user ? 'Ваш профиль' : mode === 'login' ? 'Вход' : 'Создать аккаунт'}</h1>
    {message && <p role="status">{message}</p>}
    {user ? <><p>{user}</p><form onSubmit={save}>
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
