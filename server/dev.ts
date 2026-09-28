// API для сервера разработки Vite: SQL Server при заданном MSSQL_SERVER, PostgreSQL при DATABASE_URL,
// иначе файл .data/dev-db.json.
// TC_DB_FILE — другой файл хранилища, TC_FIXED_NOW — зафиксированное «сейчас» (для скриншотов документации).
import path from 'node:path';
import { createApi } from './app';
import { secretFromEnv } from './auth';
import { createRepoFromEnv } from './storage';
import { inspectWindowsRequest, windowsIdentityFromEnv } from './windowsAuth';
import { activeDirectoryFromEnv, demoActiveDirectory } from './activeDirectory';

const file = process.env.TC_DB_FILE ?? path.resolve(process.cwd(), '.data/dev-db.json');
const repo = createRepoFromEnv(process.env, file)!;
const fixed = process.env.TC_FIXED_NOW ? Number(process.env.TC_FIXED_NOW) : null;
const started = Date.now();

export const handle = createApi({
  repo,
  secret: secretFromEnv(process.env),
  now: fixed ? () => new Date(fixed + (Date.now() - started)) : undefined,
  windowsIdentity: windowsIdentityFromEnv(process.env),
  windowsCheck: (req) => inspectWindowsRequest(req, process.env),
  directory: activeDirectoryFromEnv(process.env) ?? demoActiveDirectory,
});
