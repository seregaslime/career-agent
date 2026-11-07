import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const json = (data: object, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });

it('waits through a cold start and opens login after the server wakes', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementationOnce(() => json({}, 503))
    .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    .mockImplementation(() => json({}, 401));
  vi.stubGlobal('fetch', fetch);
  render(<ProfilePage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText(/Ожидаем ответа сервера/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(screen.getByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('stops retrying an unavailable server and allows a manual retry', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(() => json({}, 502));
  vi.stubGlobal('fetch', fetch);
  render(<ProfilePage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(70000); });
  expect(screen.getByText('Сервер пока недоступен. Повторите проверку входа.')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(8);
  fetch.mockImplementation(() => json({}, 401));
  fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку входа' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByText('Сервер пока недоступен. Повторите проверку входа.')).not.toBeInTheDocument();
});

it('shows login for an anonymous visitor and reports invalid credentials', async () => {
  const fetch = vi.fn().mockImplementation(() => json({}, 401));
  vi.stubGlobal('fetch', fetch);
  render(<ProfilePage />);
  await screen.findByRole('heading', { name: 'Вход' });
  expect(screen.getByLabelText('Пароль')).toHaveAttribute('minlength', '8');
  expect(screen.getByLabelText('Пароль')).toHaveAttribute('maxlength', '128');
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
