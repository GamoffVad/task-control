// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../server/app';
import { signToken } from '../../server/auth';
import { createMemoryRepo, type Repo } from '../../server/repo';
import { DEFAULT_USERS } from '../lib/access';
import { toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
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
// Сервер тестовых данных не создаёт: демонстрационный отдел кладётся в хранилище самим тестом.
beforeEach(() => {
  repo = createMemoryRepo(undefined, toData(createSeed(NOW)));
});

const call = async (path: string, init: { method?: string; token?: string; body?: unknown; windowsUser?: string } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.token ? { 'x-tc-token': init.token } : {}), ...(init.windowsUser ? { 'x-windows-user': init.windowsUser } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as { data?: Data; error?: string; token?: string; user?: unknown; relogin?: boolean } };
};

/** Вход — только учётной записью Windows: доменный логин сотрудника приходит заголовком от «IIS». */
const windowsLoginOf = (who: string) => DEFAULT_USERS.find((u) => u.email.toLowerCase() === who.toLowerCase() || u.windowsLogin.toLowerCase() === who.toLowerCase())!.windowsLogin;
const login = async (who: string) => (await call('/api/windows-login', { method: 'POST', windowsUser: `CORP\\${windowsLoginOf(who)}` })).json.token!;

/** Отдельный экземпляр API со своими настройками. */
const withApi = async (options: Partial<Parameters<typeof createApi>[0]> & { repo: Repo }, run: (url: string) => Promise<void>) => {
  const handle = createApi({ secret: SECRET, now: () => NOW, windowsIdentity: (request) => (typeof request.headers['x-windows-user'] === 'string' ? request.headers['x-windows-user'] : null), ...options });
  const own = createServer((req, res) => void handle(req, res));
  await new Promise<void>((done) => own.listen(0, '127.0.0.1', done));
  try {
    await run(`http://127.0.0.1:${(own.address() as AddressInfo).port}`);
  } finally {
    own.close();
  }
};

