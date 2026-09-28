// Выбор хранилища по переменным окружения: SQL Server в корпоративной сети,
// PostgreSQL в публикации на Vercel, файл — при разработке без базы.
import { createMssqlRepo, mssqlSettingsFromEnv } from './mssqlRepo';
import { createPgRepo } from './pgRepo';
import { createMemoryRepo } from './repo';
import type { Repo } from './repo';

export type StorageEnv = Record<string, string | undefined>;

/** Какое хранилище выбрано по настройкам — для диагностики и сообщений об ошибке. */
export const storageKindFromEnv = (env: StorageEnv): 'sqlserver' | 'postgres' | 'file' =>
  mssqlSettingsFromEnv(env) ? 'sqlserver' : env.DATABASE_URL || env.POSTGRES_URL ? 'postgres' : 'file';

/**
 * Хранилище по настройкам. MSSQL_SERVER имеет приоритет над DATABASE_URL:
 * на корпоративном сервере обе переменные могут остаться от прежней настройки.
 * Без file и без настроек базы возвращается null — вызывающий решает, что делать.
 */
export const createRepoFromEnv = (env: StorageEnv, file?: string): Repo | null => {
  const mssql = mssqlSettingsFromEnv(env);
  if (mssql) return createMssqlRepo(mssql);
  const url = env.DATABASE_URL || env.POSTGRES_URL;
  if (url) return createPgRepo(url);
  return file ? createMemoryRepo(file) : null;
};
