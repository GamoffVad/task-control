// Выбор хранилища по переменным окружения: SQL Server в корпоративной сети,
// PostgreSQL в публикации на Vercel, файл — при разработке без базы.
import { existsSync, renameSync } from 'node:fs';
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

/**
 * Пустая база SQL Server или PostgreSQL заполняется данными файла, с которым приложение работало,
 * пока база не была настроена (например, комплект скопировали вручную, а MSSQL_* заполнили позже).
 * Без этого пользователи и задачи, внесённые за это время, остались бы в файле. Файл после проверки
 * переименовывается в db.imported-<время>.json и остаётся резервной копией.
 */
export const withFileImport = (repo: Repo, file: string): Repo => {
  if (repo.kind === 'file' || repo.kind === 'memory' || !existsSync(file)) return repo;
  let imported: Promise<void> | null = null;
  const importOnce = () =>
    (imported ??= (async () => {
      if (!existsSync(file)) return;
      const saved = await createMemoryRepo(file).read();
      if (saved) await repo.update((current) => current ?? saved);
      renameSync(file, file.replace(/\.json$/, `.imported-${Date.now()}.json`));
    })().catch((e) => ((imported = null), Promise.reject(e))));
  return {
    ...repo,
    async read() {
      await importOnce();
      return repo.read();
    },
    async update(fn) {
      await importOnce();
      return repo.update(fn);
    },
  };
};
