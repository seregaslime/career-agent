import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { AdminPage } from './AdminPage';
import { ProfilePage } from './ProfilePage';
import { ServiceStatus } from './ServiceStatus';

const steps = [
  { path: '/chat', number: '01', title: 'Знакомство', text: 'Интересы, учёба и проекты. Начнём с того, что уже есть.', icon: '↗' },
  { path: '/profile', number: '02', title: 'Ваш профиль', text: 'Навыки и опыт, которые вы проверили и подтвердили.', icon: '◈' },
  { path: '/resume', number: '03', title: 'Резюме', text: 'Понятная история вашего опыта для первого отклика.', icon: '≡' },
  { path: '/vacancies', number: '04', title: 'Вакансии', text: 'Подходящие роли и навыки, которые стоит развить.', icon: '⌁' },
];

function Home() {
  return <>
    <div className="page-heading"><span className="eyebrow">ВАШ КАРЬЕРНЫЙ МАРШРУТ</span><span className="version">Версия 0.2 · Личный профиль</span></div>
    <section className="hero">
      <div className="hero-copy"><span className="pill">От интереса — к первому шагу</span>
        <h1>У вашего опыта<br />есть <em>направление.</em></h1>
        <p>Соберём проекты и навыки в цельную историю. Разберёмся, какая работа вам подходит и чему учиться дальше.</p>
        <Link className="button" to="/chat">Посмотреть первый шаг <span>↗</span></Link>
        <small>Сейчас готовим основу. Интервью и подбор появятся в следующих версиях.</small>
      </div>
      <div className="route-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="art-label top-label">ВАШ ПОТЕНЦИАЛ</div><div className="core">C<span>↗</span></div>
        <div className="art-chip chip-one">Проекты <b>↗</b></div><div className="art-chip chip-two">Навыки <b>+</b></div>
        <div className="art-chip chip-three">Следующий шаг <b>→</b></div><div className="art-label bottom-label">ОДИН ШАГ ЗА ДРУГИМ</div>
      </div>
    </section>
    <section className="route-section"><div className="section-heading"><h2>Как устроен маршрут</h2><span>4 шага к ясности</span></div>
      <div className="step-grid">{steps.map(step => <Link to={step.path} className="step-card" key={step.path}>
        <div className="step-top"><span>{step.number}</span><span className="step-icon">{step.icon}</span></div>
        <h3>{step.title}</h3><p>{step.text}</p><span className="step-link">{step.path === '/profile' ? 'Открыть' : 'Скоро'} <span>↗</span></span>
      </Link>)}</div>
    </section>
    <ServiceStatus />
  </>;
}

function Placeholder({ title }: { title: string }) {
  return <section className="placeholder"><span className="eyebrow">СЛЕДУЮЩИЙ ЭТАП</span><h1>{title}</h1>
    <p>Этот раздел ещё в разработке. Сейчас работает каркас приложения и проверка подключения к сервисам.</p>
    <Link className="button" to="/">Вернуться к маршруту →</Link></section>;
}

export function App() {
  return <div className="shell"><aside className="sidebar"><Link to="/" className="brand"><span className="brand-mark">C↗</span>career<span>agent</span></Link>
    <div className="workspace-name"><span className="workspace-icon">К</span><div>Личное пространство<small>Начало вашего пути</small></div></div>
    <span className="nav-label">ПРОСТРАНСТВО</span><nav aria-label="Основная навигация">
      <NavLink to="/" end><span>⌂</span>Обзор</NavLink>{steps.map(s => <NavLink to={s.path} key={s.path}><span>{s.icon}</span>{s.title}</NavLink>)}
    </nav><div className="sidebar-note"><span>МАЛЕНЬКИЕ ШАГИ, БОЛЬШИЕ ПЕРЕМЕНЫ</span><p>Не обязательно знать весь путь, чтобы начать.</p></div>
    <div className="sidebar-footer"><span className="live-dot" />Учебный проект · MVP</div>
  </aside><div className="main-wrap"><header className="topbar"><span>Личное пространство <span className="separator">/</span> Карьерный маршрут</span><Link className="build-label" to="/profile">Профиль / Вход</Link></header>
    <main><Routes><Route path="/" element={<Home />} /><Route path="/profile" element={<ProfilePage />} /><Route path="/admin" element={<AdminPage />} />{steps.filter(s => s.path !== '/profile').map(s => <Route path={s.path} key={s.path} element={<Placeholder title={s.title} />} />)}<Route path="*" element={<Placeholder title="Страница не найдена" />} /></Routes></main>
    <footer className="page-footer">Career Agent <span>Ваша карьера начинается с вас.</span></footer></div></div>;
}
