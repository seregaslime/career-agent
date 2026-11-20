import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Item } from './facts';
import { matchingProfile, matchVacancy, type MatchableVacancy } from './matching';
export type { MatchingProfile } from './matching';
class SignInRequired extends Error {}
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/profile' + path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); }
  catch { throw new Error('Сервер профиля не ответил. Повторите загрузку.'); }
  if (response.status === 401) throw new SignInRequired('Войдите в аккаунт для подбора по своему профилю.');
  if (!response.ok) throw new Error('Не удалось загрузить профиль для подбора. Повторите попытку.');
  return response.json();
}
export function useMatchingProfile() {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; data?: ReturnType<typeof matchingProfile>; error?: string; needsLogin?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([read<{ target_role: string; location: string; work_format: string }>('', controller.signal), read<Item[]>('/items?status=confirmed', controller.signal)])
      .then(([profile, items]) => {
        if (!Array.isArray(items)) throw new Error('Некорректный список навыков. Повторите загрузку профиля.');
        if (!controller.signal.aborted) setResult({ attempt, data: matchingProfile(profile, items) });
      }).catch(error => { if (!controller.signal.aborted) setResult({ attempt, error: error instanceof Error ? error.message : 'Не удалось загрузить профиль.', needsLogin: error instanceof SignInRequired }); });
    return () => controller.abort();
  }, [attempt]);
  return { ...(result?.attempt === attempt ? result : {}), retry: () => setAttempt(value => value + 1) };
}
export function MatchExplanation({ profile, vacancy }: { profile: ReturnType<typeof matchingProfile>; vacancy: MatchableVacancy }) {
  const result = matchVacancy(profile, vacancy);
  return <div className="vacancy-match">
    <h3>Совпадения с профилем: {result.matched.length} из {result.mentioned} упомянутых навыков</h3>
    {result.matched.length > 0 ? <p><strong>Совпало:</strong> {result.matched.join(', ')}</p> : <p>Совпадений навыков не найдено.</p>}
    {result.missing.length > 0 && <p><strong>Не указано в профиле:</strong> {result.missing.join(', ')}</p>}
    {!result.mentioned && <p>Не удалось выделить технологии из текста. Требования нужно проверить вручную.</p>}
    {result.format !== 'unspecified' && <p>Формат работы: {result.format === 'match' ? 'совпадает с предпочтением' : result.format === 'unknown' ? 'вакансия не уточняет формат' : 'отличается от предпочтения — проверьте условия' }.</p>}
    {result.location !== 'unspecified' && <p>Регион: {result.location === 'match' ? 'совпадает с профилем' : result.location === 'unknown' ? 'не указан' : 'название отличается от профиля — проверьте географию и удалённую работу'}.</p>}
  </div>;
}
export function ProfileMatchingError({ error, needsLogin, retry }: { error?: string; needsLogin?: boolean; retry: () => void }) {
  return error ? <div role="alert"><p>{error}</p>{needsLogin ? <Link to="/profile">Войти в аккаунт</Link> : <button className="button secondary" onClick={retry}>Повторить загрузку профиля</button>}</div> : <p role="status">Загружаем профиль для подбора…</p>;
}
