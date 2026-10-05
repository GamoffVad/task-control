// В режиме «Windows» сеанс, открытый по паролю, заменяется входом под учётной записью Windows.
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../lib/StoreProvider';
import { useStore } from '../lib/store';
import { toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { AuthenticationMode } from '../lib/types';

const ADMIN = { email: 'user@example.com', employeeId: 1, role: 'administrator' as const };
const ME = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' as const };

let mode: AuthenticationMode = 'form';
let windowsCalls = 0;

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  mode = 'form';
  windowsCalls = 0;
  const data = toData(createSeed(new Date(2026, 9, 5)));
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api\//, '').split('?')[0];
    if (path === 'authentication') return reply({ authentication: { mode, allowEmergencyForm: true }, windowsAvailable: true, directoryAvailable: false });
    if (path === 'login') return reply({ token: 'form-token', user: ADMIN });
    if (path === 'windows-login') {
      windowsCalls += 1;
      return mode === 'windows' ? reply({ token: 'windows-token', user: ME }) : reply({ error: 'Вход через Windows не включён администратором.' }, 409);
    }
    if (path === 'action') {
      const action = JSON.parse(String(init?.body)).action;
      if (action.type === 'saveAuthentication') mode = action.mode;
      return reply({ data: { ...data, authentication: { mode, allowEmergencyForm: true } } });
    }
    if (path === 'state') return reply({ data: { ...data, authentication: { mode, allowEmergencyForm: true } } });
    if (path === 'notices') return reply({ notices: [], now: new Date().toISOString() });
    return reply({ error: 'нет' }, 404);
  });
});
afterEach(() => vi.unstubAllGlobals());

const Probe = () => {
  const { state, signIn, dispatch } = useStore();
  return (
    <div>
      <span data-testid="who">{state.user?.email ?? 'никто'}</span>
      <button onClick={() => void signIn('user@example.com', '123456')}>пароль</button>
      <button onClick={() => dispatch({ type: 'saveAuthentication', mode: 'windows', allowEmergencyForm: true })}>windows</button>
    </div>
  );
};

const renderRemote = () => render(<StoreProvider mode="remote"><Probe /></StoreProvider>);

describe('сеанс в режиме «Windows»', () => {
  it('после переключения на «Windows» сеанс по паролю сменяется учётной записью Windows', async () => {
    renderRemote();
    await act(async () => screen.getByText('пароль').click());
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent(ADMIN.email));
    await act(async () => screen.getByText('windows').click());
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent(ME.email));
    expect(windowsCalls).toBe(1);
  });

  it('резервный вход по паролю при включённом режиме «Windows» не подменяется', async () => {
    mode = 'windows';
    renderRemote();
    // Дождаться загрузки настройки входа, затем войти по паролю.
    await waitFor(() => expect(windowsCalls).toBe(0));
    await new Promise((r) => setTimeout(r, 50));
    await act(async () => screen.getByText('пароль').click());
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent(ADMIN.email));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByTestId('who')).toHaveTextContent(ADMIN.email);
    expect(windowsCalls).toBe(0);
  });
});
