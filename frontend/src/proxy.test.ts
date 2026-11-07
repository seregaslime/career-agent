import { afterEach, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/[[path]]';

afterEach(() => vi.unstubAllGlobals());
it('forwards API cookies only to the fixed backend and disables caching', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', {
    headers: { 'Set-Cookie': 'career_session=test; HttpOnly; Secure; Path=/api' },
  }));
  vi.stubGlobal('fetch', fetch);
  const result = await onRequest({ request: new Request('https://career-agent-9pq.pages.dev/api/profile', {
    headers: { Cookie: 'career_session=test', Host: 'untrusted.example' },
  }) });
  expect(fetch.mock.calls[0][0]).toBe('https://career-agent-api-nxy3.onrender.com/api/profile');
  const headers = fetch.mock.calls[0][1].headers as Headers;
  expect(headers.get('Cookie')).toBe('career_session=test');
  expect(headers.has('host')).toBe(false);
  expect(result.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(result.headers.get('Cache-Control')).toBe('no-store');
});
it('rejects non-API paths without fetching an upstream', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await onRequest({ request: new Request('https://example.com/other') })).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
