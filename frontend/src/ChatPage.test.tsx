import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
afterEach(() => vi.unstubAllGlobals());
it('persists a user message before inference and can retry a failed model', async () => {
 let turns: {id:string;prompt:string;reply:string|null}[] = [];
 let attempts = 0;
 const fetch = vi.fn(async (url:string, options?:RequestInit) => {
   if (url.endsWith('/api/chat') && options?.method === 'POST') { turns = [{...JSON.parse(options.body as string),reply:null}]; return {ok:true,json:async()=>turns[0]}; }
   if (url.includes('/api/chat/')) { turns[0].reply = JSON.parse(options?.body as string).reply; return {ok:true,json:async()=>turns[0]}; }
   if (url.endsWith('/api/chat')) return {ok:true,json:async()=>turns};
   if (url.endsWith('/api/chat-model-unused')) throw new Error('unused');
   if (url.endsWith('/api/tags')) return {ok:true,json:async()=>({models:[{name:'test-model'}]})};
   if (url.endsWith('/api/chat') === false) throw new Error('unexpected URL');
   throw new Error('unexpected');
 });
 // Both the application and Ollama use /api/chat; discriminate by origin.
 const wrapped = vi.fn(async (url:string,options?:RequestInit) => {
   if (url.startsWith('http://127.0.0.1:11434/api/chat')) {
     attempts++; if (attempts===1) throw new TypeError('offline');
     expect(turns).toHaveLength(1);
     return {ok:true,json:async()=>({message:{content:'Какие задачи решал бот?'}})};
   }
   return fetch(url,options);
 });
 vi.stubGlobal('fetch',wrapped);
 render(<MemoryRouter><ChatPage /></MemoryRouter>);
 await screen.findByText(/Начните с рассказа/);
 fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));
 await screen.findByText('Соединение установлено. Выберите модель.');
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.change(screen.getByLabelText('Ваше сообщение'),{target:{value:'Учусь, делаю бота'}});
 fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await screen.findByRole('alert');
 expect(turns).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Повторить получение ответа'}));
 await screen.findByText('Какие задачи решал бот?');
 await waitFor(()=>expect(turns[0].reply).not.toBeNull());
 expect(turns).toHaveLength(1);
});
