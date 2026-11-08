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
