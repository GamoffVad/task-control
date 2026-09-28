// Точка входа для публикации в IIS через iisnode: один процесс Node.js отдаёт и статику, и /api.
// Хранилище — SQL Server (MSSQL_SERVER); без него PostgreSQL или файл рядом с сервером.
// IIS проверяет доменного пользователя и передаёт его заголовком, приложение пароль не спрашивает.
// PORT задаёт iisnode (именованный канал); при запуске вручную — обычный номер порта.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { createApi } from './app';
import { secretFromEnv } from './auth';
import { createRepoFromEnv } from './storage';
import { inspectWindowsRequest, windowsIdentityFromEnv } from './windowsAuth';
import { activeDirectoryFromEnv } from './activeDirectory';

const root = path.resolve(process.env.TC_STATIC_DIR ?? path.join(__dirname, 'public'));
const repo = createRepoFromEnv(process.env, path.resolve(process.env.TC_DB_FILE ?? path.join(__dirname, 'data', 'db.json')))!;

const api = createApi({
  repo,
  secret: secretFromEnv(process.env),
  windowsIdentity: windowsIdentityFromEnv(process.env),
  windowsCheck: (req) => inspectWindowsRequest(req, process.env),
  directory: activeDirectoryFromEnv(process.env),
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Путь внутри папки статики; выход за её пределы запрещён. */
const resolveFile = (pathname: string): string | null => {
  const decoded = decodeURIComponent(pathname);
  const file = path.resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
};

const sendFile = (res: ServerResponse, file: string) => {
  const ext = path.extname(file).toLowerCase();
  res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream');
  if (path.basename(file) === 'sw.js') {
    // Service Worker уведомлений: всегда свежая версия, область действия — весь сайт.
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('service-worker-allowed', '/');
  } else if (file.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('cache-control', 'no-cache');
  }
  createReadStream(file).pipe(res);
};

const handle = async (req: IncomingMessage, res: ServerResponse) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) return api(req, res);
  const file = resolveFile(pathname);
  if (file) return sendFile(res, file);
  // Одностраничное приложение: любой другой адрес отдаёт index.html.
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) {
    res.statusCode = 500;
    res.end('Не найдена папка со статикой приложения.');
    return;
  }
  sendFile(res, index);
};

createServer((req, res) => {
  handle(req, res).catch(() => {
    res.statusCode = 500;
    res.end('Внутренняя ошибка сервера.');
  });
}).listen(process.env.PORT ?? 1500);
