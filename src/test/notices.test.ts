// @vitest-environment node
// Уведомления: какие события порождает действие, кому они адресованы, журнал на сервере и ежедневное напоминание.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../server/app';
import { createMemoryRepo, type Repo } from '../../server/repo';
import { DEFAULT_USERS } from '../lib/access';
import { detectEvents, overdueNotice } from '../lib/notify';
import { reducer, toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Data, User } from '../lib/types';

const NOW = new Date(2026, 8, 17, 12, 0);
const BOSS: User = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
const SIDOROV: User = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' };
const seed = (user: User) => ({ ...createSeed(NOW), user });

describe('события уведомлений', () => {
  it('сообщение в переписке — всем, кроме автора', () => {
    const before = seed(SIDOROV);
    const after = reducer(before, { type: 'sendMessage', text: 'Сборка готова', now: NOW });
    const [e] = detectEvents(toData(before), toData(after), SIDOROV);
    expect(e).toMatchObject({ title: 'Переписка · Сидоров Д.Е.', body: 'Сборка готова', url: '/chat' });
    expect(e.to).toContain(1);
    expect(e.to).not.toContain(3);
  });

  it('задачи: назначение, перенос срока, исполнение', () => {
    const s0 = seed(BOSS);
    const s1 = reducer(s0, { type: 'saveTask', draft: { title: 'Проверить стенд', rowId: '1.1', category: null, assigneeIds: [1, 3], start: '2026-09-18T07:00:00.000Z', end: '2026-09-18T15:00:00.000Z', docName: '', docNumber: '', result: '', done: false, score: null }, now: NOW });
    const created = detectEvents(toData(s0), toData(s1), BOSS);
    expect(created).toEqual([expect.objectContaining({ to: [3], title: 'Новая задача', url: '/control' })]);
    // Время в тексте — московское, независимо от часового пояса сервера.
    expect(created[0].body).toContain('Срок: 18.09.2026, 18:00');

    const task = s1.tasks.find((t) => t.title === 'Проверить стенд')!;
    const s2 = reducer(s1, { type: 'saveTask', draft: { ...task, end: '2026-09-21T15:00:00.000Z' }, now: NOW });
    expect(detectEvents(toData(s1), toData(s2), BOSS)).toEqual([expect.objectContaining({ to: [3], title: 'Изменён срок задачи' })]);

    const asExecutor = { ...s2, user: SIDOROV };
    const s3 = reducer(asExecutor, { type: 'saveTask', draft: { ...s2.tasks.find((t) => t.id === task.id)!, result: 'Стенд проверен', done: true }, now: NOW });
    const done = detectEvents(toData(asExecutor), toData(s3), SIDOROV);
    expect(done).toEqual([expect.objectContaining({ title: 'Задача исполнена · Сидоров Д.Е.' })]);
    expect(done[0].to).toContain(1);
    expect(done[0].to).not.toContain(3);
  });

  it('заявка на отсутствие — руководителям, решение — сотруднику', () => {
    const s0 = seed(SIDOROV);
    const s1 = reducer(s0, { type: 'saveAbsence', draft: { employeeId: 3, type: 'vacation', from: '2026-10-05', to: '2026-10-09', status: 'request', note: '' }, now: NOW });
    const [request] = detectEvents(toData(s0), toData(s1), SIDOROV);
    expect(request).toMatchObject({ title: 'Заявка на отсутствие', url: '/tetris' });
    expect(request.body).toBe('Сидоров Д.Е.: отпуск 05.10–09.10');
    expect(request.to).toContain(1);
    const id = s1.absences.find((a) => a.employeeId === 3 && a.from === '2026-10-05' && a.status === 'request')!.id;
    const s2 = reducer({ ...s1, user: BOSS }, { type: 'decideAbsence', id, status: 'approved' });
    expect(detectEvents(toData(s1), toData(s2), BOSS)).toEqual([expect.objectContaining({ to: [3], title: 'Заявка согласована' })]);
  });

  it('отчёт недели — руководителям и баллы — исполнителям', () => {
    const s0 = seed(BOSS);
    const s1 = reducer(s0, { type: 'submitReport', weekStart: new Date(2026, 8, 11), now: NOW });
    const events = detectEvents(toData(s0), toData(s1), BOSS);
    expect(events.some((e) => e.title === 'Отчёт за неделю направлен')).toBe(true);
    const points = events.filter((e) => e.title === 'Начислены баллы');
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((e) => e.to.length === 1 && e.to[0] !== 1)).toBe(true);
  });

  it('напоминание о просрочке — сотруднику его задачи', () => {
    const data = toData(seed(BOSS));
    const e = overdueNotice(data, 2, NOW)!;
    expect(e.title).toMatch(/^Просроченные задачи: \d+$/);
    expect(e.to).toEqual([2]);
    expect(e.body.split('\n')[0]).toMatch(/^• /);
  });
});

