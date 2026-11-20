import { afterEach, expect, it, vi } from 'vitest';
import { complete, endpoint, groqBase, groqModel, listModels, type Connection } from './llm';
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
it('uses the Groq endpoint, a personal key and a bounded non-reasoning Qwen answer', async () => {
 const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:groqModel}]}))).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'Какой проект вы сделали?'},finish_reason:'stop'}]})));
 vi.stubGlobal('fetch',fetch);
 const api: Connection = {kind:'api',base:groqBase,model:groqModel,key:' synthetic-key '};
 expect(await listModels(api)).toEqual([groqModel]);
 await complete(api,[{role:'user',content:'Учусь'}],new AbortController().signal);
 expect(fetch.mock.calls[1][0]).toBe(groqBase+'/chat/completions');
 expect(fetch.mock.calls[1][1]).toMatchObject({credentials:'omit',redirect:'error',headers:{Authorization:'Bearer synthetic-key'}});
 expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({max_completion_tokens:700,reasoning_effort:'none'});
 expect(JSON.parse(fetch.mock.calls[1][1].body).max_tokens).toBeUndefined();
});
it('does not send Groq-specific parameters to another compatible API', async () => {
 const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'Ответ'}}]})));
 vi.stubGlobal('fetch',fetch);
 await complete({...config,kind:'api',base:'https://other.example/custom/v1',model:groqModel,key:''},[],new AbortController().signal);
 const body = JSON.parse(fetch.mock.calls[0][1].body);
 expect(body.max_tokens).toBe(700);
 expect(body.reasoning_effort).toBeUndefined();
 expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
});
it('reports a rate limit and safe retry delay without leaking or repeating a request', async () => {
 const fetch = vi.fn().mockResolvedValue(new Response('secret provider response',{status:429,headers:{'Retry-After':'42'}}));
 vi.stubGlobal('fetch',fetch);
 const error = await complete(config,[],new AbortController().signal).catch(e => e as Error);
 if (!(error instanceof Error)) throw new Error('Expected rate-limit error');
 expect(error.message).toContain('42 сек.');
 expect(error.message).not.toContain('secret');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects truncated API replies instead of saving an incomplete interview answer', async () => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'Незаконченный'},finish_reason:'length'}]}))));
 await expect(complete({...config,kind:'api',base:groqBase},[],new AbortController().signal)).rejects.toThrow('Неполный ответ не сохранён');
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
