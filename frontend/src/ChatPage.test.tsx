import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { groqBase, groqModel } from './llm';
afterEach(() => vi.unstubAllGlobals());
it.each([401, 502])('keeps the history failure visible after provider setup and retries without losing the key (%s)', async status => {
 let reads = 0;
 vi.stubGlobal('fetch',vi.fn(async (url:string) => {
   if (url === '/api/chat') {
     reads++;
     return reads === 1 ? new Response('Unavailable',{status}) : Response.json([]);
   }
   if (url === groqBase+'/models') return Response.json({data:[{id:groqModel}]});
   throw new Error('Unexpected request');
 }));
 render(<MemoryRouter><ChatPage /></MemoryRouter>);
 const reason = status === 401 ? /API-ключ модели не заменяет вход/ : /Сервер интервью временно недоступен/;
 await screen.findByText(reason);
 expect(screen.getByLabelText('Ваше сообщение')).toBeDisabled();
 if (status === 401) expect(screen.getByRole('link',{name:'Войти в аккаунт в новой вкладке'})).toHaveAttribute('target','_blank');
 else expect(screen.queryByRole('link',{name:'Войти в аккаунт в новой вкладке'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Режим'),{target:{value:'api'}});
 fireEvent.change(screen.getByLabelText('API-ключ'),{target:{value:'synthetic-key'}});
 fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));
 await screen.findByText(/Список моделей получен/);
 expect(screen.getByText(reason)).toBeInTheDocument();
 expect(screen.getByLabelText('Ваше сообщение')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Повторить проверку входа и истории'}));
 await waitFor(() => expect(screen.getByLabelText('Ваше сообщение')).toBeEnabled());
 expect(screen.getByLabelText('API-ключ')).toHaveValue('synthetic-key');
 expect(screen.getByLabelText('Модель')).toHaveValue(groqModel);
 expect(reads).toBe(2);
 expect(screen.queryByText(reason)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Отправить'})).toBeEnabled();
});
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
 await screen.findByText('Список моделей получен. Выберите модель; генерация проверяется при отправке сообщения.');
 fireEvent.change(screen.getByLabelText('Ваше сообщение'),{target:{value:'Учусь, делаю бота'}});
 fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await screen.findByRole('alert');
 expect(turns).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Повторить получение ответа'}));
 await screen.findByText('Какие задачи решал бот?');
 await waitFor(()=>expect(turns[0].reply).not.toBeNull());
 expect(turns).toHaveLength(1);
});
it('sends a personal Groq key only to Groq and retries a rate-limited saved turn', async () => {
 let turn: {id:string;prompt:string;reply:string|null} | null = null;
 let generations = 0;
 const fetch = vi.fn(async (url:string, options?:RequestInit) => {
   if (url === '/api/chat' && options?.method === 'GET') return Response.json([]);
   if (url === '/api/chat' && options?.method === 'POST') {
     expect(options.body).not.toContain('synthetic-personal-key');
     turn = {...JSON.parse(options.body as string),reply:null}; return Response.json(turn);
   }
   if (url.startsWith('/api/chat/')) return Response.json({...turn,reply:JSON.parse(options?.body as string).reply});
   if (url === groqBase+'/models') return Response.json({data:[{id:groqModel}]});
   if (url === groqBase+'/chat/completions') {
     expect(options?.headers).toMatchObject({Authorization:'Bearer synthetic-personal-key'});
     expect(turn).not.toBeNull(); generations++;
     return generations === 1 ? new Response('private provider response',{status:429,headers:{'Retry-After':'10'}}) : Response.json({choices:[{message:{content:'Что вы сделали сами?'}}]});
   }
   throw new Error('Unexpected request');
 });
 vi.stubGlobal('fetch',fetch);
 render(<MemoryRouter><ChatPage /></MemoryRouter>);
 await screen.findByText(/Начните с рассказа/);
 fireEvent.change(screen.getByLabelText('Режим'),{target:{value:'api'}});
 expect(screen.getByLabelText('Адрес сервера')).toHaveValue(groqBase);
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 expect(screen.getByRole('note')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('API-ключ'),{target:{value:'synthetic-personal-key'}});
 fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));
 await screen.findByText(/Список моделей получен/);
 fireEvent.change(screen.getByLabelText('Ваше сообщение'),{target:{value:'Сделал учебный бот'}});
 fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('10 сек.');
 expect(generations).toBe(1);
 fireEvent.click(screen.getByRole('button',{name:'Повторить получение ответа'}));
 await screen.findByText('Что вы сделали сами?');
 expect(fetch.mock.calls.filter(([url,opts]) => url === '/api/chat' && opts?.method === 'POST')).toHaveLength(1);
 expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/')).every(([,opts]) => !(opts?.headers as Record<string,string>)?.Authorization)).toBe(true);
});
it('clears keys when changing provider or destination, and allows a manual model', async () => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json([])));
 const {unmount} = render(<MemoryRouter><ChatPage /></MemoryRouter>);
 await screen.findByText(/Начните с рассказа/);
 fireEvent.change(screen.getByLabelText('Режим'),{target:{value:'api'}});
 fireEvent.change(screen.getByLabelText('API-ключ'),{target:{value:'synthetic-key'}});
 fireEvent.change(screen.getByLabelText('Провайдер'),{target:{value:'custom'}});
 expect(screen.getByLabelText('API-ключ')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('Адрес сервера'),{target:{value:'https://provider.example/v1'}});
 fireEvent.change(screen.getByLabelText('API-ключ'),{target:{value:'another-synthetic-key'}});
 fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'my-model'}});
 expect(screen.getByRole('button',{name:'Отправить'})).toBeEnabled();
 fireEvent.change(screen.getByLabelText('Адрес сервера'),{target:{value:'https://another.example/v1'}});
 expect(screen.getByLabelText('API-ключ')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('API-ключ'),{target:{value:'temporary-key'}});
 fireEvent.click(screen.getByRole('button',{name:'Очистить ключ'}));
 expect(screen.getByLabelText('API-ключ')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('API-ключ'),{target:{value:'temporary-key'}});
 unmount();
 render(<MemoryRouter><ChatPage /></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Режим'),{target:{value:'api'}});
 expect(screen.getByLabelText('API-ключ')).toHaveValue('');
});
it('silently moves every saved answer into the profile: the new reply first, then the backlog oldest first', async () => {
 type T = {id:string;prompt:string;reply:string|null;facts_checked:boolean;created_at:string};
 const turns: T[] = [
   {id:'old-1',prompt:'Учусь в МАИ на информатике',reply:'Какие проекты делали?',facts_checked:false,created_at:''},
   {id:'old-2',prompt:'Делал REST API на FastAPI',reply:'А опыт работы?',facts_checked:true,created_at:''},
   {id:'old-3',prompt:'Год ручного тестирования',reply:'Где хотите работать?',facts_checked:false,created_at:''},
 ];
 const extracted: string[] = [];
 const attempts: Record<string, number> = {};
 const fetch = vi.fn(async (url:string, options?:RequestInit) => {
   const body = options?.body ? JSON.parse(options.body as string) : undefined;
   if (url === '/api/chat' && options?.method === 'GET') return Response.json(turns);
   if (url === '/api/chat' && options?.method === 'POST') { const turn = {...body,reply:null,facts_checked:false,created_at:''}; turns.push(turn); return Response.json(turn); }
   if (url.startsWith('/api/chat/')) { const turn = turns.find(row => url.endsWith(row.id)) as T; turn.reply = body.reply; return Response.json(turn); }
   if (url === 'http://127.0.0.1:11434/api/tags') return Response.json({models:[{name:'test-model'}]});
   if (url === 'http://127.0.0.1:11434/api/chat') {
     if (!String(body.messages[0].content).startsWith('Ты извлекаешь')) return Response.json({message:{content:'Какой формат работы удобен?'}});
     const answer = String(body.messages[1].content).split('Ответ пользователя:\n')[1];
     attempts[answer] = (attempts[answer] ?? 0) + 1;
     if (answer.startsWith('Год') && attempts[answer] === 1) return Response.json({message:{content:'Не могу ответить JSON'}});
     const word = answer.split(' ')[0];
     return Response.json({message:{content: JSON.stringify({facts:[{kind:'skill',evidence:answer,data:{name:word}}]})}});
   }
   if (url === '/api/profile/items/extracted') {
     const turn = turns.find(row => row.id === body.turn_id) as T;
     turn.facts_checked = true; extracted.push(turn.prompt);
     return Response.json({items:[],skipped:[],already_processed:false,profile_fields:[]});
   }
   throw new Error('Unexpected request '+url);
 });
 vi.stubGlobal('fetch',fetch);
 render(<MemoryRouter><ChatPage /></MemoryRouter>);
 await screen.findByText('Учусь в МАИ на информатике');
 fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));
 await screen.findByText(/Список моделей получен/);
 // Connecting the model alone starts the backlog, oldest first; a failed answer is retried at once.
 await waitFor(() => expect(extracted).toEqual(['Учусь в МАИ на информатике','Год ручного тестирования']));
 expect(attempts['Год ручного тестирования']).toBe(2);

 fireEvent.change(screen.getByLabelText('Ваше сообщение'),{target:{value:'Хочу удалённо в Москве'}});
 fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await screen.findByText('Какой формат работы удобен?');
 await waitFor(() => expect(extracted).toEqual(['Учусь в МАИ на информатике','Год ручного тестирования','Хочу удалённо в Москве']));
 expect(extracted).not.toContain('Делал REST API на FastAPI');
 expect(screen.queryByText(/Добавлено в профиль|Новых фактов|Факты пока не извлечены|фактов/)).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Открыть профиль'})).not.toBeInTheDocument();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Отправить'})).toBeInTheDocument();
});
