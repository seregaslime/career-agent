import { useEffect, useState } from 'react';
import { cleanData, describe, kindOrder, kinds, profileApi, toForm, type FactData, type Item, type Kind } from './facts';

type Draft = { kind: Kind; values: Record<string, string>; item?: Item };

function ItemForm({ draft, busy, submit, cancel }: { draft: Draft; busy: boolean; submit: (data: FactData) => void; cancel: () => void }) {
  const [values, setValues] = useState(draft.values);
  const config = kinds[draft.kind];
  return <form className="fact-form" onSubmit={event => { event.preventDefault(); const data = cleanData(draft.kind, values); if (data) submit(data); }}>
    {config.fields.map(field => <label key={field.key}>{field.label}
      {field.options ? <select value={values[field.key] ?? ''} onChange={e => setValues({ ...values, [field.key]: e.target.value })}>{field.options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        : field.long ? <textarea value={values[field.key] ?? ''} maxLength={field.max} onChange={e => setValues({ ...values, [field.key]: e.target.value })} />
        : <input value={values[field.key] ?? ''} required={field.required} maxLength={field.list ? 1300 : field.max} onChange={e => setValues({ ...values, [field.key]: e.target.value })} />}
    </label>)}
    <div className="fact-actions"><button className="button" disabled={busy}>Сохранить</button><button type="button" className="button secondary" disabled={busy} onClick={cancel}>Отмена</button></div>
  </form>;
}

export function ProfileFacts() {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    profileApi<unknown>('/items').then(rows => {
      if (!active) return;
      if (!Array.isArray(rows)) throw new Error('Сервер вернул некорректный список фактов.');
      setItems(rows as Item[]); setLoaded(true); setError('');
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить факты профиля.'); });
    return () => { active = false; };
  }, [attempt]);

  async function act(work: () => Promise<void>, done: string) {
    setBusy(true); setMessage(''); setError('');
    try { await work(); setMessage(done); setDraft(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения.'); }
    finally { setBusy(false); }
  }
  const replace = (next: Item) => setItems(rows => rows.map(row => row.id === next.id ? next : row));
  const remove = (item: Item) => act(async () => { await profileApi<null>(`/items/${item.id}`, 'DELETE'); setItems(rows => rows.filter(row => row.id !== item.id)); }, 'Запись удалена');
  function submit(current: Draft, data: FactData) {
    if (!current.item) return act(async () => { const created = await profileApi<Item>('/items', 'POST', { kind: current.kind, data }); setItems(rows => [...rows, created]); }, 'Запись добавлена');
    const item = current.item;
    return act(async () => replace(await profileApi<Item>(`/items/${item.id}`, 'PATCH', { data })), 'Изменения сохранены');
  }
  const form = (kind: Kind, item?: Item) => draft && draft.kind === kind && draft.item?.id === item?.id
    ? <ItemForm key={item?.id ?? 'new-' + kind} draft={draft} busy={busy} submit={data => void submit(draft, data)} cancel={() => setDraft(null)} /> : null;

  if (!loaded) return <section className="profile-facts" aria-label="Факты профиля"><h2>Навыки, проекты и опыт</h2>
    {error ? <><p role="status">{error}</p><button className="button secondary" onClick={() => setAttempt(value => value + 1)}>Повторить загрузку фактов</button></> : <p role="status">Загружаем факты профиля…</p>}</section>;
  return <section className="profile-facts" aria-label="Факты профиля">
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {kindOrder.map(kind => {
      const rows = items.filter(item => item.kind === kind && item.status !== 'rejected');
      return <div className="fact-group" key={kind}><h2>{kinds[kind].title}</h2>
        {rows.length === 0 && <p>Пока пусто. Расскажите об этом в интервью — агент сам добавит запись, — или добавьте вручную.</p>}
        {rows.map(item => <article className="fact" key={item.id}><strong>{describe(item.kind, item.data)}</strong>
          {item.source === 'interview' && <span className="fact-source" title={item.evidence ? `«${item.evidence}»` : undefined}>из интервью</span>}
          {item.kind !== 'skill' && typeof item.data.description === 'string' && item.data.description && <p>{item.data.description}</p>}
          {form(kind, item) ?? <div className="fact-actions">
            <button className="button secondary" disabled={busy} onClick={() => setDraft({ kind, values: toForm(kind, item.data), item })}>Изменить</button>
            <button className="button secondary" disabled={busy} onClick={() => void remove(item)}>Удалить</button>
          </div>}
        </article>)}
        {form(kind) ?? <button className="button secondary" disabled={busy} onClick={() => setDraft({ kind, values: toForm(kind, {}) })}>Добавить {kinds[kind].one}</button>}
      </div>;
    })}
  </section>;
}
