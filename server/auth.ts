// Токен сеанса: данные пользователя и срок действия, подписанные HMAC-SHA256.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from '../src/lib/types';

const TTL_DAYS = 7;

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Секрет: AUTH_SECRET, иначе производный от настроек базы — отдельная настройка не нужна. */
export const secretFromEnv = (env: Record<string, string | undefined>): string => {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  const source = env.DATABASE_URL || (env.MSSQL_SERVER ? `mssql://${env.MSSQL_SERVER}/${env.MSSQL_DATABASE ?? 'TaskControl'}` : null);
  return source ? createHash('sha256').update(`task-control|${source}`).digest('hex') : 'task-control-dev-secret';
};

export const signToken = (user: User, secret: string, now: Date = new Date()): string => {
  const payload = b64(JSON.stringify({ ...user, exp: now.getTime() + TTL_DAYS * 86_400_000 }));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

export const verifyToken = (token: string | undefined, secret: string, now: Date = new Date()): User | null => {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < now.getTime()) return null;
    if (typeof data.employeeId !== 'number' || !['administrator', 'manager', 'executor'].includes(data.role)) return null;
    return { email: String(data.email), employeeId: data.employeeId, role: data.role };
  } catch {
    return null;
  }
};
