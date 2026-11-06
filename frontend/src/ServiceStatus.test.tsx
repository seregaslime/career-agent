import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceStatus } from './ServiceStatus';

afterEach(() => vi.unstubAllGlobals());
const ok = (body: object) => Promise.resolve({ ok: true, json: async () => body });

describe('Service status', () => {
  it('shows loading before the server responds', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<ServiceStatus />);
    expect(screen.getAllByText('Проверяем…')).toHaveLength(2);
  });
  it('shows both API and database readiness', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => ok(url.endsWith('/ready') ? { database: 'ready' } : { status: 'ok' })));
    render(<ServiceStatus />);
    await waitFor(() => expect(screen.getAllByText('Доступен')).toHaveLength(2));
  });
  it('handles errors and supports retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    render(<ServiceStatus />);
    await waitFor(() => expect(screen.getAllByText('Нет соединения')).toHaveLength(2));
    fetch.mockImplementation((url: string) => ok(url.endsWith('/ready') ? { database: 'ready' } : { status: 'ok' }));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    await waitFor(() => expect(screen.getAllByText('Доступен')).toHaveLength(2));
  });
  it('does not show database ready when only API is alive', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/ready')
      ? Promise.resolve({ ok: false, status: 503 }) : ok({ status: 'ok' })));
    render(<ServiceStatus />);
    await screen.findByText('Нет соединения');
    expect(screen.getAllByText('Доступен')).toHaveLength(1);
  });
  it('rejects malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ unexpected: true })));
    render(<ServiceStatus />);
    await waitFor(() => expect(screen.getAllByText('Нет соединения')).toHaveLength(2));
  });
});
