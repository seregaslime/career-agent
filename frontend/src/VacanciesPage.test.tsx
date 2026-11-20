import {fireEvent,render,screen} from '@testing-library/react';
import {Link,MemoryRouter,Routes,Route} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {VacanciesPage,VacancyPage} from './VacanciesPage';
const vacancy={id:'1',source:'demo',title:'Стажёр Python Backend',company:'Учебная команда',city:'Москва',experience_label:'Без опыта',work_formats:['REMOTE'],salary:null,skills:['Python'],description:'Вымышленная задача',published_at:null,source_url:null};
const catalog={source:'demo',items:[vacancy],found:1,page:0,pages:1,fetched_at:'2026-11-20T12:00:00Z',hh_available:false};
afterEach(()=>vi.unstubAllGlobals());
function mount(path='/vacancies') {render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/vacancies" element={<VacanciesPage/>}/><Route path="/vacancies/:source/:vacancyId" element={<VacancyPage/>}/></Routes></MemoryRouter>);}
it('labels synthetic data, applies filters, opens a detail and returns to the filtered list',async()=>{
 const fetch=vi.fn(async(url:string)=>Response.json(url.startsWith('/api/vacancies/demo/1')?vacancy:catalog));vi.stubGlobal('fetch',fetch);
 mount();
 expect(await screen.findByRole('heading',{name:vacancy.title})).toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent('вымышлены');
 fireEvent.change(screen.getByLabelText('Поиск'),{target:{value:'Python'}});
 fireEvent.change(screen.getByLabelText('Опыт'),{target:{value:'noExperience'}});
 fireEvent.change(screen.getByLabelText('Формат работы'),{target:{value:'REMOTE'}});
 fireEvent.click(screen.getByRole('button',{name:'Найти вакансии'}));
 await screen.findByRole('heading',{name:vacancy.title});
 expect(fetch.mock.calls.some(([url])=>url.includes('q=Python')&&url.includes('experience=noExperience')&&url.includes('work_format=REMOTE'))).toBe(true);
 fireEvent.click(screen.getByRole('link',{name:'Подробнее →'}));
 expect(await screen.findByText('Вымышленная задача')).toBeInTheDocument();
 expect(screen.queryByRole('link',{name:/Открыть оригинал/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('link',{name:'← К списку вакансий'}));
 expect(await screen.findByLabelText('Поиск')).toHaveValue('Python');
});
it('shows source failure without silently substituting demo results',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({detail:'Источник hh.ru ещё не подключён.'},{status:503})));
 mount('/vacancies?source=hh');
 expect(await screen.findByRole('alert')).toHaveTextContent('ещё не подключён');
 expect(screen.getByRole('link',{name:'Открыть демокаталог'})).toHaveAttribute('href','/vacancies');
 expect(screen.queryByRole('heading',{name:vacancy.title})).not.toBeInTheDocument();
});
it('shows an empty result rather than a placeholder vacancy',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({...catalog,items:[],found:0,pages:0})));
 mount();expect(await screen.findByText(/По этим условиям вакансий нет/)).toBeInTheDocument();
});
it('restores filter controls when navigation changes the query string',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json(catalog)));
 render(<MemoryRouter initialEntries={['/vacancies?q=Python']}><Link to="/vacancies?q=React">Change search externally</Link><VacanciesPage/></MemoryRouter>);
 expect(screen.getByLabelText('Поиск')).toHaveValue('Python');
 fireEvent.click(screen.getByRole('link',{name:'Change search externally'}));
 expect(screen.getByLabelText('Поиск')).toHaveValue('React');
 await screen.findByRole('heading',{name:vacancy.title});
});
it('never renders a provider-controlled unsafe source link',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({...vacancy,source:'hh',source_url:'javascript:alert(1)'})));
 mount('/vacancies/hh/1');await screen.findByRole('heading',{name:vacancy.title});
 expect(screen.queryByRole('link',{name:/Открыть оригинал/})).not.toBeInTheDocument();
});
