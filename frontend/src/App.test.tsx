import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi, afterEach } from 'vitest';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());
it('opens a routed placeholder without pretending interview is available', () => {
  render(<MemoryRouter initialEntries={['/chat']}><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Знакомство' })).toBeInTheDocument();
  expect(screen.getByText(/Этот раздел ещё в разработке/)).toBeInTheDocument();
});
it('renders the overview and navigation', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('У вашего опыта');
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});
