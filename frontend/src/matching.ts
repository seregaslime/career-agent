import type { Item } from './facts';

export type MatchingProfile = { role: string; skills: string[]; omittedSkills: number; location: string; workFormat: string; query: string };
export type MatchableVacancy = { title: string; description: string; skills: string[]; city: string; work_formats: string[] };
// Deliberately finite, reviewable vocabulary. Exact user-entered skills are supported too.
const vocabulary: [string, ...string[]][] = [
  ['Python', 'python3', 'питон'], ['JavaScript', 'javascript', 'js', 'ecmascript'],
  ['TypeScript', 'typescript', 'ts'], ['React', 'react.js', 'reactjs'], ['Vue', 'vue.js', 'vuejs'],
  ['Angular'], ['FastAPI', 'fast api'], ['Django'], ['Flask'], ['Node.js', 'nodejs', 'node js'],
  ['Express', 'express.js'], ['PostgreSQL', 'postgres', 'postgresql', 'постгрес'],
  ['MySQL'], ['SQLite'], ['MongoDB', 'mongo'], ['Redis'], ['SQL'], ['Docker', 'докер'],
  ['Kubernetes', 'k8s'], ['Git'], ['GitHub Actions'], ['Linux'], ['HTML', 'html5'],
  ['CSS', 'css3'], ['Java'], ['C++', 'cpp'], ['C#', 'csharp', 'c sharp'], ['.NET', 'dotnet'],
  ['Go', 'golang'], ['Rust'], ['pytest'], ['REST API', 'restful api'], ['aiogram'],
  ['SQLAlchemy'], ['Spring', 'spring boot'], ['Selenium'], ['Figma'], ['Excel'],
];
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const aliases = new Map(vocabulary.flatMap(([name, ...variants]) => [name, ...variants].map(alias => [normalize(alias), name])));
const canonical = (name: string) => aliases.get(normalize(name)) ?? name.trim();
const unique = (names: string[]) => [...new Map(names.filter(name => name.trim()).map(name => [normalize(canonical(name)), canonical(name)])).values()];
const text = (item: Item, key: string) => typeof item.data[key] === 'string' ? item.data[key] as string : '';
export function matchingProfile(profile: { target_role?: string; location?: string; work_format?: string }, items: Item[]): MatchingProfile {
  const skills = unique(items.filter(item => item.status === 'confirmed').flatMap(item => {
    if (item.kind === 'skill') return [text(item, 'name')];
    if (item.kind === 'project' && Array.isArray(item.data.technologies)) return item.data.technologies;
    return [];
  }));
  const role = profile.target_role?.trim() ?? '';
  return { role, skills: skills.slice(0, 100), omittedSkills: Math.max(0, skills.length - 100), location: profile.location?.trim() ?? '', workFormat: profile.work_format ?? '', query: (role || skills[0] || '').slice(0, 120) };
}
function mentions(source: string, alias: string) {
  const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(source);
}
export function matchVacancy(profile: MatchingProfile, vacancy: MatchableVacancy) {
  const source = normalize([vacancy.title, vacancy.description, ...vacancy.skills].join('\n'));
  const detected = vocabulary.filter(([name, ...variants]) => [name, ...variants].some(alias =>
    // "go" and "ts" in prose are ambiguous; accept them only as explicit skill names.
    ['go', 'ts'].includes(normalize(alias)) ? vacancy.skills.some(skill => normalize(skill) === normalize(alias)) : mentions(source, alias)
  )).map(([name]) => name);
  const found = unique([...vacancy.skills, ...detected, ...profile.skills.filter(skill => normalize(skill) !== 'go' && mentions(source, skill))]);
  const owned = new Set(profile.skills.map(normalize));
  const matched = found.filter(skill => owned.has(normalize(skill)));
  const missing = found.filter(skill => !owned.has(normalize(skill)));
  const desiredFormat: Record<string, string> = { remote: 'REMOTE', hybrid: 'HYBRID', office: 'ON_SITE' };
  const expected = desiredFormat[profile.workFormat];
  const format = !expected ? 'unspecified' : !vacancy.work_formats.length ? 'unknown' : vacancy.work_formats.includes(expected) ? 'match' : 'different';
  const location = !profile.location ? 'unspecified' : !vacancy.city ? 'unknown' : normalize(profile.location) === normalize(vacancy.city) ? 'match' : 'different';
  return { matched, missing, mentioned: found.length, format, location };
}
export function rankVacancies<T extends MatchableVacancy>(profile: MatchingProfile, vacancies: T[]) {
  return vacancies.map((vacancy, index) => ({ vacancy, match: matchVacancy(profile, vacancy), index }))
    .sort((a, b) => b.match.matched.length - a.match.matched.length
      || (a.match.matched.length ? a.match.missing.length - b.match.missing.length : 0)
      || a.index - b.index);
}
