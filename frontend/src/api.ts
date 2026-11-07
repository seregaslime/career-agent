const base = ''; // Same-origin proxy keeps cookies first-party.

async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { credentials: 'same-origin', signal: signal ?? AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function getHealth(signal?: AbortSignal): Promise<void> {
  const data = await get('/api/health', signal);
  if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'ok') {
    throw new Error('Invalid health response');
  }
}

export async function getReadiness(signal?: AbortSignal): Promise<void> {
  const data = await get('/api/ready', signal);
  if (typeof data !== 'object' || data === null || !('database' in data) || data.database !== 'ready') {
    throw new Error('Invalid readiness response');
  }
}
