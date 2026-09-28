// Точка входа функции Vercel. Хранилище — PostgreSQL из переменной DATABASE_URL (Neon).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApi } from './app';
import { secretFromEnv } from './auth';
import { createPgRepo } from './pgRepo';
import { inspectWindowsRequest, windowsIdentityFromEnv } from './windowsAuth';
import { activeDirectoryFromEnv } from './activeDirectory';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const handler = url
  ? createApi({ repo: createPgRepo(url), secret: secretFromEnv(process.env), windowsIdentity: windowsIdentityFromEnv(process.env), windowsCheck: (req) => inspectWindowsRequest(req, process.env), directory: activeDirectoryFromEnv(process.env) })
  : (_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'База данных не подключена: добавьте Neon Postgres к проекту в панели Vercel.' }));
    };

export default handler;
