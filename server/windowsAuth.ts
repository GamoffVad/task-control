import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/**
 * Reads a Windows identity only when the deployment explicitly trusts its reverse proxy.
 * The proxy must remove the public request header and set it after Kerberos/NTLM succeeds.
 */
export const windowsIdentityFromEnv = (env: Record<string, string | undefined>) => {
  const secret = env.WINDOWS_AUTH_PROXY_SECRET;
  if (env.WINDOWS_AUTH_TRUST_PROXY !== 'true' || !secret) return undefined;
  const header = (env.WINDOWS_AUTH_HEADER ?? 'x-windows-user').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(header)) throw new Error('WINDOWS_AUTH_HEADER contains an invalid HTTP header name.');
  return (req: IncomingMessage): string | null => {
    const suppliedSecret = req.headers['x-windows-auth-secret'];
    if (typeof suppliedSecret !== 'string') return null;
    const expected = Buffer.from(secret);
    const supplied = Buffer.from(suppliedSecret);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const raw = req.headers[header];
    if (typeof raw !== 'string') return null;
    // Прокси IIS (deploy/iis/PlanHost.cs) кодирует логин: в заголовке допустимы только символы ASCII, а логин может быть кириллическим.
    let value = raw;
    if (req.headers['x-windows-auth-encoding'] === 'uri') {
      try {
        value = decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
    return value.trim() ? value.trim() : null;
  };
};
