import { useState } from 'react';
import { Link } from 'react-router-dom';

export function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  return <section className="placeholder"><h2>Сохраните резервные коды</h2>
    <p>Каждый код позволяет один раз установить новый пароль. Сохраните их в менеджере паролей или запишите и храните отдельно. После закрытия эти коды больше не показываются.</p>
    <ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
    <label><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> Я сохранил коды</label>
    <button className="button" disabled={!saved} onClick={onClose}>Готово</button>
  </section>;
}

export function RecoveryPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setMessage('Пароли не совпадают'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await fetch('/api/auth/recover', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, password }) });
      if (!result.ok) {
        const data = await result.json().catch(() => ({}));
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось восстановить доступ. Проверьте поля.');
      }
      setCode(''); setPassword(''); setConfirmation(''); setDone(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  }
  return <section className="placeholder profile-page"><h1>Восстановление доступа</h1>
    {done ? <p role="status">Пароль изменён. Старые сеансы завершены. Войдите с новым паролем.</p> : <>
      <p>Введите один из сохранённых резервных кодов. Использованный код станет недействительным.</p>
      {message && <p role="status">{message}</p>}
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Резервный код<input required autoComplete="off" maxLength={100} value={code} onChange={e => setCode(e.target.value)} /></label>
        <label>Новый пароль<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Повторите пароль<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        <button className="button" disabled={busy}>{busy ? 'Подождите…' : 'Установить новый пароль'}</button>
      </form></>}
    <Link to="/profile">Перейти ко входу</Link>
  </section>;
}
