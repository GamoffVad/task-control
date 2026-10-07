// @vitest-environment node
// Вход через Windows: разбор заголовков прокси, проверка настройки и защита от блокировки входа.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../server/app';
import { createMemoryRepo, type Repo } from '../../server/repo';
import { toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import { inspectWindowsRequest, windowsIdentityFromEnv, windowsAuthSettings } from '../../server/windowsAuth';

const NOW = new Date(2026, 8, 17, 12, 0);
const req = (headers: Record<string, string>) => ({ headers }) as unknown as Parameters<typeof inspectWindowsRequest>[0];

describe('разбор запроса Windows-входа', () => {
  it('без доверия прокси заголовки игнорируются', () => {
    const env = {};
    expect(windowsIdentityFromEnv(env)).toBeUndefined();
    const check = inspectWindowsRequest(req({ 'x-windows-user': 'CORP\\ivanov' }), env);
    expect(check).toMatchObject({ enabled: false, identity: null });
    expect(check.problem).toMatch(/WINDOWS_AUTH_TRUST_PROXY/);
  });

  it('читает привычные заголовки IIS, ARR и nginx', () => {
    const env = { WINDOWS_AUTH_TRUST_PROXY: 'true' };
    const provider = windowsIdentityFromEnv(env)!;
    expect(provider(req({ 'x-windows-user': 'CORP\\ivanov' }))).toBe('CORP\\ivanov');
    expect(provider(req({ 'x-iisnode-logon_user': 'CORP\\petrov' }))).toBe('CORP\\petrov');
    expect(provider(req({ 'x-forwarded-user': 'sidorov@corp.local' }))).toBe('sidorov@corp.local');
    expect(provider(req({}))).toBeNull();
    expect(inspectWindowsRequest(req({}), env).problem).toMatch(/Ожидаются заголовки/);
  });

  it('при заданном WINDOWS_AUTH_HEADER доверяет только ему', () => {
    const env = { WINDOWS_AUTH_TRUST_PROXY: 'true', WINDOWS_AUTH_HEADER: 'X-Corp-User' };
    expect(windowsAuthSettings(env).headers).toEqual(['x-corp-user']);
    expect(windowsIdentityFromEnv(env)!(req({ 'x-corp-user': 'CORP\\ivanov', 'x-windows-user': 'CORP\\petrov' }))).toBe('CORP\\ivanov');
    // Остальные заголовки браузер может прислать сам — им не верим.
    expect(windowsIdentityFromEnv(env)!(req({ 'x-windows-user': 'CORP\\petrov' }))).toBeNull();
    expect(() => windowsAuthSettings({ WINDOWS_AUTH_HEADER: 'плохое имя' })).toThrow(/недопустимое имя/);
  });

  it('берёт последнее вхождение заголовка: значение от браузера iisnode не заменяет, а дописывает своё', () => {
    const env = { WINDOWS_AUTH_TRUST_PROXY: 'true', WINDOWS_AUTH_HEADER: 'x-iisnode-logon_user' };
    const raw = (...pairs: string[]) => ({ headers: {}, rawHeaders: pairs }) as unknown as Parameters<typeof inspectWindowsRequest>[0];
    const provider = windowsIdentityFromEnv(env)!;
    // Подделка от браузера, затем пустое значение iisnode для анонимного запроса.
    expect(provider(raw('X-iisnode-LOGON_USER', 'CORP\\admin', 'X-iisnode-LOGON_USER', ''))).toBeNull();
    expect(provider(raw('X-iisnode-LOGON_USER', 'CORP\\admin', 'X-iisnode-LOGON_USER', 'CORP\\ivanov'))).toBe('CORP\\ivanov');
    expect(provider(raw('X-iisnode-LOGON_USER', 'CORP\\ivanov'))).toBe('CORP\\ivanov');
    expect(provider(raw('Host', 'plan'))).toBeNull();
  });

  it('общий секрет прокси необязателен, но при заданном — обязателен', () => {
    const env = { WINDOWS_AUTH_TRUST_PROXY: 'true', WINDOWS_AUTH_PROXY_SECRET: 'secret-value' };
    const provider = windowsIdentityFromEnv(env)!;
    expect(provider(req({ 'x-windows-user': 'CORP\\ivanov' }))).toBeNull();
    expect(inspectWindowsRequest(req({ 'x-windows-user': 'CORP\\ivanov' }), env).problem).toMatch(/секрет/);
    expect(provider(req({ 'x-windows-user': 'CORP\\ivanov', 'x-windows-auth-secret': 'wrong' }))).toBeNull();
    expect(provider(req({ 'x-windows-user': 'CORP\\ivanov', 'x-windows-auth-secret': 'secret-value' }))).toBe('CORP\\ivanov');
  });
});

describe('API входа через Windows', () => {
  let repo: Repo;
  let server: Server;
  let base = '';
  let env: Record<string, string | undefined> = {};

  beforeAll(async () => {
    server = createServer((request, response) =>
      createApi({
        repo,
        secret: 'test',
        now: () => NOW,
        windowsIdentity: (r) => (windowsAuthSettings(env).trustProxy ? inspectWindowsRequest(r, env).identity : null),
        windowsCheck: (r) => inspectWindowsRequest(r, env),
        // Провайдер должен отсутствовать, когда доверие выключено: это и есть «сервер не умеет Windows-вход».
      })(request, response),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    // Сервер тестовых данных не создаёт: демонстрационный отдел кладётся в хранилище самим тестом.
    repo = createMemoryRepo(undefined, toData(createSeed(NOW)));
    env = { WINDOWS_AUTH_TRUST_PROXY: 'true' };
  });

  const call = async (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.token ? { 'x-tc-token': init.token } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const loginAs = async (login: string) => (await call('/api/windows-login', { method: 'POST', headers: { 'x-windows-user': `CORP\\${login}` } })).json.token as string;

  it('способ входа — всегда Windows; переключить его нельзя', async () => {
    const token = await loginAs('user');
    const { json } = await call('/api/authentication');
    expect(json.authentication).toMatchObject({ mode: 'windows', allowEmergencyForm: false });
    expect((await call('/api/action', { method: 'POST', token, body: { action: { type: 'saveAuthentication', mode: 'form', allowEmergencyForm: true } } })).status).toBe(400);
  });

  it('вход по доменному логину и сопоставление с пользователем приложения', async () => {
    const ok = await call('/api/windows-login', { method: 'POST', headers: { 'x-windows-user': 'CORP\\user' } });
    expect(ok.status).toBe(200);
    expect(ok.json.user).toMatchObject({ email: 'user@example.com', role: 'administrator' });
    // Неизвестный доменный логин — отказ с понятной причиной.
    const unknown = await call('/api/windows-login', { method: 'POST', headers: { 'x-windows-user': 'CORP\\nobody' } });
    expect(unknown.status).toBe(403);
    expect(String(unknown.json.error)).toMatch(/не сопоставлена/);
    // Без заголовка от прокси — 401.
    expect((await call('/api/windows-login', { method: 'POST' })).status).toBe(401);
  });

  it('проверка настройки показывает заголовки, логин и сопоставленного сотрудника', async () => {
    const token = await loginAs('user');
    const ok = await call('/api/windows-check', { token, headers: { 'x-iisnode-logon_user': 'CORP\\user' } });
    expect(ok.json).toMatchObject({ enabled: true, identity: 'CORP\\user', problem: null });
    expect(ok.json.seen).toEqual([{ header: 'x-iisnode-logon_user', value: 'CORP\\user' }]);
    expect(ok.json.matched).toMatchObject({ fullName: 'Иванов Алексей Борисович', active: true });

    const nobody = await call('/api/windows-check', { token, headers: { 'x-windows-user': 'CORP\\nobody' } });
    expect(String(nobody.json.problem)).toMatch(/не сопоставлен/);

    // Доменного пользователя нет — 401 с результатом проверки: на него IIS запросит учётную запись Windows.
    const anonymous = await call('/api/windows-check', { token });
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toMatchObject({ enabled: true, identity: null });
    expect(anonymous.json.error).toBeUndefined();

    // Проверка доступна только тем, кто настраивает вход.
    const worker = await loginAs('sidorov');
    expect((await call('/api/windows-check', { token: worker })).status).toBe(403);

    env = {};
    const off = await call('/api/windows-check', { token });
    expect(off.json).toMatchObject({ enabled: false });
    expect(String(off.json.problem)).toMatch(/WINDOWS_AUTH_TRUST_PROXY/);
  });

  it('если сервер не доверяет заголовку, войти нельзя — формы входа нет', async () => {
    env = {};
    expect((await call('/api/windows-login', { method: 'POST', headers: { 'x-windows-user': 'CORP\\user' } })).status).toBe(401);
    expect((await call('/api/login', { method: 'POST', body: { email: 'user@example.com', password: '123456' } })).status).toBe(404);
  });
});
