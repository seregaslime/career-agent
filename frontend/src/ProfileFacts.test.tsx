import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileFacts } from './ProfileFacts';

afterEach(() => vi.unstubAllGlobals());
const item = (id: string, kind: string, status: string, data: object, evidence: string | null = null) =>
  ({ id, kind, status, source: evidence ? 'interview' : 'manual', data, evidence, turn_id: null, created_at: '', updated_at: '' });

type Row = ReturnType<typeof item>;
function server(initial: Row[]) {
  let rows = [...initial];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(options.body as string) : undefined;
    if (url === '/api/profile/items' && options?.method === 'GET') return Response.json(rows);
    if (url === '/api/profile/items' && options?.method === 'POST') {
      const created = item('new-1', body.kind, 'confirmed', body.data); rows.push(created); return Response.json(created, { status: 201 });
    }
    const [, id, action] = url.match(/^\/api\/profile\/items\/([^/]+)(?:\/(\w+))?$/) ?? [];
    const current = rows.find(row => row.id === id);
    if (!current) return Response.json({ detail: 'Запись профиля не найдена' }, { status: 404 });
    if (action) return Response.json({ detail: 'Not Found' }, { status: 404 });
    if (options?.method === 'PATCH') Object.assign(current, { data: body.data });
    else if (options?.method === 'DELETE') { rows = rows.filter(row => row !== current); return new Response(null, { status: 204 }); }
    return Response.json(current);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

it('shows interview facts directly in the profile and lets the user edit and delete them', async () => {
  const fetch = server([
    item('python', 'skill', 'confirmed', { name: 'Python', level: null }, 'бота на Python'),
    item('bot', 'project', 'confirmed', { title: 'Бот', role: '', technologies: ['aiogram'], description: '' }, 'сделал бота'),
  ]);
  render(<ProfileFacts />);
  const skills = (await screen.findByRole('heading', { name: 'Навыки' })).parentElement as HTMLElement;
  expect(within(skills).getByText('Python')).toBeInTheDocument();
  expect(within(skills).getByText('из интервью')).toHaveAttribute('title', '«бота на Python»');
  expect(screen.queryByRole('heading', { name: 'Предложено из интервью' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Подтвердить|Отклонить/ })).not.toBeInTheDocument();

  fireEvent.click(within(skills).getByRole('button', { name: 'Изменить' }));
  fireEvent.change(screen.getByLabelText('Уровень'), { target: { value: 'beginner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(within(skills).getByText('Python · Начальный')).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith('/api/profile/items/python', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ data: { name: 'Python', level: 'beginner' } }) }));

  const projects = screen.getByRole('heading', { name: 'Проекты' }).parentElement as HTMLElement;
  fireEvent.click(within(projects).getByRole('button', { name: 'Удалить' }));
  await screen.findByText('Запись удалена');
  expect(screen.queryByText('Бот · aiogram')).not.toBeInTheDocument();
});

it('adds, edits and deletes confirmed items manually', async () => {
  const fetch = server([item('edu', 'education', 'confirmed', { institution: 'МГТУ', program: '', period: '' })]);
  render(<ProfileFacts />);
  await screen.findByText('МГТУ');
  fireEvent.click(screen.getByRole('button', { name: 'Добавить опыт' }));
  fireEvent.change(screen.getByLabelText('Должность или роль'), { target: { value: 'Стажёр' } });
  fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'Учебная лаборатория' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await screen.findByText('Стажёр · Учебная лаборатория');
  expect(fetch).toHaveBeenCalledWith('/api/profile/items', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ kind: 'experience', data: { position: 'Стажёр', organization: 'Учебная лаборатория', period: '', description: '' } }),
  }));
  const education = screen.getByRole('heading', { name: 'Образование' }).parentElement as HTMLElement;
  fireEvent.click(within(education).getByRole('button', { name: 'Изменить' }));
  fireEvent.change(screen.getByLabelText('Направление или курс'), { target: { value: 'Программная инженерия' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await screen.findByText('МГТУ · Программная инженерия');
  fireEvent.click(within(education).getByRole('button', { name: 'Удалить' }));
  await screen.findByText('Запись удалена');
  expect(screen.queryByText(/МГТУ/)).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/profile/items/edu', expect.objectContaining({ method: 'DELETE' }));
});

it('shows a load failure with a manual retry and server errors on save', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'GET') return fail ? new Response('down', { status: 502 }) : Response.json([]);
    return Response.json({ detail: 'Такая запись уже есть в профиле' }, { status: 409 });
  }));
  render(<ProfileFacts />);
  await screen.findByText('Сервер профиля временно недоступен. Повторите позже.');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку фактов' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить навык' }));
  fireEvent.change(screen.getByLabelText('Навык'), { target: { value: 'Python' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Такая запись уже есть в профиле');
  expect(screen.getByLabelText('Навык')).toHaveValue('Python');
});
