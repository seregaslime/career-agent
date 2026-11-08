import { afterEach, expect, it, vi } from 'vitest';
import { complete, endpoint, listModels, type Connection } from './llm';
const config: Connection = { kind: 'ollama', base: 'http://127.0.0.1:11434', model: 'test', key: 'never-to-ollama' };
afterEach(() => vi.unstubAllGlobals());
it('gets Ollama models and calls local inference without credentials', async () => {
 const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({models:[{name:'test'}]}))).mockResolvedValueOnce(new Response(JSON.stringify({message:{content:'Вопрос'}})));
 vi.stubGlobal('fetch', fetch);
 expect(await listModels(config)).toEqual(['test']);
 expect(await complete(config,[{role:'user',content:'Тест'}],new AbortController().signal)).toBe('Вопрос');
 expect(fetch.mock.calls[1][0]).toBe('http://127.0.0.1:11434/api/chat');
 expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
 expect(fetch.mock.calls[1][1].credentials).toBe('omit');
});
it('supports browser-compatible API and refuses redirects and unsafe URLs', async () => {
 const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'Ответ'}}]})));
 vi.stubGlobal('fetch',fetch);
 await complete({...config,kind:'api',base:'https://provider.example/v1',key:'synthetic-key'},[],new AbortController().signal);
 expect(fetch.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions');
 expect(fetch.mock.calls[0][1]).toMatchObject({redirect:'error',headers:{Authorization:'Bearer synthetic-key'}});
 expect(() => endpoint({...config,base:'http://remote.example'})).toThrow();
 expect(() => endpoint({...config,base:'https://user:password@host.example'})).toThrow();
});
it('reports model errors without exposing the provider response or API key', async () => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('secret error',{status:401})));
 await expect(complete(config,[],new AbortController().signal)).rejects.toThrow('HTTP 401');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({message:{content:''}}))));
 await expect(complete(config,[],new AbortController().signal)).rejects.toThrow('пустой ответ');
});
