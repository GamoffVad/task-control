import { createContext, useContext } from 'react';
import { createSeed } from './seed';
import { isStored, migrate } from './reducer';
import type { AppState, DirectoryUser } from './types';

export { reducer, migrate, newId, type Action } from './reducer';
export { authenticate } from './auth';

export const STORAGE_KEY = 'task-control:v1';

/** Данные в браузере — для режима без сервера (тесты, автономная работа). */
export const loadState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isStored(parsed)) return migrate(parsed);
    }
  } catch {
    // Повреждённые или недоступные данные — начинаем с демонстрационных.
  }
  return createSeed();
};

export const saveState = (state: AppState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Хранилище недоступно (приватный режим) — работаем в памяти.
  }
};

/** Состояние связи с базой данных. */
export type Sync = {
  mode: 'local' | 'remote';
  /** Идёт первая загрузка данных с сервера. */
  loading: boolean;
  /** Идёт сохранение. */
  saving: boolean;
  /** Время последней успешной синхронизации. */
  syncedAt: Date | null;
  /** Текст ошибки для пользователя. */
  error: string | null;
};

export type StoreCtx = {
  state: AppState;
  dispatch: (a: import('./reducer').Action) => void;
  /** Вход: null — успех, строка — причина отказа. */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Windows SSO: null — success, string — reason for failure. */
  signInWindows: () => Promise<string | null>;
  windowsAuthAvailable: boolean;
  authenticationReady: boolean;
  directoryAvailable: boolean;
  searchDirectory: (query: string) => Promise<DirectoryUser[]>;
  sync: Sync;
  reload: () => void;
  /** Новые уведомления вошедшего сотрудника с момента since; null — уведомлений нет (работа без сервера). */
  fetchNotices: ((since: string | null) => Promise<{ notices: import('./notices').ServerNotice[]; now: string }>) | null;
};
export const StoreContext = createContext<StoreCtx | null>(null);

export const useStore = (): StoreCtx => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore вызван вне StoreProvider');
  return ctx;
};
