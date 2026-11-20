import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ResumePage } from './ResumePage';
import type { Item } from './facts';
const profile = { full_name: 'Анна Примерова', target_role: 'Junior Python Developer', education: '', about: 'Разрабатываю учебные веб-приложения.', location: 'Казань', work_format: 'remote' };
const item = (id: string, kind: Item['kind'], data: Item['data'], status: Item['status'] = 'confirmed'): Item => ({ id, kind, data, status, source: 'interview', evidence: null, turn_id: null, created_at: '', updated_at: '' });
const items = [
  item('1', 'skill', { name: 'Python', level: null }),
  item('2', 'project', { title: 'Учебный бот', role: 'Разработчик', technologies: ['Python', 'aiogram'], description: 'Добавила расписание занятий.' }),
  item('3', 'education', { institution: 'Учебный университет', program: 'Информатика', period: '2024–2028' }),
  item('4', 'skill', { name: 'Непроверенный навык' }, 'suggested'),
  item('5', 'experience', { position: 'Удалённая запись' }, 'rejected'),
];
function mount(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetch);
  return render(<MemoryRouter><ResumePage /></MemoryRouter>);
}
function api(saved = profile, facts = items) {
  return vi.fn(async (url: string) => {
    if (url === '/api/profile') return Response.json(saved);
    if (url === '/api/profile/items?status=confirmed') return Response.json(facts);
    if (url === '/api/auth/me') return Response.json({ email: 'synthetic@example.com' });
    throw new Error('Unexpected request ' + url);
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('builds a truthful resume from the saved profile, omits unconfirmed items and empty sections, and prints on review', async () => {
  const fetch = api(); const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  mount(fetch);
  const paper = await screen.findByRole('article', { name: 'Предпросмотр резюме' });
  expect(within(paper).getByText('Анна Примерова')).toBeInTheDocument();
  expect(within(paper).getByText('Казань · Удалённо')).toBeInTheDocument();
  expect(within(paper).getByText('Добавила расписание занятий.')).toBeInTheDocument();
  expect(within(paper).getByText('Python · aiogram')).toBeInTheDocument();
  expect(within(paper).getByText('Учебный университет')).toBeInTheDocument();
  expect(within(paper).queryByText('Непроверенный навык')).not.toBeInTheDocument();
  expect(within(paper).queryByText('Удалённая запись')).not.toBeInTheDocument();
  expect(within(paper).queryByRole('heading', { name: 'Опыт работы' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Email для резюме'), { target: { value: 'resume@example.com' } });
  expect(within(paper).getByText('resume@example.com')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Сведения проверены — печать / PDF' }));
  expect(print).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(3); // No model requests or writes to the account.
  fireEvent.change(screen.getByLabelText('Email для резюме'), { target: { value: '' } });
  expect(within(paper).queryByText('resume@example.com')).not.toBeInTheDocument();
});
it.each([401, 503])('does not show a partial resume when one source fails (%s)', async status => {
  const fetch = api();
  mount(vi.fn((url: string) => url.includes('/items') ? Promise.resolve(new Response('', { status })) : fetch(url)));
  await screen.findByRole('alert');
  expect(screen.queryByRole('article', { name: 'Предпросмотр резюме' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Сведения проверены/ })).not.toBeInTheDocument();
  if (status === 401) expect(screen.getByRole('link', { name: 'Войти в аккаунт' })).toHaveAttribute('href', '/profile');
  else expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeInTheDocument();
});
it('explains missing information and blocks export for an empty profile', async () => {
  mount(api({ ...profile, full_name: '', target_role: '', about: '' }, []));
  await screen.findByText(/Пока недостаточно сведений/);
  expect(screen.getByText('Укажите имя.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Сведения проверены/ })).toBeDisabled();
  expect(screen.queryByRole('article', { name: 'Предпросмотр резюме' })).not.toBeInTheDocument();
});
it('refreshes from the profile, removes the stale preview while loading and treats text as text', async () => {
  let current = profile;
  const fetch = vi.fn((url: string) => api(current)(url));
  mount(fetch);
  await screen.findByText('Анна Примерова');
  current = { ...profile, full_name: 'Новое имя', about: '<script>bad()</script>' };
  fireEvent.click(screen.getByRole('button', { name: 'Обновить из профиля' }));
  expect(screen.queryByText('Анна Примерова')).not.toBeInTheDocument();
  await screen.findByText('Новое имя');
  expect(screen.getByText('<script>bad()</script>')).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
});
