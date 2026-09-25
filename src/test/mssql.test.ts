// @vitest-environment node
// Хранилище SQL Server (server/mssqlRepo.ts) на настоящем SQL Server. Нужна переменная MSSQL_TEST_SERVER
// (например, «(local)» или «.\SQLEXPRESS»): тест создаёт временную базу по Windows-входу и удаляет её в конце.
import sql from 'msnodesqlv8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMssqlRepo } from '../../server/mssqlRepo';
import type { Repo } from '../../server/repo';
import { toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Data } from '../lib/types';

const NOW = new Date(2026, 8, 17, 12, 0);
const SERVER = process.env.MSSQL_TEST_SERVER;
const DRIVER = process.env.MSSQL_TEST_DRIVER ?? 'ODBC Driver 18 for SQL Server';
const DB = `tc_test_${process.pid}`;
const cs = (database: string) => `Driver={${DRIVER}};Server=${SERVER};Database=${database};Trusted_Connection=yes;TrustServerCertificate=yes;`;
const master = (text: string) => sql.promises.query(cs('master'), text);

let repo: Repo;

describe.skipIf(!SERVER)('SQL Server', () => {
  beforeAll(async () => {
    await master(`create database ${DB}; alter database ${DB} set read_committed_snapshot on;`);
    repo = createMssqlRepo(cs(DB), { max: 2 });
  }, 60_000);

  afterAll(async () => {
    await repo?.close?.();
    await master(`if db_id('${DB}') is not null begin alter database ${DB} set single_user with rollback immediate; drop database ${DB}; end`);
  }, 60_000);

  it('пустая база — null, после заполнения данные читаются без искажений', async () => {
    expect(await repo.read()).toBeNull();
    const seed = toData(createSeed(NOW));
    await repo.update(() => seed);
    const back = (await repo.read())!;
    expect(back.tasks).toEqual(seed.tasks);
    expect(back.absences).toEqual([...seed.absences].sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id)));
    expect(back.entitlements.length).toBe(seed.entitlements.length);
    expect(back.dictionaries!.find((d) => d.code === 'vacation')?.color).toBe('#9A6B12');
    expect(back.dictionaries!.find((d) => d.code === 'planned')?.color).toBeUndefined();
    expect(back.reports).toEqual(seed.reports);
    expect(back.messages).toEqual(seed.messages);
    expect(back.users).toEqual(seed.users);
    expect(back.roles!.map((r) => r.role).sort()).toEqual(seed.roles!.map((r) => r.role).sort());
  });

  it('хранит журнал уведомлений; правка без журнала его не трогает', async () => {
    const notice = { id: 'ntc-1', at: NOW.toISOString(), to: [1, 3], title: 'Новая задача', body: 'Проверить стенд', url: '/control' };
    await repo.update((d) => ({ ...d!, notices: [notice] }));
    expect((await repo.read())!.notices).toEqual([notice]);
    await repo.update((d) => { const { notices: _n, ...rest } = d!; return rest; });
    expect((await repo.read())!.notices).toEqual([notice]);
    await repo.update((d) => ({ ...d!, notices: [] }));
    expect((await repo.read())!.notices).toEqual([]);
  });

  it('пишет только изменения: добавление, правку и удаление', async () => {
    const before = (await repo.read())!;
    const long = 'Ж'.repeat(9000);
    const next: Data = {
      ...before,
      tasks: before.tasks.slice(1).map((t, i) => (i === 0 ? { ...t, title: 'Изменено', score: 7.5, done: true, result: long, doneAt: '2026-09-17T09:15:30.123Z' } : t)),
      absences: [...before.absences, { id: 'new-abs', employeeId: 4, type: 'sick', from: '2026-09-20', to: null, status: 'approved', note: '', decidedBy: 1, createdAt: NOW.toISOString() }],
      entitlements: before.entitlements.map((e) => (e.employeeId === 2 ? { ...e, carriedOver: 9 } : e)),
    };
    await repo.update(() => next);
    const after = (await repo.read())!;
    expect(after.tasks.length).toBe(before.tasks.length - 1);
    expect(after.tasks[0]).toMatchObject({ title: 'Изменено', score: 7.5, done: true, result: long, doneAt: '2026-09-17T09:15:30.123Z' });
    expect(after.absences.find((a) => a.id === 'new-abs')).toMatchObject({ to: null, type: 'sick' });
    expect(after.entitlements.find((e) => e.employeeId === 2)?.carriedOver).toBe(9);
  });

  it('ошибка внутри изменения откатывает транзакцию', async () => {
    const before = await repo.read();
    await expect(repo.update(() => { throw new Error('отказ'); })).rejects.toThrow('отказ');
    expect(await repo.read()).toEqual(before);
  });

  it('одновременные изменения не теряются', async () => {
    const add = (i: number) => repo.update((d) => ({ ...d!, messages: [...d!.messages, { id: `m-par-${i}`, authorId: 1, text: `№${i}`, sentAt: NOW.toISOString() }] }));
    await Promise.all([1, 2, 3, 4, 5, 6].map(add));
    const ids = (await repo.read())!.messages.map((m) => m.id);
    expect([1, 2, 3, 4, 5, 6].every((i) => ids.includes(`m-par-${i}`))).toBe(true);
  });

  it('база старой версии: при первой записи сохраняются значения по умолчанию', async () => {
    await sql.promises.query(cs(DB), `delete from tc_users; delete from tc_roles; delete from tc_plan_rows; delete from tc_dictionaries; delete from tc_units; delete from tc_templates;
      delete from tc_meta where [key] in ('access-ready', 'access-version', 'plan-rows-ready', 'dictionaries-ready', 'units-ready', 'templates-ready');`);
    const defaults = (await repo.read())!;
    await repo.update((d) => ({ ...d!, messages: [...d!.messages, { id: 'm-migr', authorId: 1, text: 'после переноса', sentAt: NOW.toISOString() }] }) as Data);
    const after = (await repo.read())!;
    expect(after.users!.map((u) => u.email).sort()).toEqual(defaults.users!.map((u) => u.email).sort());
    expect(after.roles!.length).toBe(defaults.roles!.length);
    expect(after.planRows!.length).toBe(defaults.planRows!.length);
    expect(after.dictionaries!.length).toBe(defaults.dictionaries!.length);
    expect(after.units!.length).toBe(defaults.units!.length);
    expect(after.templates!.map((t) => t.name)).toEqual(defaults.templates!.map((t) => t.name));
  });
});
