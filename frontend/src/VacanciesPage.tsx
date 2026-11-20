import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import './vacancies.css';

type Salary = {minimum:number|null;maximum:number|null;currency:string;gross:boolean|null;frequency:string|null};
type Vacancy = {id:string;source:'demo'|'hh';title:string;company:string;city:string;experience_label:string;work_formats:string[];salary:Salary|null;skills:string[];description:string;published_at:string|null;source_url:string|null};
type Catalog = {source:'demo'|'hh';items:Vacancy[];found:number;page:number;pages:number;fetched_at:string;hh_available:boolean};
const formats: Record<string,string> = {REMOTE:'Удалённо',HYBRID:'Гибрид',ON_SITE:'На месте'};
function useVacancies<T>(path:string) {
  const [result,setResult] = useState<{path:string;data?:T;error?:string}>({path:''});
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    let active=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    void (async()=>{
      try {
        const response=await fetch(path,{credentials:'same-origin',signal:controller.signal});
        const body=await response.json().catch(()=>null);
        if(!response.ok) throw new Error(typeof body?.detail==='string'?body.detail:'Сервис вакансий временно недоступен. Повторите запрос.');
        if(!body || typeof body!=='object') throw new Error('Сервис вернул некорректные данные.');
        if(active) setResult({path,data:body as T});
      } catch(error) {
        if(active) setResult({path,error:error instanceof Error && error.name!=='AbortError'?error.message:'Нет ответа от сервиса вакансий. Повторите позже.'});
      } finally {clearTimeout(timer);}
    })();
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[path,attempt]);
  return {data:result.path===path?result.data:undefined,error:result.path===path?result.error:undefined,retry:()=>{setResult({path:''});setAttempt(value=>value+1);}};
}
function salaryText(salary:Salary|null) {
  if(!salary) return 'Зарплата не указана';
  const number=(value:number)=>value.toLocaleString('ru-RU');
  const amount=salary.minimum!==null && salary.maximum!==null?`${number(salary.minimum)}–${number(salary.maximum)}`:salary.minimum!==null?`от ${number(salary.minimum)}`:salary.maximum!==null?`до ${number(salary.maximum)}`:'Не указана';
  return `${amount} ${salary.currency==='RUR'?'₽':salary.currency} · ${salary.frequency??'период не указан'}${salary.gross===true?' · до вычета налогов':salary.gross===false?' · на руки':''}`;
}
function date(value:string|null) {return value?new Date(value).toLocaleDateString('ru-RU'):'Не указана';}
function SourceLabel({source}:{source:string}) {return <span className="vacancy-source">{source==='demo'?'Демо · вымышленная вакансия':'Источник: hh.ru'}</span>;}
function Basics({item}:{item:Vacancy}) {return <><p className="vacancy-company">{item.company} · {item.city}</p><p>{salaryText(item.salary)}</p><p>Опыт: {item.experience_label} · Формат: {item.work_formats.length?item.work_formats.map(value=>formats[value]??value).join(', '):'не указан'}</p></>;}
export function VacanciesPage() {
  const [params]=useSearchParams();
  return <VacancyCatalog key={params.toString()}/>;
}
function VacancyCatalog() {
  const [params,setParams]=useSearchParams();
  const source=params.get('source')==='hh'?'hh':'demo';
  const page=Math.max(0,Math.min(99,Number(params.get('page'))||0));
  const [draft,setDraft]=useState({source,q:params.get('q')??'',experience:params.get('experience')??'',work_format:params.get('work_format')??''});
  const query=new URLSearchParams({source,q:params.get('q')??'',experience:params.get('experience')??'',work_format:params.get('work_format')??'',page:String(page)});
  const {data,error,retry}=useVacancies<Catalog>('/api/vacancies?'+query);
  function paginate(next:number) {const updated=new URLSearchParams(params);updated.set('page',String(next));setParams(updated);}
  return <section className="vacancies-page"><span className="eyebrow">ИССЛЕДУЕМ РЫНОК</span><h1>Вакансии</h1>
    <p>Просматривайте роли и требования. Персональный подбор по подтверждённому профилю появится следующим этапом.</p>
    {source==='demo'&&<p role="note" className="vacancy-notice">Демонстрационный набор: все компании, вакансии и зарплаты вымышлены. Это не реальные предложения работы.</p>}
    <form className="vacancy-filters" onSubmit={event=>{event.preventDefault();setParams({...draft,page:'0'});}}>
      <label>Источник<select value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value as 'demo'|'hh'})}><option value="demo">Демонстрационные вакансии</option><option value="hh">hh.ru</option></select></label>
      <label>Поиск<input value={draft.q} maxLength={120} placeholder="Python, React, стажёр…" onChange={e=>setDraft({...draft,q:e.target.value})}/></label>
      <label>Опыт<select value={draft.experience} onChange={e=>setDraft({...draft,experience:e.target.value})}><option value="">Любой</option><option value="noExperience">Без опыта</option><option value="between1And3">От 1 года до 3 лет</option><option value="between3And6">От 3 до 6 лет</option><option value="moreThan6">Более 6 лет</option></select></label>
      <label>Формат работы<select value={draft.work_format} onChange={e=>setDraft({...draft,work_format:e.target.value})}><option value="">Любой</option><option value="REMOTE">Удалённо</option><option value="HYBRID">Гибрид</option><option value="ON_SITE">На месте</option></select></label>
      <button className="button">Найти вакансии</button>
    </form>
    {!data&&!error&&<p role="status">Загружаем вакансии…</p>}
    {error&&<div role="alert"><p>{error}</p><button className="button secondary" onClick={retry}>Повторить загрузку</button>{source==='hh'&&<Link className="button secondary" to="/vacancies">Открыть демокаталог</Link>}</div>}
    {data&&<>{!data.hh_available&&<p>Реальные вакансии hh.ru появятся после подключения доступа к источнику. Демокаталог уже доступен.</p>}
      <p className="vacancy-meta">{data.source==='demo'?'Демо':'hh.ru'} · Найдено: {data.found} · Получено: {new Date(data.fetched_at).toLocaleString('ru-RU')}</p>
      {data.items.length===0&&<p role="status">По этим условиям вакансий нет. Измените поиск или фильтры.</p>}
      <div className="vacancy-grid">{data.items.map(item=><article className="vacancy-card" key={item.source+item.id}><SourceLabel source={item.source}/><h2><Link to={`/vacancies/${item.source}/${item.id}?${query}`}>{item.title}</Link></h2><Basics item={item}/><p className="vacancy-skills">{item.skills.join(' · ')||'Ключевые навыки уточняйте в карточке'}</p><small>Опубликовано: {date(item.published_at)}</small><Link className="vacancy-open" to={`/vacancies/${item.source}/${item.id}?${query}`}>Подробнее →</Link></article>)}</div>
      {data.pages>1&&<nav aria-label="Страницы вакансий" className="vacancy-pagination"><button disabled={page===0} onClick={()=>paginate(page-1)}>Назад</button><span>Страница {page+1} из {data.pages}</span><button disabled={page+1>=data.pages} onClick={()=>paginate(page+1)}>Далее</button></nav>}
    </>}
  </section>;
}
export function VacancyPage() {
  const {source,vacancyId}=useParams();
  const location=useLocation();
  const {data,error,retry}=useVacancies<Vacancy>(`/api/vacancies/${encodeURIComponent(source??'')}/${encodeURIComponent(vacancyId??'')}`);
  return <section className="vacancies-page"><Link className="vacancy-open" to={'/vacancies'+location.search}>← К списку вакансий</Link>
    {!data&&!error&&<p role="status">Загружаем карточку…</p>}
    {error&&<div role="alert"><p>{error}</p><button className="button secondary" onClick={retry}>Повторить загрузку</button></div>}
    {data&&<article className="vacancy-detail"><SourceLabel source={data.source}/><h1>{data.title}</h1><Basics item={data}/><p>Опубликовано: {date(data.published_at)}</p><h2>Описание</h2><p className="vacancy-description">{data.description||'Описание отсутствует'}</p><h2>Ключевые навыки</h2><p>{data.skills.join(' · ')||'Не указаны'}</p>
      {data.source==='demo'?<p role="note">Демонстрационная вакансия. Компания и условия вымышлены, отклик недоступен.</p>:data.source_url&&/^https:\/\/hh\.ru\/vacancy\/\d+$/.test(data.source_url)&&<a className="button" href={data.source_url} target="_blank" rel="noreferrer">Открыть оригинал на hh.ru ↗</a>}
    </article>}
  </section>;
}