describe('API', () => {
  it('сообщает о состоянии', async () => {
    expect(await call('/api/health')).toEqual({ status: 200, json: { ok: true, storage: 'memory' } });
  });

  it('health отвечает 503, когда база настроена, но недоступна', async () => {
    // Настроенная, но недоступная база — частая причина «белого экрана» после публикации.
    const broken = { ...createMemoryRepo(), kind: 'sqlserver', ping: async () => { throw new Error('сеть недоступна'); } };
    const handle = createApi({ repo: broken, secret: 'test-secret' });
    const server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((done) => server.listen(0, done));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, storage: 'sqlserver', error: 'База данных недоступна.' });
    } finally {
      server.close();
    }
  });

  it('входит только учётной записью Windows: формы входа нет', async () => {
    // Входа по паролю больше нет.
    expect((await call('/api/login', { method: 'POST', body: { email: 'user@example.com', password: '123456' } })).status).toBe(404);
    const ok = await call('/api/windows-login', { method: 'POST', windowsUser: 'CORP\\sidorov' });
    expect(ok.status).toBe(200);
    expect(ok.json.user).toMatchObject({ email: 'sidorov@example.com', employeeId: 3, role: 'executor' });
    // Доменного пользователя нет в «Пользователях» — отказ с понятной причиной.
    const unknown = await call('/api/windows-login', { method: 'POST', windowsUser: 'CORP\\nobody' });
    expect(unknown.status).toBe(403);
    expect(unknown.json.error).toMatch(/CORP\\nobody.*не сопоставлена/);
    // Без доменного пользователя — 401: на него IIS запросит учётную запись Windows.
    expect((await call('/api/windows-login', { method: 'POST' })).status).toBe(401);
  });

  it('способ входа не переключается и демонстрационные данные не восстанавливаются', async () => {
    const admin = await login('user');
    expect((await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'saveAuthentication', mode: 'form', allowEmergencyForm: true } } })).status).toBe(400);
    expect((await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'reset' } } })).status).toBe(400);
    expect((await call('/api/authentication')).json).toMatchObject({ authentication: { mode: 'windows', allowEmergencyForm: false } });
  });

  it('без TC_ADMIN_LOGIN демонстрационный администратор «user» не подставляется', async () => {
    // Иначе администратором пустой базы стал бы любой доменный пользователь с логином «user».
    const empty = createMemoryRepo(undefined, { ...toData(createSeed(NOW)), users: [] });
    await withApi({ repo: empty, administratorLogin: '' }, async (url) => {
      const res = await fetch(`${url}/api/windows-login`, { method: 'POST', headers: { 'x-windows-user': 'CORP\\user' } });
      expect(res.status).toBe(403);
    });
  });

  it('без активного администратора администратором становится публикующий (TC_ADMIN_LOGIN)', async () => {
    const empty = createMemoryRepo(undefined, { ...toData(createSeed(NOW)), users: [] });
    await withApi({ repo: empty, administratorLogin: 'PRIBOY-S\\gamov' }, async (url) => {
      const res = await fetch(`${url}/api/windows-login`, { method: 'POST', headers: { 'x-windows-user': 'PRIBOY-S\\gamov' } });
      expect(res.status).toBe(200);
      const { token, user } = (await res.json()) as { token: string; user: unknown };
      expect(user).toMatchObject({ employeeId: 1, role: 'administrator' });
      const state = (await (await fetch(`${url}/api/state`, { headers: { 'x-tc-token': token } })).json()) as { data: Data };
      // Ни одного демонстрационного сотрудника: только сам публикующий.
      expect(state.data.users).toEqual([expect.objectContaining({ windowsLogin: 'PRIBOY-S\\gamov', fullName: 'PRIBOY-S\\gamov', role: 'administrator', active: true })]);
    });
  });

  it('не подставляет демонстрационного администратора, если свой администратор может войти', async () => {
    await login('user');
    await repo.update((current) => ({
      ...current!,
      users: current!.users.filter((user) => user.employeeId !== 1).map((user) => user.employeeId === 2 ? { ...user, role: 'administrator' as const } : user),
    }));
    const admin = await login('petrov@example.com');
    const users = (await call('/api/state', { token: admin })).json.data!.users;
    expect(users.some((user) => user.employeeId === 1)).toBe(false);
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
    const none = await call('/api/state');
    expect(none.status).toBe(403);
    expect(none.json.relogin).toBe(true);
    const forged = signToken({ email: 'x', employeeId: 1, role: 'manager' }, 'other-secret', NOW);
    expect((await call('/api/state', { token: forged })).status).toBe(403);
    const expired = signToken({ email: 'x', employeeId: 1, role: 'manager' }, `${SECRET}|windows`, new Date(2026, 0, 1));
    expect((await call('/api/state', { token: expired })).status).toBe(403);
    // Сеанс прежнего входа по паролю (подписан основным ключом) больше не действует.
    const formSession = signToken({ email: 'user@example.com', employeeId: 1, role: 'administrator' }, SECRET, NOW);
    expect((await call('/api/state', { token: formSession })).status).toBe(403);
  });

  it('хранит изменения', async () => {
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
    // Чужую задачу исполнителю сервер не отдаёт вовсе, но и по известному идентификатору её не удалить.
    const admin = await login('user@example.com');
    const all = await call('/api/state', { token: admin });
    const foreign = all.json.data!.tasks.find((t) => !t.assigneeIds.includes(3))!;
    const token = await login('sidorov@example.com');
    const { json } = await call('/api/state', { token });
    expect(json.data!.tasks.some((t) => t.id === foreign.id)).toBe(false);
    const del = await call('/api/action', { method: 'POST', token, body: { action: { type: 'deleteTask', id: foreign.id } } });
    expect(del.status).toBe(403);
    const report = await call('/api/action', { method: 'POST', token, body: { action: { type: 'submitReport', weekStart: '2026-09-11T00:00:00.000Z' } } });
    expect(report.status).toBe(403);
    const after = await call('/api/state', { token: admin });
    expect(after.json.data!.tasks.some((t) => t.id === foreign.id)).toBe(true);
  });

  it('отдаёт задачи по иерархии: подчинённый — свои, руководитель — подразделения, администратор — все', async () => {
    const adminTasks = (await call('/api/state', { token: await login('user@example.com') })).json.data!.tasks;
    const executor = (await call('/api/state', { token: await login('sidorov@example.com') })).json.data!.tasks;
    const manager = (await call('/api/state', { token: await login('petrov@example.com') })).json.data!.tasks;
    expect(adminTasks.length).toBeGreaterThan(executor.length);
    expect(executor.length).toBeGreaterThan(0);
    expect(executor.every((t) => t.assigneeIds.includes(3))).toBe(true);
    // Петров — руководитель отделения «Руководство» (Иванов и Петров): чужих исполнителей в его выдаче нет.
    expect(manager.length).toBeGreaterThan(0);
    expect(manager.every((t) => t.assigneeIds.some((id) => id === 1 || id === 2))).toBe(true);
    expect(manager.length).toBeLessThan(adminTasks.length);
  });

  it('исполнитель создаёт заявку только на себя, даже если прислал чужой id', async () => {
    const token = await login('sidorov@example.com');
    await call('/api/state', { token });
    const draft = { employeeId: 1, type: 'vacation', from: '2026-11-02', to: '2026-11-06', status: 'approved', note: '' };
    const { json } = await call('/api/action', { method: 'POST', token, body: { action: { type: 'saveAbsence', draft } } });
    expect(json.data!.absences.find((a) => a.from === '2026-11-02')).toMatchObject({ employeeId: 3, status: 'request' });
  });

  it('отклоняет перевёрнутые сроки задачи и события', async () => {
    // Интерфейс это проверяет, но сервер данным клиента не доверяет: запрос может прийти и мимо него.
    const token = await login('user@example.com');
    const state = await call('/api/state', { token });
    const task = state.json.data!.tasks[0];
    const reversed = await call('/api/action', {
      method: 'POST',
      token,
      body: { action: { type: 'saveTask', draft: { ...task, start: '2026-09-20T12:00:00.000Z', end: '2026-09-18T09:00:00.000Z' } } },
    });
    expect(reversed.status).toBe(400);
    expect(reversed.json.error).toContain('окончание раньше начала');

    const absence = await call('/api/action', {
      method: 'POST',
      token,
      body: { action: { type: 'saveAbsence', draft: { employeeId: 4, type: 'vacation', from: '2026-12-10', to: '2026-12-01', status: 'approved', note: '' } } },
    });
    expect(absence.status).toBe(400);
    expect(absence.json.error).toContain('последний день раньше первого');

    // Одинаковые даты — это один день, их отклонять нельзя.
    const sameDay = await call('/api/action', {
      method: 'POST',
      token,
      body: { action: { type: 'saveAbsence', draft: { employeeId: 4, type: 'dayoff', from: '2026-12-10', to: '2026-12-10', status: 'approved', note: '' } } },
    });
    expect(sameDay.status).toBe(200);
    const after = await call('/api/state', { token });
    expect(after.json.data!.tasks.find((t) => t.id === task.id)!.end).toBe(task.end);
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

  it('пустая база получает справочники без тестовых данных; войти можно администратором по умолчанию', async () => {
    repo = createMemoryRepo();
    const admin = await login('user@example.com');
    const { json } = await call('/api/state', { token: admin });
    expect(json.data!.tasks).toEqual([]);
    expect(json.data!.messages).toEqual([]);
    expect(json.data!.absences).toEqual([]);
    expect(json.data!.users.map((u) => u.email)).toEqual(['user@example.com']);
    // Справочники и роли нужны для работы и записываются.
    expect(json.data!.dictionaries.length).toBeGreaterThan(0);
    expect(json.data!.roles.length).toBeGreaterThan(0);
    // Сохранение не подмешивает демоданные.
    await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'sendMessage', text: 'Первое сообщение' } } });
    const after = (await call('/api/state', { token: admin })).json.data!;
    expect(after.messages.map((m) => m.text)).toEqual(['Первое сообщение']);
    expect(after.tasks).toEqual([]);
    // Из подразделений — только ведомство, управление и отдел, без демонстрационных групп.
    expect(after.units!.map((u) => u.kind).sort()).toEqual(['department', 'directorate', 'organization']);
  });

  it('удаляет сообщение переписки только с правом «Переписка: удалять сообщения»', async () => {
    const admin = await login('user@example.com');
    const worker = await login('sidorov@example.com');
    const sent = await call('/api/action', { method: 'POST', token: worker, body: { action: { type: 'sendMessage', text: 'Лишнее сообщение' } } });
    const message = sent.json.data!.messages.find((m) => m.text === 'Лишнее сообщение')!;
    // Исполнитель удалить не может — даже своё сообщение.
    expect((await call('/api/action', { method: 'POST', token: worker, body: { action: { type: 'deleteMessage', id: message.id } } })).status).toBe(403);
    const removed = await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'deleteMessage', id: message.id } } });
    expect(removed.status).toBe(200);
    expect(removed.json.data!.messages.some((m) => m.id === message.id)).toBe(false);
    // Повторное удаление того же сообщения ничего не меняет.
    expect((await call('/api/action', { method: 'POST', token: admin, body: { action: { type: 'deleteMessage', id: message.id } } })).status).toBe(403);
  });

  it('неизвестный адрес — 404', async () => {
    expect((await call('/api/nothing')).status).toBe(404);
  });
});
