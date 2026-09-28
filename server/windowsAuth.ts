// Бесшовный вход через Windows: доменного пользователя подтверждает IIS или другой доверенный прокси
// и передаёт приложению заголовком. Приложение само не запрашивает пароль и не шлёт WWW-Authenticate.
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/** Заголовки, которыми IIS, iisnode, ARR и nginx обычно передают доменного пользователя. */
export const DEFAULT_IDENTITY_HEADERS = [
  'x-windows-user',
  'x-iisnode-logon_user',
  'x-iisnode-auth_user',
  'x-iis-user',
  'x-remote-user',
  'x-forwarded-user',
  'remote-user',
  'auth-user',
];

const SECRET_HEADER = 'x-windows-auth-secret';

export type WindowsAuthSettings = {
  /** Включён ли доверенный режим (WINDOWS_AUTH_TRUST_PROXY=true). */
  trustProxy: boolean;
  /** Заголовок из WINDOWS_AUTH_HEADER, если задан. */
  header: string | null;
  /** Проверяется ли общий секрет прокси (WINDOWS_AUTH_PROXY_SECRET). */
  secretRequired: boolean;
  /** Порядок просмотра заголовков. */
  headers: string[];
};

const headerName = (value: string | undefined): string | null => {
  const name = (value ?? '').trim().toLowerCase();
  if (!name) return null;
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error('WINDOWS_AUTH_HEADER содержит недопустимое имя заголовка.');
  return name;
};

export const windowsAuthSettings = (env: Record<string, string | undefined>): WindowsAuthSettings => {
  const header = headerName(env.WINDOWS_AUTH_HEADER);
  return {
    trustProxy: env.WINDOWS_AUTH_TRUST_PROXY === 'true',
    header,
    secretRequired: !!env.WINDOWS_AUTH_PROXY_SECRET,
    headers: header ? [header, ...DEFAULT_IDENTITY_HEADERS.filter((h) => h !== header)] : DEFAULT_IDENTITY_HEADERS,
  };
};

const headerValue = (req: IncomingMessage, name: string): string | null => {
  const raw = req.headers[name];
  const text = Array.isArray(raw) ? raw[0] : raw;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
};

const secretMatches = (req: IncomingMessage, secret: string): boolean => {
  const supplied = headerValue(req, SECRET_HEADER);
  if (!supplied) return false;
  const expected = Buffer.from(secret);
  const given = Buffer.from(supplied);
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** Что именно сервер увидел в запросе — для проверки настройки в администрировании. */
export type WindowsAuthCheck = {
  enabled: boolean;
  secretRequired: boolean;
  secretOk: boolean;
  /** Заголовки с доменным пользователем, найденные в запросе. */
  seen: { header: string; value: string }[];
  identity: string | null;
  problem: string | null;
};

/**
 * Разбор запроса без побочных действий: используется и при входе, и в проверке настройки.
 * Секрет прокси необязателен, но если он задан, запрос без верного секрета отклоняется.
 */
export const inspectWindowsRequest = (req: IncomingMessage, env: Record<string, string | undefined>): WindowsAuthCheck => {
  const settings = windowsAuthSettings(env);
  const seen = settings.headers
    .map((header) => ({ header, value: headerValue(req, header) }))
    .filter((x): x is { header: string; value: string } => !!x.value);
  const secretOk = !settings.secretRequired || secretMatches(req, env.WINDOWS_AUTH_PROXY_SECRET!);
  const identity = settings.trustProxy && secretOk ? (seen[0]?.value ?? null) : null;
  const problem = !settings.trustProxy
    ? 'Windows-вход выключен на сервере: задайте переменную WINDOWS_AUTH_TRUST_PROXY=true и перезапустите приложение.'
    : !secretOk
      ? `Прокси не передал общий секрет в заголовке ${SECRET_HEADER} или секрет не совпал.`
      : seen.length === 0
        ? `Прокси не передал доменного пользователя. Ожидаются заголовки: ${settings.headers.join(', ')}.`
        : null;
  return { enabled: settings.trustProxy, secretRequired: settings.secretRequired, secretOk, seen, identity, problem };
};

/**
 * Провайдер входа. Возвращается, только когда доверие прокси включено явно:
 * иначе заголовок мог бы подделать любой, кто доберётся до порта приложения.
 */
export const windowsIdentityFromEnv = (env: Record<string, string | undefined>) => {
  if (!windowsAuthSettings(env).trustProxy) return undefined;
  return (req: IncomingMessage): string | null => inspectWindowsRequest(req, env).identity;
};