describe('API уведомлений', () => {
  let repo: Repo;
  let server: Server;
  let base = '';
  let now = NOW;

  beforeAll(async () => {
    // Вход — только учётной записью Windows: доменный логин приходит заголовком, как от IIS.
    server = createServer((req, res) => createApi({ repo, secret: 's', now: () => now, windowsIdentity: (r) => (typeof r.headers['x-windows-user'] === 'string' ? r.headers['x-windows-user'] : null) })(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    // Сервер тестовых данных не создаёт: демонстрационный отдел кладётся в хранилище самим тестом.
    repo = createMemoryRepo(undefined, toData(createSeed(NOW)));
    now = NOW;
  });

  type Notice = { id: string; at: string; title: string; body: string; url: string };
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown; windowsUser?: string } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.windowsUser ? { 'x-windows-user': init.windowsUser } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as { data?: Data; notices?: Notice[]; now?: string } };
  };
  const login = async (email: string) =>
    (await call('/api/windows-login', { method: 'POST', windowsUser: `CORP\\${DEFAULT_USERS.find((u) => u.email === email)!.windowsLogin}` })).json as unknown as { token: string };
  const token = async (email: string) => (await login(email)).token;
  const notices = async (t: string, since?: string) => (await call(`/api/notices${since ? `?since=${encodeURIComponent(since)}` : ''}`, { token: t })).json;

  it('первый опрос даёт отметку времени; дальше — только новые уведомления получателя', async () => {
    const boss = await token('user@example.com');
    const worker = await token('sidorov@example.com');
    expect((await call('/api/notices')).status).toBe(403);
    const start = await notices(boss);
    expect(start.notices).toEqual([]);
    now = new Date(NOW.getTime() + 60_000);
    await call('/api/action', { method: 'POST', token: worker, body: { action: { type: 'sendMessage', text: 'Стенд готов' } } });
    const got = await notices(boss, start.now);
    expect(got.notices).toEqual([expect.objectContaining({ title: 'Переписка · Сидоров Д.Е.', body: 'Стенд готов', url: '/chat' })]);
    expect(got.notices![0]).not.toHaveProperty('to');
    // Автору своё сообщение не приходит; повторный опрос с новой отметкой — пусто.
    expect((await notices(worker, start.now)).notices!.filter((n) => n.url === '/chat')).toEqual([]);
    expect((await notices(boss, got.now)).notices).toEqual([]);
  });

  it('журнал не передаётся в данных приложения; устаревшие уведомления удаляются', async () => {
    const worker = await token('sidorov@example.com');
    const res = await call('/api/action', { method: 'POST', token: worker, body: { action: { type: 'sendMessage', text: 'раз' } } });
    expect(res.json.data).not.toHaveProperty('notices');
    expect((await repo.read())!.notices).toHaveLength(1);
    now = new Date(NOW.getTime() + 8 * 24 * 3600 * 1000);
    // Через 8 дней нужен новый вход: сеанс действует 7 дней.
    await call('/api/action', { method: 'POST', token: await token('sidorov@example.com'), body: { action: { type: 'sendMessage', text: 'два' } } });
    expect((await repo.read())!.notices!.map((n) => n.body)).toEqual(['два']);
  });

  it('восстановление демоданных отклоняется и уведомлений не создаёт', async () => {
    const boss = await token('user@example.com');
    expect((await call('/api/action', { method: 'POST', token: boss, body: { action: { type: 'reset' } } })).status).toBe(400);
    expect((await repo.read())!.notices ?? []).toEqual([]);
  });

  it('напоминание о просрочке — после 9:00 и один раз в день', async () => {
    const petrov = await token('petrov@example.com');
    const overdue = (list?: Notice[]) => (list ?? []).filter((n) => n.title.startsWith('Просроченные задачи'));
    now = new Date('2026-09-17T05:30:00Z'); // 8:30 по Москве
    expect(overdue((await notices(petrov, '2026-09-17T00:00:00Z')).notices)).toHaveLength(0);
    now = new Date('2026-09-17T06:30:00Z'); // 9:30 по Москве
    expect(overdue((await notices(petrov, '2026-09-17T00:00:00Z')).notices)).toHaveLength(1);
    expect(overdue((await notices(petrov, '2026-09-17T00:00:00Z')).notices)).toHaveLength(1);
  });
});
