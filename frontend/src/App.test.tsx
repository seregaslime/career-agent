import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi, afterEach } from 'vitest';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());
it('opens the interview and loads its history', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json: async () => [] }));
  render(<MemoryRouter initialEntries={['/chat']}><App /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Карьерное интервью' })).toBeInTheDocument();
  expect(await screen.findByText(/Начните с рассказа/)).toBeInTheDocument();
});
it('renders the overview and navigation', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('У вашего опыта');
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});

it('opens the resume page instead of the development placeholder', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {status:401})));
  render(<MemoryRouter initialEntries={['/resume']}><App /></MemoryRouter>);
  expect(screen.getByRole('heading', {name:'Ваше резюме'})).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Войдите в аккаунт');
  expect(screen.queryByText('Этот раздел ещё в разработке.', {exact:false})).not.toBeInTheDocument();
});
