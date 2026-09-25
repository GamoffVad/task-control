// Сервер API для развёртывания в IIS (корпоративная сеть без интернета).
// Процесс запускает модуль PlanHost внутри пула IIS (deploy/iis/PlanHost.cs): он передаёт порт и настройки
// через переменные окружения и проксирует запросы /api/* на 127.0.0.1. Статику раздаёт сам IIS.
//   PORT                       — порт на 127.0.0.1
//   MSSQL_CONNECTION_STRING    — строка ODBC к SQL Server (обычно Windows-вход учётной записи пула IIS)
//   TC_PARENT_PID              — процесс IIS; когда он завершается, сервер тоже завершается
//   AUTH_SECRET, WINDOWS_AUTH_*, AD_* — как в docs/corporate-offline.md
import http from 'node:http';
import { createApi } from './app';
import { secretFromEnv } from './auth';
import { createMssqlRepo } from './mssqlRepo';
import { windowsIdentityFromEnv } from './windowsAuth';
import { activeDirectoryFromEnv } from './activeDirectory';

const env = process.env;
const connectionString = env.MSSQL_CONNECTION_STRING;
if (!connectionString) {
  console.error('Не задана строка подключения MSSQL_CONNECTION_STRING.');
  process.exit(1);
}

const repo = createMssqlRepo(connectionString);
const handle = createApi({
  repo,
  // Без AUTH_SECRET ключ сеансов выводится из строки подключения, как для PostgreSQL.
  secret: secretFromEnv({ ...env, DATABASE_URL: env.DATABASE_URL ?? connectionString }),
  windowsIdentity: windowsIdentityFromEnv(env),
  directory: activeDirectoryFromEnv(env),
});

const server = http.createServer((req, res) => void handle(req, res));
// Прокси IIS держит соединения до 30 с (PlanHost.cs); сервер не должен закрывать их раньше.
server.keepAliveTimeout = 65_000;
const port = Number(env.PORT) || 3001;
server.listen(port, '127.0.0.1', () => console.log(`${new Date().toISOString()} API слушает 127.0.0.1:${port}`));

const stop = (code = 0) => {
  server.close();
  void repo.close?.().finally(() => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

// Пул IIS остановлен или перезапущен — сервер не должен остаться «сиротой» и держать порт.
const parent = Number(env.TC_PARENT_PID);
if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      console.log(`${new Date().toISOString()} процесс IIS ${parent} завершён — остановка`);
      stop();
    }
  }, 5000).unref();
}
