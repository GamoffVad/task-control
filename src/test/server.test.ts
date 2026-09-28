// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../server/app';
import { signToken } from '../../server/auth';
import { createMemoryRepo, type Repo } from '../../server/repo';
import type { Data } from '../lib/types';

// Четверг, 17 сентября 2026.
const NOW = new Date(2026, 8, 17, 12, 0);
const SECRET = 'test-secret';

let repo: Repo;
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => createApi({
    repo,
    secret: SECRET,
    now: () => NOW,
    windowsIdentity: (request) => typeof request.headers['x-windows-user'] === 'string' ? request.headers['x-windows-user'] : null,
    directory: { search: async () => [{ fullName: 'Кудрявцев Олег Игоревич', surname: 'Кудрявцев', givenName: 'Олег', patronymic: 'Игоревич', login: 'kudryavtsev.oi', email: 'kudryavtsev.oi@example.com', position: 'Инженер' }] },
  })(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  repo = createMemoryRepo();
});

const call = async (path: string, init: { method?: string; token?: string; body?: unknown; windowsUser?: string } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.windowsUser ? { 'x-windows-user': init.windowsUser } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as { data?: Data; error?: string; token?: string; user?: unknown } };
};

const login = async (email: string) => (await call('/api/login', { method: 'POST', body: { email, password: '123456' } })).json.token!;

