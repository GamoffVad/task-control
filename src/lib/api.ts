// Запросы к серверу (server/app.ts).
import type { Action } from './reducer';
import type { AuthenticationSettings, Data, DirectoryUser, User } from './types';

export class ApiError extends Error {
  status: number;
  /** Сеанс недействителен — нужно войти заново. */
  relogin: boolean;
  constructor(status: number, message: string, relogin = false) {
    super(message);
    this.status = status;
    this.relogin = relogin;
  }
}

/** Ответ 401 с телом — для проверки Windows-входа это результат, а не ошибка. */
const call = async <T>(path: string, init: { method?: string; token?: string; body?: unknown; accept401?: boolean } = {}): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        // Не Authorization: этот заголовок нужен IIS для проверки подлинности Windows.
        ...(init.token ? { 'x-tc-token': init.token } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте подключение к сети.');
  }
  const json = await res.json().catch(() => ({}));
  if (init.accept401 && res.status === 401 && json.error === undefined) return json as T;
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Сервер ответил ошибкой ${res.status}.`, json.relogin === true || res.status === 401);
  return json as T;
};

/** Действие для отправки: время ставит сервер. */
const wire = (a: Action) => {
  const { now: _now, ...rest } = a as Action & { now?: Date };
  return rest;
};

/** Что сервер увидел в запросе для входа через Windows — проверка настройки в администрировании. */
export type WindowsCheck = {
  enabled: boolean;
  secretRequired: boolean;
  secretOk: boolean;
  seen: { header: string; value: string }[];
  identity: string | null;
  matched: { employeeId: number; fullName: string; windowsLogin: string; active: boolean } | null;
  problem: string | null;
};

export const api = {
  login: (email: string, password: string) => call<{ token: string; user: User }>('login', { method: 'POST', body: { email, password } }),
  windowsCheck: (token: string) => call<WindowsCheck>('windows-check', { token, accept401: true }),
  windowsLogin: () => call<{ token: string; user: User }>('windows-login', { method: 'POST' }),
  authentication: () => call<{ authentication: AuthenticationSettings; windowsAvailable: boolean; directoryAvailable: boolean }>('authentication'),
  directoryUsers: (token: string, query: string) => call<{ users: DirectoryUser[] }>(`directory-users?q=${encodeURIComponent(query)}`, { token }),
  state: (token: string) => call<{ data: Data }>('state', { token }),
  notices: (token: string, since: string | null) =>
    call<{ notices: import('./notices').ServerNotice[]; now: string }>(`notices${since ? `?since=${encodeURIComponent(since)}` : ''}`, { token }),
  action: (token: string, action: Action) => call<{ data: Data }>('action', { method: 'POST', token, body: { action: wire(action) } }),
};

export const SESSION_KEY = 'task-control:session';

export type Session = { token: string; user: User };

export const readSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && typeof s.token === 'string' && s.user ? s : null;
  } catch {
    return null;
  }
};

export const writeSession = (s: Session | null) => {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Без хранилища сеанс живёт до перезагрузки страницы.
  }
};
