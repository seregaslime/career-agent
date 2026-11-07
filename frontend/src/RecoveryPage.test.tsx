import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { RecoveryCodes, RecoveryPage } from './RecoveryPage';

afterEach(() => vi.unstubAllGlobals());
it('requires acknowledging that the codes are saved', () => {
  const close = vi.fn();
  render(<RecoveryCodes codes={['ABCD-1234']} onClose={close} />);
  expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
  expect(close).toHaveBeenCalledOnce();
});
it('checks password confirmation and submits a code without putting it in a URL', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><RecoveryPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('Резервный код'), { target: { value: 'ABCD-1234' } });
  fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'synthetic-password' } });
  fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'different-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Установить новый пароль' }));
  expect(screen.getByText('Пароли не совпадают')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Установить новый пароль' }));
  await screen.findByText(/Пароль изменён/);
  expect(fetch).toHaveBeenCalledWith('/api/auth/recover', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'test@example.com', code: 'ABCD-1234', password: 'synthetic-password' }) }));
  expect(screen.queryByLabelText('Резервный код')).not.toBeInTheDocument();
});
