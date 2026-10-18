import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseConnectionDraft, DatabaseConnectionView, DatabaseProbe } from '../src/lib/databaseConnection';
import { createMssqlRepo, inspectMssql, mssqlSettingsFromEnv, type MssqlSettings } from './mssqlRepo';
import type { Repo } from './repo';

export class DatabaseConnectionError extends Error {}
export type DatabaseConnectionControl = {
  get(): DatabaseConnectionView;
  test(draft: unknown): Promise<DatabaseProbe>;
  save(draft: unknown): Promise<DatabaseConnectionView & DatabaseProbe>;
};
type Dependencies = { create(settings: MssqlSettings): Repo; inspect(settings: MssqlSettings): Promise<DatabaseProbe> };
type PrivateSettings = DatabaseConnectionDraft;

/** Проверка списка полей также исключает произвольные строки подключения и пути к файлам. */
export const validateDatabaseConnection = (input: unknown): DatabaseConnectionDraft => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DatabaseConnectionError('Неверные настройки подключения.');
  const d = input as Record<string, unknown>;
  if (typeof d.server !== 'string' || !/^[\w.\\(),:-]{1,200}$/.test(d.server.trim())) throw new DatabaseConnectionError('Укажите имя или адрес SQL Server, например localhost или localhost\\SQLEXPRESS.');
  if (typeof d.database !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,120}$/.test(d.database.trim())) throw new DatabaseConnectionError('Имя базы: латинские буквы, цифры и подчёркивания; первый символ — буква или подчёркивание.');
  if (d.auth !== 'windows' && d.auth !== 'sql') throw new DatabaseConnectionError('Выберите способ подключения к SQL Server.');
  if (d.port !== undefined && (!Number.isInteger(d.port) || Number(d.port) < 1 || Number(d.port) > 65535)) throw new DatabaseConnectionError('Порт должен быть от 1 до 65535.');
  if (typeof d.encrypt !== 'boolean' || typeof d.trustServerCertificate !== 'boolean') throw new DatabaseConnectionError('Неверные параметры шифрования.');
  if (typeof d.username !== 'string' || d.username.length > 128 || (d.auth === 'sql' && !d.username.trim())) throw new DatabaseConnectionError('Укажите логин SQL Server.');
  if (d.password !== undefined && (typeof d.password !== 'string' || d.password.length > 1000)) throw new DatabaseConnectionError('Неверный пароль SQL Server.');
  return { server: d.server.trim(), database: d.database.trim(), auth: d.auth, username: d.auth === 'sql' ? d.username.trim() : '', ...(d.port !== undefined ? { port: Number(d.port) } : {}), encrypt: d.encrypt, trustServerCertificate: d.trustServerCertificate, ...(typeof d.password === 'string' ? { password: d.password } : {}) };
};

/** Файл находится на сервере, вне public/. Операции со старым пулом завершаются до смены подключения. */
export const createConfiguredStorage = (env: Record<string, string | undefined>, file: string, deps: Dependencies = { create: createMssqlRepo, inspect: inspectMssql }): { repo: Repo; connection: DatabaseConnectionControl } => {
  const initial = mssqlSettingsFromEnv(env);
  const keyFile = `${file}.key`;
  const key = () => readFileSync(keyFile);
  const decrypt = (value: string) => {
    const [iv, tag, data] = value.split('.').map(p => Buffer.from(p, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  };
  let config: PrivateSettings = { server: initial?.server ?? 'localhost', database: initial?.database ?? 'TaskControl', auth: initial?.user ? 'sql' : 'windows', username: initial?.user ?? '', ...(initial?.instanceName ? { server: `${initial.server}\\${initial.instanceName}` } : {}), ...(initial?.port ? { port: initial.port } : {}), encrypt: initial?.encrypt ?? true, trustServerCertificate: initial?.trustServerCertificate ?? true, ...(initial?.password ? { password: initial.password } : {}) };
  let saved = existsSync(file);
  if (saved) {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    config = validateDatabaseConnection(stored);
    if (typeof stored.encryptedPassword === 'string') config.password = decrypt(stored.encryptedPassword);
  }
  const settings = (draft: PrivateSettings): MssqlSettings => ({ ...mssqlSettingsFromEnv({ MSSQL_SERVER: draft.server, MSSQL_DATABASE: draft.database, ...(draft.port ? { MSSQL_PORT: String(draft.port) } : {}) })!, encrypt: draft.encrypt, trustServerCertificate: draft.trustServerCertificate, ...(draft.auth === 'sql' ? { user: draft.username, password: draft.password } : {}), ...(initial?.odbcDriver ? { odbcDriver: initial.odbcDriver } : {}) });
  let active = deps.create(settings(config));
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const next = chain.then(fn); chain = next.catch(() => undefined); return next; };
  const view = (): DatabaseConnectionView => { const { password, ...publicConfig } = config; return { ...publicConfig, hasPassword: !!password, saved }; };
  const resolve = (value: unknown) => {
    const draft = validateDatabaseConnection(value);
    if (draft.auth === 'sql' && draft.password === undefined && config.auth === 'sql' && draft.username === config.username && draft.server === config.server) draft.password = config.password;
    return draft;
  };
  const failure = () => new DatabaseConnectionError('Не удалось подключиться к SQL Server. Проверьте сервер, порт, способ входа и права на базу данных.');
  const persist = (draft: PrivateSettings) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const { password, ...plain } = draft;
    let encryptedPassword: string | undefined;
    if (password) {
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
      const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
      encryptedPassword = [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
    }
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...plain, ...(encryptedPassword ? { encryptedPassword } : {}) }, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  return {
    repo: { kind: 'sqlserver', read: () => serial(() => active.read()), update: fn => serial(() => active.update(fn)), ping: () => serial(() => active.ping!()), close: () => serial(async () => { await active.close?.(); }) },
    connection: {
      get: view,
      test: value => serial(async () => { const draft = resolve(value); try { return await deps.inspect(settings(draft)); } catch { throw failure(); } }),
      save: value => serial(async () => {
        const draft = resolve(value);
        let probe: DatabaseProbe;
        try { probe = await deps.inspect(settings(draft)); } catch { throw failure(); }
        const candidate = deps.create(settings(draft));
        try { await candidate.ping?.(); } catch { await candidate.close?.().catch(() => undefined); throw failure(); }
        try { persist(draft); } catch { await candidate.close?.().catch(() => undefined); throw new DatabaseConnectionError('Не удалось сохранить настройки на сервере. Проверьте права записи в папку конфигурации.'); }
        const old = active;
        active = candidate; config = draft; saved = true;
        await old.close?.().catch(() => undefined);
        return { ...view(), ...probe, databaseExists: true };
      }),
    },
  };
};
