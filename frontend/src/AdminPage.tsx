import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

type User = { id: string; email: string; is_admin: boolean; is_blocked: boolean };
type UserList = { items: User[]; total: number; offset: number; limit: number };
type Detail = { user: User; profile: { full_name: string; target_role: string; education: string; about: string } | null; active_sessions: number };
type Audit = { id: string; actor_id: string; target_id: string; action: string; reason: string; created_at: string; actor_email: string; target_email: string };
async function request<T>(path: string, body?: object): Promise<T> {
  const result = await fetch('/api/admin' + path, {
    method: body ? 'PATCH' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!result.ok) {
    const data = await result.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось выполнить запрос');
  }
  return result.json();
}

function UserManager() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [users, setUsers] = useState<UserList | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([request<UserList>(`/users?q=${encodeURIComponent(query)}&offset=${offset}&limit=20`), request<Audit[]>('/events')])
      .then(([result, events]) => { if (active) { setUsers(result); setAudit(events); } })
      .catch(error => { if (active) { setMessage(error.message); setUsers(null); setAudit([]); } })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [query, offset, revision]);

  async function selectUser(id: string) {
    setBusy(true); setMessage(''); setDetail(null); setReason('');
    try { setDetail(await request<Detail>('/users/' + id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  async function changeStatus(event: React.FormEvent) {
    event.preventDefault(); if (!detail) return;
    setBusy(true); setMessage('');
    try {
      await request('/users/' + detail.user.id + '/block', { blocked: !detail.user.is_blocked, reason });
      setDetail(await request<Detail>('/users/' + detail.user.id));
      setReason(''); setMessage('Статус пользователя обновлён'); setRevision(r => r + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  return <section className="admin-page"><span className="eyebrow">УПРАВЛЕНИЕ</span><h1>Пользователи</h1>
    {message && <p role="status">{message}</p>}
    <form className="admin-search" onSubmit={event => { event.preventDefault(); setListLoading(true); setDetail(null); setReason(''); setQuery(search.trim()); setOffset(0); setRevision(r => r + 1); }}>
      <label>Поиск по email<input value={search} maxLength={120} onChange={e => setSearch(e.target.value)} /></label>
      <button className="button" disabled={busy || listLoading}>Найти</button>
    </form>
    {listLoading && <p role="status">Загружаем пользователей…</p>}
    {users && !listLoading && <><p>Всего найдено: {users.total}</p><div className="table-scroll"><table><thead><tr><th>Email</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>
      {users.items.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.is_admin ? 'Администратор' : 'Пользователь'}</td><td>{user.is_blocked ? 'Заблокирован' : 'Активен'}</td><td><button className="button secondary" disabled={busy} onClick={() => void selectUser(user.id)}>Открыть {user.email}</button></td></tr>)}
    </tbody></table></div>{users.items.length === 0 && <p>Пользователи не найдены</p>}
      <div className="admin-pagination"><button disabled={offset === 0 || busy} onClick={() => { setListLoading(true); setOffset(Math.max(0, offset - 20)); }}>Назад</button><span>{users.total ? offset + 1 : 0}–{Math.min(offset + users.items.length, users.total)} из {users.total}</span><button disabled={offset + 20 >= users.total || busy} onClick={() => { setListLoading(true); setOffset(offset + 20); }}>Далее</button></div>
    </>}
    {detail && <section className="profile-page admin-detail"><h2>{detail.user.email}</h2><p>{detail.user.is_blocked ? 'Заблокирован' : 'Активен'} · Активных сессий: {detail.active_sessions}</p>
      <dl><dt>Имя</dt><dd>{detail.profile?.full_name || 'Не заполнено'}</dd><dt>Желаемая должность</dt><dd>{detail.profile?.target_role || 'Не заполнено'}</dd><dt>Образование</dt><dd>{detail.profile?.education || 'Не заполнено'}</dd><dt>О себе и проектах</dt><dd>{detail.profile?.about || 'Не заполнено'}</dd></dl>
      {detail.user.is_admin ? <p>Блокировка администратора недоступна.</p> : <form onSubmit={changeStatus}>
        <label>Причина изменения<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        {!detail.user.is_blocked && <p>При блокировке все текущие сессии пользователя будут отозваны.</p>}
        <button className="button" disabled={busy || reason.trim().length < 3}>{detail.user.is_blocked ? 'Разблокировать пользователя' : 'Заблокировать пользователя'}</button>
      </form>}
    </section>}
    <section className="admin-audit"><h2>Последние действия</h2>{audit.length === 0 && <p>Действий пока нет</p>}
      {audit.map(item => <div key={item.id}><time>{new Date(item.created_at).toLocaleString('ru')}</time><strong>{{ block: 'Блокировка', unblock: 'Разблокировка', operator_grant_admin: 'Назначение администратора' }[item.action] ?? item.action}</strong><p>{item.reason}</p><small>Исполнитель: {item.actor_email} · Пользователь: {item.target_email}</small></div>)}
    </section>
  </section>;
}

export function AdminPage() {
  const [access, setAccess] = useState<'loading' | 'admin' | 'denied' | 'login' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(async response => {
      if (response.status === 401) { if (active) setAccess('login'); return; }
      if (!response.ok) throw new Error('failed');
      const user = await response.json();
      if (active) setAccess(user.is_admin ? 'admin' : 'denied');
    }).catch(() => { if (active) setAccess('error'); });
    return () => { active = false; };
  }, []);
  if (access === 'admin') return <UserManager />;
  return <section className="placeholder"><h1>Панель администратора</h1>
    <p role="status">{access === 'loading' ? 'Проверяем права…' : access === 'login' ? 'Войдите в аккаунт администратора.' : access === 'denied' ? 'Доступ разрешён только администратору.' : 'Не удалось проверить права. Обновите страницу.'}</p>
    {access !== 'loading' && <Link className="button" to="/profile">Перейти в профиль</Link>}
  </section>;
}
