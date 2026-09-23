import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, readSession, writeSession } from './api';
import { authenticate } from './auth';
import { fromData, PERSISTED, reducer, type Action } from './reducer';
import { DEFAULT_DICTIONARIES } from './seed';
import { DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_USERS } from './access';
import { loadState, saveState, StoreContext, type Sync } from './store';
import type { AppState, DirectoryUser, User } from './types';
import { planRows, syncStaff } from './data';
import { searchDemoDirectory } from './staff';
import { DEFAULT_UNITS } from './units';
import { DEFAULT_TEMPLATES } from './templates';

type Mode = 'local' | 'remote';

/** Режим по умолчанию: в тестах и при VITE_BACKEND=local — данные в браузере, иначе — база на сервере. */
const defaultMode = (): Mode => (import.meta.env.MODE === 'test' || import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'remote');

const emptyState = (user: User | null): AppState => ({ version: 5, tasks: [], reports: [], messages: [], chatReads: [], absences: [], entitlements: [], planRows: planRows.map((row) => ({ ...row })), dictionaries: DEFAULT_DICTIONARIES, users: DEFAULT_USERS, roles: DEFAULT_ROLES, units: DEFAULT_UNITS.map((u) => ({ ...u })), templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })), authentication: { ...DEFAULT_AUTHENTICATION }, user });

const BAD_LOGIN = 'Неверный логин или пароль. Проверьте данные и повторите вход.';
const REFRESH_MS = 60_000;

export const StoreProvider = ({ children, initial, mode = defaultMode() }: { children: ReactNode; initial?: AppState; mode?: Mode }) =>
  mode === 'local' ? <LocalStore initial={initial}>{children}</LocalStore> : <RemoteStore>{children}</RemoteStore>;

/** Данные в localStorage браузера: тесты и работа без сервера. */
const LocalStore = ({ children, initial }: { children: ReactNode; initial?: AppState }) => {
  const [state, dispatch] = useReducer(reducer, initial, (init) => init ?? loadState());
  useEffect(() => saveState(state), [state]);
  const signIn = useCallback(async (email: string, password: string) => {
    const a = authenticate(email, password, state.users, state.roles);
    if (!a) return BAD_LOGIN;
    dispatch({ type: 'login', ...a });
    return null;
  }, [state.users, state.roles]);
  const signInWindows = useCallback(async () => 'Windows-аутентификация доступна только при работе через настроенный сервер.', []);
  const searchDirectory = useCallback(async (query: string): Promise<DirectoryUser[]> => searchDemoDirectory(query), []);
  const sync: Sync = useMemo(() => ({ mode: 'local', loading: false, saving: false, syncedAt: null, error: null }), []);
  // Состав сотрудников и отделений — из пользователей и подразделений (до отрисовки экранов).
  syncStaff(state.users, state.units);
  const value = useMemo(() => ({ state, dispatch, signIn, signInWindows, windowsAuthAvailable: false, authenticationReady: true, directoryAvailable: true, searchDirectory, sync, reload: () => undefined, fetchNotices: null }), [state, signIn, signInWindows, searchDirectory, sync]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

/**
 * Данные в базе на сервере. Изменение сразу применяется на экране, затем отправляется на сервер;
 * ответ сервера заменяет локальное состояние. При ошибке данные перечитываются, а пользователь видит причину.
 */
const RemoteStore = ({ children }: { children: ReactNode }) => {
  const [initial] = useState(readSession);
  const session = useRef(initial);
  const [state, setState] = useState<AppState>(() => emptyState(initial?.user ?? null));
  const [sync, setSync] = useState<Sync>({ mode: 'remote', loading: !!initial, saving: false, syncedAt: null, error: null });
  const [windowsAuthAvailable, setWindowsAuthAvailable] = useState(false);
  const [authenticationReady, setAuthenticationReady] = useState(false);
  const [directoryAvailable, setDirectoryAvailable] = useState(false);
  const pending = useRef(0);

  const signOut = useCallback(() => {
    session.current = null;
    writeSession(null);
    setState((current) => ({ ...emptyState(null), authentication: current.authentication }));
    setSync((s) => ({ ...s, loading: false, saving: false, error: null }));
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return signOut();
      setSync((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Неизвестная ошибка.' }));
    },
    [signOut],
  );

  /** Перечитывает данные; keepError — не прятать причину только что отклонённого сохранения. */
  const load = useCallback(async (keepError = false) => {
    const token = session.current?.token;
    if (!token) return;
    try {
      const { data } = await api.state(token);
      // Пока идёт сохранение, не затираем свежие правки на экране устаревшим ответом.
      if (pending.current === 0) setState((s) => fromData(data, s.user));
      setSync((s) => ({ ...s, loading: false, error: keepError ? s.error : null, syncedAt: new Date() }));
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    api.authentication().then(({ authentication, windowsAvailable, directoryAvailable: available }) => {
      setState((current) => ({ ...current, authentication }));
      setWindowsAuthAvailable(windowsAvailable);
      setDirectoryAvailable(available);
      setAuthenticationReady(true);
    }).catch(() => { setWindowsAuthAvailable(false); setDirectoryAvailable(false); setAuthenticationReady(true); });
  }, []);

  useEffect(() => {
    void load();
    const tick = window.setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const dispatch = useCallback(
    (action: Action) => {
      if (action.type === 'logout') return signOut();
      setState((s) => reducer(s, action));
      if (!PERSISTED.includes(action.type)) return;
      const token = session.current?.token;
      if (!token) return;
      pending.current += 1;
      setSync((s) => ({ ...s, saving: true, error: null }));
      api
        .action(token, action)
        .then(({ data }) => {
          pending.current -= 1;
          if (pending.current === 0) setState((s) => fromData(data, s.user));
          setSync((s) => ({ ...s, saving: pending.current > 0, syncedAt: new Date() }));
        })
        .catch((e) => {
          pending.current -= 1;
          setSync((s) => ({ ...s, saving: pending.current > 0 }));
          fail(e);
          void load(true);
        });
    },
    [fail, load, signOut],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const s = await api.login(email, password);
        session.current = s;
        writeSession(s);
        setState(emptyState(s.user));
        setSync((x) => ({ ...x, loading: true, error: null }));
        await load();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : BAD_LOGIN;
      }
    },
    [load],
  );

  const signInWindows = useCallback(async () => {
    try {
      const s = await api.windowsLogin();
      session.current = s;
      writeSession(s);
      setState((current) => ({ ...emptyState(s.user), authentication: current.authentication }));
      setSync((current) => ({ ...current, loading: true, error: null }));
      await load();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Не удалось выполнить вход через Windows.';
    }
  }, [load]);

  const searchDirectory = useCallback(async (query: string): Promise<DirectoryUser[]> => {
    const token = session.current?.token;
    if (!token) return [];
    const result = await api.directoryUsers(token, query);
    return result.users;
  }, []);

  const fetchNotices = useCallback(async (since: string | null) => {
    const token = session.current?.token;
    if (!token) throw new Error('Войдите в систему.');
    return api.notices(token, since);
  }, []);

  syncStaff(state.users, state.units);
  const value = useMemo(() => ({ state, dispatch, signIn, signInWindows, windowsAuthAvailable, authenticationReady, directoryAvailable, searchDirectory, sync, reload: () => void load(), fetchNotices }), [state, dispatch, signIn, signInWindows, windowsAuthAvailable, authenticationReady, directoryAvailable, searchDirectory, sync, load, fetchNotices]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};
