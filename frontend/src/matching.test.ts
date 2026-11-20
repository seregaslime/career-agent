import { expect, it } from 'vitest';
import type { Item } from './facts';
import { matchingProfile, matchVacancy, rankVacancies } from './matching';
const item = (kind: Item['kind'], data: Item['data'], status: Item['status'] = 'confirmed'): Item => ({ id: 'synthetic', kind, data, status, source: 'manual', turn_id: null, evidence: null, created_at: '', updated_at: '' });
const candidate = (skills: string[]) => matchingProfile({ target_role: 'Backend', work_format: 'remote', location: 'Москва' }, skills.map(name => item('skill', { name })));
const vacancy = (description: string, skills: string[] = []) => ({ title: 'Стажировка', description, skills, city: 'Москва', work_formats: ['REMOTE'] });
it('uses only confirmed skills and project technologies, normalizes aliases and deduplicates', () => {
  const result = matchingProfile({}, [item('skill', { name: 'JS' }), item('project', { technologies: ['JavaScript', 'postgres'] }), item('skill', { name: 'Docker' }, 'suggested'), item('project', { technologies: ['Git'] }, 'rejected')]);
  expect(result.skills).toEqual(['JavaScript', 'PostgreSQL']);
  expect(result.query).toBe('JavaScript');
});
it('recognizes aliases, extracts description-only mentions and explains missing skills', () => {
  const result = matchVacancy(candidate(['JS', 'Postgres']), vacancy('JavaScript, postgres, Docker', ['PostgreSQL']));
  expect(result.matched).toEqual(['PostgreSQL', 'JavaScript']);
  expect(result.missing).toEqual(['Docker']);
  expect(result.mentioned).toBe(3);
  expect(result.format).toBe('match');
});
it('uses token boundaries and escapes symbols; Java does not match JavaScript', () => {
  const result = matchVacancy(candidate(['Java', 'C++', 'C#', '.NET', 'Git']), vacancy('JavaScript C++ / C# и .NET; GitLab'));
  expect(result.matched).toEqual(['C++', 'C#', '.NET']);
  expect(result.missing).toEqual(['JavaScript']);
});
it('does not treat ordinary Go prose as a programming skill, but accepts Golang and explicit Go', () => {
  expect(matchVacancy(candidate(['Go']), vacancy('We go to meetups')).matched).toEqual([]);
  expect(matchVacancy(candidate(['Go']), vacancy('Golang')).matched).toEqual(['Go']);
  expect(matchVacancy(candidate(['Go']), vacancy('', ['Go'])).matched).toEqual(['Go']);
});
it('supports explicit skills outside the vocabulary without inventing other absent requirements', () => {
  expect(matchVacancy(candidate(['Adobe Photoshop']), vacancy('Опыт в Adobe Photoshop.')).matched).toEqual(['Adobe Photoshop']);
  expect(matchVacancy(candidate(['Python']), vacancy('Разработка приложений')).mentioned).toBe(0);
});
it('distinguishes unknown conditions from different ones and does not assume geographic equivalence', () => {
  expect(matchVacancy(candidate([]), { ...vacancy(''), city: '', work_formats: [] })).toMatchObject({ format: 'unknown', location: 'unknown' });
  expect(matchVacancy(candidate([]), { ...vacancy(''), city: 'Московская область', work_formats: ['ON_SITE'] })).toMatchObject({ format: 'different', location: 'different' });
});
it('preserves source order for tied and unscorable jobs without modifying input', () => {
  const jobs = [vacancy('Docker'), vacancy('Ничего из словаря'), vacancy('Git')];
  expect(rankVacancies(candidate([]), jobs).map(row => row.vacancy)).toEqual(jobs);
  expect(jobs[0].description).toBe('Docker');
});
it('bounds the profile vocabulary and reports omissions', () => {
  const result = candidate(Array.from({ length: 120 }, (_, i) => 'Skill '+i));
  expect(result.skills).toHaveLength(100);
  expect(result.omittedSkills).toBe(20);
});
const jobs = [
  { ...vacancy('Python FastAPI PostgreSQL Docker'), title: 'backend' },
  { ...vacancy('JavaScript React TypeScript'), title: 'frontend' },
  { ...vacancy('SQL Python Excel'), title: 'data' },
  { ...vacancy('Java Spring PostgreSQL'), title: 'java' },
  { ...vacancy('Figma CSS HTML'), title: 'design' },
];
it.each([
  [['Python', 'FastAPI'], 'backend'], [['JS', 'React'], 'frontend'], [['Excel', 'SQL'], 'data'],
  [['Java', 'Spring'], 'java'], [['Figma', 'HTML'], 'design'], [['TS'], 'frontend'],
  [['Docker'], 'backend'], [['CSS', 'HTML'], 'design'], [['SQL', 'Excel', 'Python'], 'data'],
  [['Spring'], 'java'],
])('ranks a manually expected first job for synthetic profile %j', (skills, expected) => {
  expect(rankVacancies(candidate(skills as string[]), jobs)[0].vacancy.title).toBe(expected);
});
