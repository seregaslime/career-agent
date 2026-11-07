import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

afterEach(() => vi.unstubAllGlobals());
const json = (data: object, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
it('does not request user data for an ordinary user', async () => {
  const fetch = vi.fn(() => json({ is_admin: false })); vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  await screen.findByText('Доступ разрешён только администратору.');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('asks an anonymous user to log in', async () => {
  vi.stubGlobal('fetch', vi.fn(() => json({}, 401)));
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  await screen.findByText('Войдите в аккаунт администратора.');
});
it('allows an admin to inspect and block a user with a reason', async () => {
  let blocked = false;
  const user = () => ({ id: 'member-id', email: 'member@example.com', is_admin: false, is_blocked: blocked });
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/me')) return json({ is_admin: true });
    if (url.endsWith('/events')) return json([]);
    if (url.endsWith('/block')) { blocked = true; return json(user()); }
    if (url.endsWith('/users/member-id')) return json({ user: user(), profile: { full_name: 'Студент', target_role: 'Python' }, active_sessions: blocked ? 0 : 1 });
    if (options?.method && options.method !== 'GET') throw new Error('unexpected mutation');
    return json({ items: [user()], total: 1, offset: 0, limit: 20 });
  });
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Открыть member@example.com' }));
  await screen.findByText('Студент');
  expect(screen.queryByRole('button', { name: 'Назначить администратором' })).not.toBeInTheDocument();
  const block = screen.getByRole('button', { name: 'Заблокировать пользователя' });
  expect(block).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Причина изменения'), { target: { value: 'Synthetic test' } });
  fireEvent.click(block);
  await screen.findByText('Статус пользователя обновлён');
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/users/member-id/block', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ blocked: true, reason: 'Synthetic test' }) })));
  expect(screen.getByRole('button', { name: 'Разблокировать пользователя' })).toBeDisabled();
});

it('allows only the superadmin to delegate and revoke admin rights', async () => {
  let isAdmin = false;
  const user = () => ({ id: 'member-id', email: 'member@example.com', is_admin: isAdmin, is_super_admin: false, is_blocked: false });
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/me')) return json({ id: 'owner-id', is_admin: true, is_super_admin: true });
    if (url.endsWith('/events')) return json([]);
    if (url.endsWith('/role')) { isAdmin = JSON.parse(options?.body as string).is_admin; return json(user()); }
    if (url.endsWith('/users/member-id')) return json({ user: user(), profile: null, active_sessions: 0 });
    return json({ items: [user()], total: 1, offset: 0, limit: 20 });
  });
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Открыть member@example.com' }));
  const grant = await screen.findByRole('button', { name: 'Назначить администратором' });
  expect(grant).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Причина изменения'), { target: { value: 'Делегирование модерации' } });
  fireEvent.click(grant);
  await screen.findByText('Роль обновлена. Пользователю нужно войти заново.');
  expect(fetch).toHaveBeenCalledWith('/api/admin/users/member-id/role', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ is_admin: true, reason: 'Делегирование модерации' }) }));
  fireEvent.change(screen.getByLabelText('Причина изменения'), { target: { value: 'Снятие роли' } });
  fireEvent.click(screen.getByRole('button', { name: 'Снять права администратора' }));
  await screen.findByRole('button', { name: 'Назначить администратором' });
});

it('protects the superadmin and hides role changes from regular admins', async () => {
  const user = { id: 'owner-id', email: 'owner@example.com', is_admin: true, is_super_admin: true, is_blocked: false };
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/auth/me')) return json({ id: 'delegate-id', is_admin: true, is_super_admin: false });
    if (url.endsWith('/events')) return json([]);
    if (url.endsWith('/users/owner-id')) return json({ user, profile: null, active_sessions: 1 });
    return json({ items: [user], total: 1, offset: 0, limit: 20 });
  }));
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  await screen.findByText('Суперадминистратор');
  fireEvent.click(screen.getByRole('button', { name: 'Открыть owner@example.com' }));
  await screen.findByText('Суперадминистратор защищён. Блокировка самого себя недоступна.');
  expect(screen.queryByRole('button', { name: 'Заблокировать пользователя' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Снять права администратора' })).not.toBeInTheDocument();
});
