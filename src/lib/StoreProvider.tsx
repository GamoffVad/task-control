import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, readSession, writeSession } from './api';
import { authenticate } from './auth';
import { fromData, PERSISTED, reducer, type Action } from './reducer';
import { DEFAULT_DICTIONARIES } from './seed';
import { DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_SCORING, DEFAULT_USERS } from './access';
import { loadAppearance, storeAppearance } from './appearance';
import { loadState, saveState, StoreContext, type Sync } from './store';
import type { AppState, DirectoryUser, User } from './types';
import { planRows, syncCategories, syncStaff } from './data';
import { searchDemoDirectory } from './staff';
import { DEFAULT_UNITS } from './units';
import { DEFAULT_TEMPLATES } from './templates';

type Mode = 'local' | 'remote';

/** Режим по умолчанию: в тестах и при VITE_BACKEND=local — данные в браузере, иначе — база на сервере. */
const defaultMode = (): Mode => (import.meta.env.MODE === 'test' || import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'remote');

const emptyState = (user: User | null): AppState => ({ version: 5, tasks: [], reports: [], messages: [], chatReads: [], absences: [], entitlements: [], planRows: planRows.map((row) => ({ ...row })), dictionaries: DEFAULT_DICTIONARIES, users: DEFAULT_USERS, roles: DEFAULT_ROLES, units: DEFAULT_UNITS.map((u) => ({ ...u })), templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })), authentication: { ...DEFAULT_AUTHENTICATION }, scoring: { ...DEFAULT_SCORING }, appearance: loadAppearance(user?.employeeId), user });

const BAD_LOGIN = 'Неверный логин или пароль. Проверьте данные и повторите вход.';
const REFRESH_MS = 60_000;

export const StoreProvider = ({ children, initial, mode = defaultMode() }: { children: ReactNode; initial?: AppState; mode?: Mode }) =>
  mode === 'local' ? <LocalStore initial={initial}>{children}</LocalStore> : <RemoteStore>{children}</RemoteStore>;

/** Данные в localStorage браузера: тесты и работа без сервера. */
const LocalStore = ({ children, initial }: { children: ReactNode; initial?: AppState }) => {
  // Личное оформление читается при старте у сотрудника, чьё состояние открыто: как и в режиме с сервером.
  const [state, dispatch] = useReducer(reducer, initial, (init) => {
    const start = init ?? loadState();
    return { ...start, appearance: loadAppearance(start.user?.employeeId) };
  });
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
  syncCategories(state.dictionaries);
  const value = useMemo(() => ({ state, dispatch, signIn, signInWindows, windowsAuthAvailable: false, authenticationReady: true, directoryAvailable: true, searchDirectory, sync, reload: () => undefined, fetchNotices: null, checkWindows: null }), [state, signIn, signInWindows, searchDirectory, sync]);
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
    setState((current) => ({ ...emptyState(null), authentication: current.authentication, scoring: current.scoring, appearance: current.appearance }));
    setSync((s) => ({ ...s, loading: false, saving: false, error: null }));
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.relogin) return signOut();
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
      if (pending.current === 0) setState((s) => ({ ...fromData(data, s.user), appearance: s.appearance }));
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

  // Оформление хранится у сотрудника в браузере и не уходит на сервер.
  useEffect(() => {
    storeAppearance(state.appearance, state.user?.employeeId);
  }, [state.appearance, state.user?.employeeId]);

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
          if (pending.current === 0) setState((s) => ({ ...fromData(data, s.user), appearance: s.appearance }));
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

  // Опубликованное приложение — только вход Windows: формы входа через сервер нет.
  const signIn = useCallback(async (_email: string, _password: string) => 'Вход по паролю отключён: используйте учётную запись Windows.', []);

  /** Сеанс, полученный входом через Windows, становится текущим. */
  const adoptWindowsSession = useCallback(async (next: { token: string; user: User }) => {
    const s = { ...next, via: 'windows' as const };
    session.current = s;
    writeSession(s);
    // Оформление берётся у вошедшего сотрудника (emptyState читает его личный ключ), а не остаётся от прежнего.
    setState((current) => ({ ...emptyState(s.user), authentication: current.authentication, scoring: current.scoring }));
    setSync((current) => ({ ...current, loading: true, error: null }));
    await load();
  }, [load]);

  const signInWindows = useCallback(async () => {
    try {
      await adoptWindowsSession(await api.windowsLogin());
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Не удалось выполнить вход через Windows.';
    }
  }, [adoptWindowsSession]);


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

  const checkWindows = useCallback(async () => {
    const token = session.current?.token;
    if (!token) throw new Error('Войдите в систему.');
    return api.windowsCheck(token);
  }, []);

  syncStaff(state.users, state.units);
  syncCategories(state.dictionaries);
  const value = useMemo(() => ({ state, dispatch, signIn, signInWindows, windowsAuthAvailable, authenticationReady, directoryAvailable, searchDirectory, sync, reload: () => void load(), fetchNotices, checkWindows }), [state, dispatch, signIn, signInWindows, windowsAuthAvailable, authenticationReady, directoryAvailable, searchDirectory, sync, load, fetchNotices, checkWindows]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};
