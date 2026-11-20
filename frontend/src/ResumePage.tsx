import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Item, type Kind, levels } from './facts';
import './resume.css';

type Profile = { full_name: string; target_role: string; education: string; about: string; work_format?: string; location?: string };
type Resume = { profile: Profile; items: Item[]; email: string };
class SignInRequired extends Error {}
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), cache: 'no-store' });
  if (response.status === 401) throw new SignInRequired('Войдите в аккаунт, чтобы собрать своё резюме.');
  if (!response.ok) throw new Error('Не удалось загрузить резюме. Повторите попытку.');
  return response.json();
}
const formats: Record<string, string> = { office: 'Офис', remote: 'Удалённо', hybrid: 'Гибрид', any: 'Любой формат работы' };
const value = (item: Item, field: string) => typeof item.data[field] === 'string' ? item.data[field] as string : '';
function Entry({ item }: { item: Item }) {
  const title = value(item, item.kind === 'project' ? 'title' : item.kind === 'experience' ? 'position' : 'institution');
  const subtitle = [value(item, 'role'), value(item, 'organization'), value(item, 'program'), value(item, 'period')].filter(Boolean).join(' · ');
  const technologies = item.data.technologies;
  return <article className="resume-entry"><h3>{title}</h3>{subtitle && <p className="resume-meta">{subtitle}</p>}
    {Array.isArray(technologies) && technologies.length > 0 && <p className="resume-meta">{technologies.join(' · ')}</p>}
    {value(item, 'description') && <p>{value(item, 'description')}</p>}
  </article>;
}
export function ResumeDocument({ profile, items, email }: Resume) {
  // Defense in depth: only confirmed records can reach the printable document.
  const group = (kind: Kind) => items.filter(item => item.status === 'confirmed' && item.kind === kind);
  const skills = group('skill');
  return <article className="resume-paper" aria-label="Предпросмотр резюме">
    <header className="resume-header"><h2>{profile.full_name || 'Укажите имя в профиле'}</h2>
      {profile.target_role && <p className="resume-role">{profile.target_role}</p>}
      {(profile.location || profile.work_format) && <p className="resume-meta">{[profile.location, formats[profile.work_format ?? '']].filter(Boolean).join(' · ')}</p>}
      {email.trim() && <p className="resume-contact">{email.trim()}</p>}
    </header>
    {profile.about.trim() && <section><h2>О себе</h2><p>{profile.about}</p></section>}
    {skills.length > 0 && <section><h2>Навыки</h2><ul className="resume-skills">{skills.map(item => <li key={item.id}>{value(item, 'name')}{levels.find(([key]) => key && key === item.data.level)?.[1] && <span> · {levels.find(([key]) => key === item.data.level)?.[1]}</span>}</li>)}</ul></section>}
    {(['experience', 'project', 'education'] as const).map(kind => {
      const rows = group(kind);
      const summary = kind === 'education' ? profile.education.trim() : '';
      return rows.length || summary ? <section key={kind}><h2>{{ experience: 'Опыт работы', project: 'Проекты', education: 'Образование' }[kind]}</h2>
        {summary && <p>{summary}</p>}{rows.map(item => <Entry key={item.id} item={item} />)}
      </section> : null;
    })}
  </article>;
}
export function ResumePage() {
  const [data, setData] = useState<Resume | null>(null);
  const [email, setEmail] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      read<Profile>('/profile', controller.signal),
      read<Item[]>('/profile/items?status=confirmed', controller.signal),
      read<{ email: string }>('/auth/me', controller.signal),
    ]).then(([profile, items, user]) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(items)) throw new Error('Некорректные данные профиля. Повторите загрузку.');
      setData({ profile, items: items.filter(item => item.status === 'confirmed'), email: user.email });
      setEmail(user.email);
    }).catch(reason => {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Сервер не ответил. Повторите загрузку.'); setNeedsLogin(reason instanceof SignInRequired); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const previous = document.title;
    if (data) document.title = `Резюме — ${data.profile.full_name || 'Career Agent'}`;
    return () => { document.title = previous; };
  }, [data]);
  function reload() { setData(null); setLoading(true); setError(''); setNeedsLogin(false); setAttempt(n => n + 1); }
  const profile = data?.profile;
  const hasContent = !!data && !!(data.items.length || profile?.about.trim() || profile?.education.trim());
  const missing = profile ? [
    !profile.full_name.trim() && 'Укажите имя.',
    !profile.target_role.trim() && 'Укажите желаемую должность.',
    !data?.items.some(item => item.kind === 'project' || item.kind === 'experience') && 'Добавьте проект или опыт: какие задачи вы решали и что получилось.',
    !email.trim() && 'Добавьте контакт для связи или оставьте его пустым, если не хотите включать в PDF.',
  ].filter(Boolean) : [];
  return <section className="resume-page"><div className="resume-controls">
    <span className="eyebrow">ОТ ОПЫТА К РЕЗУЛЬТАТУ</span><h1>Ваше резюме</h1>
    <p>Резюме собирается из сохранённого профиля без дополнительных запросов к модели. Проверьте сведения перед сохранением.</p>
    <div className="resume-actions"><Link className="button secondary" to="/profile">Редактировать профиль</Link><button className="button secondary" onClick={reload} disabled={loading}>Обновить из профиля</button></div>
    {loading && <p role="status">Собираем резюме из профиля…</p>}
    {error && <div role="alert"><p>{error}</p>{needsLogin ? <Link to="/profile">Войти в аккаунт</Link> : <button className="button secondary" onClick={reload}>Повторить загрузку</button>}</div>}
    {data && <>
      {!hasContent && <p role="status">Пока недостаточно сведений для резюме. <Link to="/chat">Пройдите интервью</Link> или добавьте сведения в профиле.</p>}
      {missing.length > 0 && <aside className="resume-hints"><h2>Что ещё уточнить</h2><ul>{missing.map(hint => <li key={String(hint)}>{hint}</li>)}</ul></aside>}
      <label className="resume-email">Email для резюме<input aria-label="Email для резюме" aria-describedby="resume-email-hint" type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /><small id="resume-email-hint">Меняется только в этом предпросмотре. Можно очистить; email входа останется прежним.</small></label>
      <div className="resume-export"><button className="button" disabled={!hasContent || !profile?.full_name.trim()} onClick={() => window.print()}>Сведения проверены — печать / PDF</button>
        <p>В окне печати выберите «Сохранить как PDF», формат A4 и отключите колонтитулы браузера. Пустые разделы не выводятся.</p></div>
      <p className="resume-limit">Правки сохраняются в профиле; здесь показан его снимок на момент загрузки. Истории версий резюме пока нет.</p>
    </>}
  </div>{data && hasContent && <ResumeDocument {...data} email={email} />}</section>;
}
