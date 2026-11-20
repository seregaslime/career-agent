import {fireEvent,render,screen} from '@testing-library/react';
import {Link,MemoryRouter,Routes,Route} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {VacanciesPage,VacancyPage} from './VacanciesPage';
const vacancy={id:'1',source:'demo',title:'Стажёр Python Backend',company:'Учебная команда',city:'Москва',experience_label:'Без опыта',work_formats:['REMOTE'],salary:null,skills:['Python'],description:'Вымышленная задача',published_at:null,source_url:null};
const catalog={source:'demo',items:[vacancy],found:1,page:0,pages:1,fetched_at:'2026-11-20T12:00:00Z',filtered_on_page:false};
afterEach(()=>vi.unstubAllGlobals());
function mount(path='/vacancies?source=demo') {render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/vacancies" element={<VacanciesPage/>}/><Route path="/vacancies/:source/:vacancyId" element={<VacancyPage/>}/></Routes></MemoryRouter>);}
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
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({detail:'Источник временно недоступен.'},{status:503})));
 mount('/vacancies?source=trudvsem');
 expect(await screen.findByRole('alert')).toHaveTextContent('временно недоступен');
 expect(screen.getByRole('link',{name:'Открыть демокаталог'})).toHaveAttribute('href','/vacancies?source=demo');
 expect(screen.queryByRole('heading',{name:vacancy.title})).not.toBeInTheDocument();
});
it('shows an empty result rather than a placeholder vacancy',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({...catalog,items:[],found:0,pages:0})));
 mount();expect(await screen.findByText(/На этой странице совпадений нет/)).toBeInTheDocument();
});
it('restores filter controls when navigation changes the query string',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json(catalog)));
 render(<MemoryRouter initialEntries={['/vacancies?source=demo&q=Python']}><Link to="/vacancies?source=demo&q=React">Change search externally</Link><VacanciesPage/></MemoryRouter>);
 expect(screen.getByLabelText('Поиск')).toHaveValue('Python');
 fireEvent.click(screen.getByRole('link',{name:'Change search externally'}));
 expect(screen.getByLabelText('Поиск')).toHaveValue('React');
 await screen.findByRole('heading',{name:vacancy.title});
});
it('never renders a provider-controlled unsafe source link',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({...vacancy,source:'trudvsem',source_url:'javascript:alert(1)'})));
 mount('/vacancies/trudvsem/1');await screen.findByRole('heading',{name:vacancy.title});
 expect(screen.queryByRole('link',{name:/Открыть оригинал/})).not.toBeInTheDocument();
});
it('uses open data by default and explains page-local filters',async()=>{
 const live={...vacancy,source:'trudvsem',id:'12345~abc-def',source_url:'https://trudvsem.ru/vacancy/card/12345/abc-def'};
 const fetch=vi.fn(async(url:string)=>Response.json(url.startsWith('/api/vacancies/trudvsem/')?live:{...catalog,source:'trudvsem',items:[live],found:120,pages:6,filtered_on_page:true}));
 vi.stubGlobal('fetch',fetch);mount('/vacancies?work_format=REMOTE');
 await screen.findByRole('heading',{name:vacancy.title});
 expect(fetch.mock.calls[0][0]).toContain('source=trudvsem');
 expect(screen.getByText(/Фильтры опыта и формата применены только/)).toBeInTheDocument();
 expect(screen.queryByText(/все компании, вакансии и зарплаты вымышлены/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('link',{name:'Подробнее →'}));
 const link=await screen.findByRole('link',{name:/Открыть оригинал на «Работе России»/});
 expect(link).toHaveAttribute('href',live.source_url);
});
