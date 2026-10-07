// Хранилище — только Microsoft SQL Server: настройки MSSQL_* в web.config (их записывает deploy-iis.bat).
import { createMssqlRepo, mssqlSettingsFromEnv } from './mssqlRepo';
import type { Repo } from './repo';

export type StorageEnv = Record<string, string | undefined>;

/** Настроен ли SQL Server — для диагностики. */
export const storageKindFromEnv = (env: StorageEnv): 'sqlserver' | 'none' => (mssqlSettingsFromEnv(env) ? 'sqlserver' : 'none');

/** Причина, по которой приложение не работает без SQL Server, — в ответе /api/health и в журнале. */
export const NO_SQL_SERVER = 'SQL Server не настроен: заполните MSSQL_SERVER и MSSQL_DATABASE в web.config (deploy-iis.bat делает это сам).';

/**
 * Хранилище по настройкам. Других хранилищ нет: без SQL Server каждое обращение к данным
 * завершается понятной ошибкой, а /api/health отвечает 503.
 */
export const createRepoFromEnv = (env: StorageEnv): Repo => {
  const settings = mssqlSettingsFromEnv(env);
  if (settings) return createMssqlRepo(settings);
  const fail = () => Promise.reject(new Error(NO_SQL_SERVER));
  return { kind: 'none', read: fail, update: fail, ping: fail };
};
