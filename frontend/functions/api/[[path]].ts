// Keep browser sessions first-party: the browser calls /api on its own origin.
const BACKEND = 'https://career-agent-api-nxy3.onrender.com';
interface Context { request: Request }
export const onRequest = async ({ request }: Context): Promise<Response> => {
  const source = new URL(request.url);
  if (!source.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('x-forwarded-host');
  headers.set('X-Forwarded-Host', source.host);
  const upstream = await fetch(BACKEND + source.pathname + source.search, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });
  const result = new Response(upstream.body, upstream);
  result.headers.set('Cache-Control', 'no-store');
  return result;
};
