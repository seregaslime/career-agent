import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { groqBase, groqModel } from './llm';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
const turns = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `turn-${index}`, prompt: `Знаю Python ${index}`, reply: 'Расскажите подробнее', facts_checked: false, created_at: '',
}));
function restore() {
  localStorage.setItem('career-agent.llm', JSON.stringify({ kind: 'ollama', base: 'http://127.0.0.1:11434', model: 'synthetic', provider: 'groq' }));
}
const modelReply = () => Response.json({ message: { content: '{"facts":[]}' } });
const extracted = () => Response.json({ items: [], skipped: [], already_processed: false });

it.each(['model', 'profile', 'settings'])('stops the entire background queue on cancellation during %s', async stage => {
  restore();
  let modelCalls = 0; let writes = 0; let waiting = false;
  const blocked = (signal: AbortSignal) => new Promise<Response>((_, reject) => {
    waiting = true;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/chat') return Response.json(turns(2));
    if (url === 'http://127.0.0.1:11434/api/chat') {
      modelCalls++;
      return stage === 'profile' ? modelReply() : blocked(options!.signal!);
    }
    if (url === '/api/profile/items/extracted') { writes++; return blocked(options!.signal!); }
    throw new Error('Unexpected request ' + url);
  }));
  const { unmount } = render(<MemoryRouter><ChatPage /></MemoryRouter>);
  await waitFor(() => expect(waiting).toBe(true));
  if (stage === 'settings') fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'another-model' } });
  else unmount();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(modelCalls).toBe(1);
  expect(writes).toBe(stage === 'profile' ? 1 : 0);
});

it('limits automatic catch-up to five messages per run', async () => {
  restore(); let writes = 0; let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/chat') return Response.json(turns(8));
    if (url === 'http://127.0.0.1:11434/api/chat') { calls++; return modelReply(); }
    if (url === '/api/profile/items/extracted') { writes++; return extracted(); }
    throw new Error('Unexpected request ' + url);
  }));
  render(<MemoryRouter><ChatPage /></MemoryRouter>);
  await waitFor(() => expect(writes).toBe(5));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(calls).toBe(5);
});

it('stops on HTTP 429 without retrying or draining older messages', async () => {
  localStorage.setItem('career-agent.llm', JSON.stringify({ kind: 'api', provider: 'groq', base: groqBase, model: groqModel }));
  sessionStorage.setItem('career-agent.llm-key', JSON.stringify({ base: groqBase, key: 'synthetic' }));
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/chat') return Response.json(turns(3));
    if (url === groqBase + '/chat/completions') { calls++; return new Response('', { status: 429 }); }
    throw new Error('Unexpected request ' + url);
  }));
  render(<MemoryRouter><ChatPage /></MemoryRouter>);
  await waitFor(() => expect(calls).toBe(1));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(calls).toBe(1);
});
