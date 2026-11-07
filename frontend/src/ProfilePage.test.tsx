import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

afterEach(() => vi.unstubAllGlobals());
const json = (data: object, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });

it('shows login for an anonymous visitor and reports invalid credentials', async () => {
  const fetch = vi.fn().mockImplementation(() => json({}, 401));
  vi.stubGlobal('fetch', fetch);
  render(<ProfilePage />);
  await screen.findByRole('heading', { name: 'Вход' });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.com' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'synthetic-password' } });
  fetch.mockImplementation(() => json({ detail: 'Неверный email или пароль' }, 401));
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByText('Неверный email или пароль');
});

it('loads and saves the authenticated profile', async () => {
  const profile = { full_name: 'Студент', target_role: '', education: '', about: '' };
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/me')) return json({ email: 'student@example.com' });
    if (init?.method === 'PATCH') return json({ ...profile, target_role: 'Python' });
    return json(profile);
  });
  vi.stubGlobal('fetch', fetch);
  render(<ProfilePage />);
  await screen.findByDisplayValue('Студент');
  fireEvent.change(screen.getByLabelText('Желаемая должность'), { target: { value: 'Python' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
  await screen.findByText('Профиль сохранён');
  expect(fetch).toHaveBeenLastCalledWith('/api/profile', expect.objectContaining({
    method: 'PATCH', credentials: 'same-origin',
    body: JSON.stringify({ ...profile, target_role: 'Python' }),
  }));
});

it('does not expose an old profile after logout', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/me')
    ? json({ email: 'student@example.com' }) : url.endsWith('/logout') ? json({}, 204)
    : json({ full_name: 'Студент', target_role: '', education: '', about: '' })));
  render(<ProfilePage />);
  await screen.findByDisplayValue('Студент');
  fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
  await screen.findByRole('heading', { name: 'Вход' });
  expect(screen.queryByDisplayValue('Студент')).not.toBeInTheDocument();
});
