// API для сервера разработки Vite. Хранилище — только SQL Server: по умолчанию локальный (localhost),
// база TaskControlDev, вход Windows текущим пользователем; другие — переменными MSSQL_*.
// Вход в приложение — учётной записью Windows того, кто запустил сервер разработки (TC_DEV_WINDOWS_USER — другая).
// TC_FIXED_NOW — зафиксированное «сейчас» (для скриншотов документации).
import { createApi } from './app';
import { secretFromEnv } from './auth';
import { createConfiguredStorage } from './databaseConnection';
import path from 'node:path';
import { activeDirectoryFromEnv, demoActiveDirectory } from './activeDirectory';

process.env.MSSQL_SERVER ||= 'localhost';
process.env.MSSQL_DATABASE ||= 'TaskControlDev';
const devUser = process.env.TC_DEV_WINDOWS_USER || [process.env.USERDOMAIN, process.env.USERNAME ?? 'developer'].filter(Boolean).join('\\');

const { repo, connection } = createConfiguredStorage(process.env, path.resolve(process.env.TC_CONNECTION_FILE ?? '.data/sqlserver-connection.json'));
const fixed = process.env.TC_FIXED_NOW ? Number(process.env.TC_FIXED_NOW) : null;
const started = Date.now();

export const handle = createApi({
  repo,
  connection,
  secret: secretFromEnv(process.env),
  now: fixed ? () => new Date(fixed + (Date.now() - started)) : undefined,
  // IIS здесь нет: доменный пользователь — тот, кто запустил сервер разработки.
  windowsIdentity: () => devUser,
  windowsCheck: () => ({ enabled: true, secretRequired: false, secretOk: true, seen: [{ header: 'сервер разработки', value: devUser }], identity: devUser, problem: null }),
  directory: activeDirectoryFromEnv(process.env) ?? demoActiveDirectory,
  administratorLogin: process.env.TC_ADMIN_LOGIN || devUser,
});