describe('API', () => {
  it('сообщает о состоянии', async () => {
    expect(await call('/api/health')).toEqual({ status: 200, json: { ok: true, storage: 'memory' } });
  });

  it('входит по логину и паролю, отказывает при неверном пароле', async () => {
    const bad = await call('/api/login', { method: 'POST', body: { email: 'user@example.com', password: 'nope00' } });
    expect(bad.status).toBe(401);
    expect(bad.json.error).toMatch(/Неверный логин/);
    const ok = await call('/api/login', { method: 'POST', body: { email: 'SIDOROV@example.com', password: '123456' } });
    expect(ok.status).toBe(200);
    expect(ok.json.user).toMatchObject({ email: 'sidorov@example.com', employeeId: 3, role: 'executor' });
  });

  it('восстанавливает вход базового администратора формы после рассинхронизации базы', async () => {
    await login('user');
    await repo.update((current) => ({
      ...current!,
      users: current!.users.filter((user) => user.employeeId !== 1).map((user) => user.employeeId === 2 ? { ...user, role: 'administrator' as const } : user),
    }));
    const recovered = await call('/api/login', { method: 'POST', body: { email: 'user', password: '123456' } });
    expect(recovered.status).toBe(200);
    expect(recovered.json.user).toMatchObject({ email: 'user@example.com', employeeId: 1, role: 'administrator' });
    const state = await call('/api/state', { token: recovered.json.token });
    expect(state.status).toBe(200);
    expect(state.json.data!.users).toContainEqual(expect.objectContaining({ employeeId: 1, windowsLogin: 'user', active: true }));
  });

  it('переключает способ входа и сопоставляет доверенную учётную запись Windows', async () => {
    const admin = await login('user@example.com');
    const changed = await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'saveAuthentication', mode: 'windows', allowEmergencyForm: true } } });
    expect(changed.status).toBe(200);
    expect(changed.json.data!.authentication.mode).toBe('windows');

    const windows = await call('/api/windows-login', { method: 'POST', windowsUser: 'DOMAIN\\sidorov' });
    expect(windows.status).toBe(200);
    expect(windows.json.user).toMatchObject({ employeeId: 3, role: 'executor' });

    // Прокси передал доменного пользователя — бесшовный вход работает, значит форма закрыта для исполнителя.
    const formExecutor = await call('/api/login', { method: 'POST', body: { email: 'sidorov@example.com', password: '123456' }, windowsUser: 'DOMAIN\\sidorov' });
    expect(formExecutor.status).toBe(403);
    const emergencyAdmin = await call('/api/login', { method: 'POST', body: { email: 'user@example.com', password: '123456' }, windowsUser: 'DOMAIN\\user' });
    expect(emergencyAdmin.status).toBe(200);
    // Прокси молчит — вход по паролю остаётся доступным всем, чтобы неверная настройка не заперла отдел.
    expect((await call('/api/login', { method: 'POST', body: { email: 'sidorov@example.com', password: '123456' } })).status).toBe(200);
  });

  it('ищет сотрудника в каталоге и добавляет пользователя с доменным логином', async () => {
    const admin = await login('user');
    const found = await call('/api/directory-users?q=Кудр', { token: admin });
    expect(found.status).toBe(200);
    expect((found.json as { users: unknown[] }).users[0]).toMatchObject({ fullName: 'Кудрявцев Олег Игоревич', login: 'kudryavtsev.oi' });
    const account = { employeeId: 1001, fullName: 'Кудрявцев Олег Игоревич', position: 'Инженер', windowsLogin: 'kudryavtsev.oi', email: 'kudryavtsev.oi@example.com', role: 'executor', active: true };
    const added = await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'addManagedUser', account } } });
    expect(added.status).toBe(200);
    expect(added.json.data!.users).toContainEqual(account);
    const deleted = await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'deleteManagedUser', employeeId: account.employeeId } } });
    expect(deleted.status).toBe(200);
    expect(deleted.json.data!.users).not.toContainEqual(account);
  });

  it('без токена или с поддельным токеном не отдаёт данные', async () => {
    expect((await call('/api/state')).status).toBe(401);
    const forged = signToken({ email: 'x', employeeId: 1, role: 'manager' }, 'other-secret', NOW);
    expect((await call('/api/state', { token: forged })).status).toBe(401);
    const expired = signToken({ email: 'x', employeeId: 1, role: 'manager' }, SECRET, new Date(2026, 0, 1));
    expect((await call('/api/state', { token: expired })).status).toBe(401);
  });

  it('заполняет пустую базу демоданными и хранит изменения', async () => {
    const token = await login('user@example.com');
    const first = await call('/api/state', { token });
    expect(first.json.data!.absences.length).toBeGreaterThan(0);
    const draft = { employeeId: 4, type: 'trip', from: '2026-10-12', to: '2026-10-14', status: 'approved', note: 'Филиал' };
    const saved = await call('/api/action', { method: 'POST', token, body: { action: { type: 'saveAbsence', draft } } });
    expect(saved.status).toBe(200);
    const again = await call('/api/state', { token });
    expect(again.json.data!.absences.some((a) => a.employeeId === 4 && a.from === '2026-10-12' && a.decidedBy === 1)).toBe(true);
  });

  it('сохраняет позиции плана и возвращает их в общем состоянии', async () => {
    const token = await login('user');
    const saved = await call('/api/action', { method: 'POST', token, body: { action: { type: 'savePlanRow', draft: { id: '1.9', title: 'Новая позиция', isHeader: false, baseScore: 3 } } } });
    expect(saved.status).toBe(200);
    expect(saved.json.data!.planRows).toContainEqual({ id: '1.9', title: 'Новая позиция', isHeader: false, baseScore: 3 });
    const again = await call('/api/state', { token });
    expect(again.json.data!.planRows).toContainEqual({ id: '1.9', title: 'Новая позиция', isHeader: false, baseScore: 3 });
  });

  it('проверяет права на сервере', async () => {
    const token = await login('sidorov@example.com');
    const { json } = await call('/api/state', { token });
    const foreign = json.data!.tasks.find((t) => !t.assigneeIds.includes(3))!;
    const del = await call('/api/action', { method: 'POST', token, body: { action: { type: 'deleteTask', id: foreign.id } } });
    expect(del.status).toBe(403);
    const report = await call('/api/action', { method: 'POST', token, body: { action: { type: 'submitReport', weekStart: '2026-09-11T00:00:00.000Z' } } });
    expect(report.status).toBe(403);
    const after = await call('/api/state', { token });
    expect(after.json.data!.tasks.some((t) => t.id === foreign.id)).toBe(true);
  });

  it('исполнитель создаёт заявку только на себя, даже если прислал чужой id', async () => {
    const token = await login('sidorov@example.com');
    await call('/api/state', { token });
    const draft = { employeeId: 1, type: 'vacation', from: '2026-11-02', to: '2026-11-06', status: 'approved', note: '' };
    const { json } = await call('/api/action', { method: 'POST', token, body: { action: { type: 'saveAbsence', draft } } });
    expect(json.data!.absences.find((a) => a.from === '2026-11-02')).toMatchObject({ employeeId: 3, status: 'request' });
  });

  it('отклоняет неверные данные с понятной причиной', async () => {
    const token = await login('user@example.com');
    await call('/api/state', { token });
    const junk = await call('/api/action', { method: 'POST', token, body: { action: { type: 'saveTask', draft: { title: 1 } } } });
    expect(junk.status).toBe(400);
    const unknown = await call('/api/action', { method: 'POST', token, body: { action: { type: 'login' } } });
    expect(unknown.status).toBe(400);
    const overlap = await call('/api/action', {
      method: 'POST',
      token,
      body: { action: { type: 'saveAbsence', draft: { employeeId: 2, type: 'vacation', from: '2026-09-16', to: '2026-09-17', status: 'approved', note: '' } } },
    });
    expect(overlap.status).toBe(400);
    expect(overlap.json.error).toMatch(/пересекаются/);
  });

  it('при отказе ничего не сохраняет', async () => {
    const token = await login('user@example.com');
    const before = (await call('/api/state', { token })).json.data!;
    await call('/api/action', { method: 'POST', token, body: { action: { type: 'deleteAbsence', id: 'нет-такого' } } });
    const after = (await call('/api/state', { token })).json.data!;
    expect(after).toEqual(before);
  });

  it('последовательные правки разных пользователей не теряются', async () => {
    const boss = await login('user@example.com');
    const worker = await login('sidorov@example.com');
    await call('/api/state', { token: boss });
    await Promise.all([
      call('/api/action', { method: 'POST', token: boss, body: { action: { type: 'sendMessage', text: 'Первое' } } }),
      call('/api/action', { method: 'POST', token: worker, body: { action: { type: 'sendMessage', text: 'Второе' } } }),
    ]);
    const texts = (await call('/api/state', { token: boss })).json.data!.messages.map((m) => m.text);
    expect(texts).toEqual(expect.arrayContaining(['Первое', 'Второе']));
  });

  it('отметка «прочитано» — своя, по серверному времени, чужие не выдаются', async () => {
    const boss = await login('user@example.com');
    const worker = await login('sidorov@example.com');
    await call('/api/action', { method: 'POST', token: worker, body: { action: { type: 'markChatRead' } } });
    const res = await call('/api/action', { method: 'POST', token: boss, body: { action: { type: 'markChatRead', now: '2000-01-01' } } });
    expect(res.status).toBe(200);
    const reads = res.json.data!.chatReads!;
    expect(reads.map((r) => r.employeeId)).toEqual([1]);
    expect(reads[0]!.readAt > '2020').toBe(true);
    expect((await call('/api/state', { token: worker })).json.data!.chatReads!.map((r) => r.employeeId)).toEqual([3]);
  });

  it('неизвестный адрес — 404', async () => {
    expect((await call('/api/nothing')).status).toBe(404);
  });
});
