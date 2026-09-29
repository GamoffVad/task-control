// @vitest-environment node
// Хранилище PostgreSQL (server/pgRepo.ts) на встроенном PostgreSQL (PGlite): схема, типы, запись изменений.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgRepo } from '../../server/pgRepo';
import type { Repo } from '../../server/repo';
import { toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Data } from '../lib/types';

const NOW = new Date(2026, 8, 17, 12, 0);
const PORT = 54329;

let db: PGlite;
let server: PGLiteSocketServer;
let repo: Repo;

beforeAll(async () => {
  db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  repo = createPgRepo(`postgres://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`, { max: 1 });
}, 60_000);

afterAll(async () => {
  await repo.close?.();
  await server.stop();
  await db.close();
});

describe('PostgreSQL', () => {
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

  it('хранит отметки «прочитано» переписки', async () => {
    const readAt = NOW.toISOString();
    await repo.update((d) => ({ ...d!, chatReads: [{ employeeId: 1, readAt }, { employeeId: 3, readAt }] }));
    await repo.update((d) => ({ ...d!, chatReads: d!.chatReads!.filter((r) => r.employeeId !== 3) }));
    expect((await repo.read())!.chatReads).toEqual([{ employeeId: 1, readAt }]);
  });

  it('пишет только изменения: добавление, правку и удаление', async () => {
    const before = (await repo.read())!;
    const next: Data = {
      ...before,
      tasks: before.tasks.slice(1).map((t, i) => (i === 0 ? { ...t, title: 'Изменено', score: 7.5, done: true, result: 'ок', doneAt: NOW.toISOString() } : t)),
      absences: [...before.absences, { id: 'new-abs', employeeId: 4, type: 'sick', from: '2026-09-20', to: null, status: 'approved', note: '', decidedBy: 1, createdAt: NOW.toISOString() }],
      entitlements: before.entitlements.map((e) => (e.employeeId === 2 ? { ...e, carriedOver: 9 } : e)),
    };
    await repo.update(() => next);
    const after = (await repo.read())!;
    expect(after.tasks.length).toBe(before.tasks.length - 1);
    expect(after.tasks[0]).toMatchObject({ title: 'Изменено', score: 7.5, done: true });
    expect(after.absences.find((a) => a.id === 'new-abs')).toMatchObject({ to: null, type: 'sick' });
    expect(after.entitlements.find((e) => e.employeeId === 2)?.carriedOver).toBe(9);
  });

  it('хранит правила подсчёта баллов', async () => {
    const scoring = { excludedUnitIds: ['g-1'], excludedEmployeeIds: [5], averageBase: 'withScore' as const, byDirection: false };
    await repo.update((d) => ({ ...d!, scoring }));
    expect((await repo.read())!.scoring).toEqual(scoring);
    // Правка без правил их не теряет.
    await repo.update((d) => ({ ...d!, messages: [...d!.messages, { id: 'm-scoring', authorId: 1, text: 'после правил', sentAt: NOW.toISOString() }] }));
    expect((await repo.read())!.scoring).toEqual(scoring);
  });

  it('ошибка внутри изменения откатывает транзакцию', async () => {
    const before = await repo.read();
    await expect(
      repo.update((cur) => {
        void cur;
        throw new Error('отказ');
      }),
    ).rejects.toThrow('отказ');
    expect(await repo.read()).toEqual(before);
  });
  it('база старой версии: при первой записи сохраняются пользователи, роли, словари и позиции плана по умолчанию', async () => {
    // Состояние до появления администрирования: таблицы пустые, отметок о заполнении нет.
    await db.exec(`delete from tc_users; delete from tc_roles; delete from tc_plan_rows; delete from tc_dictionaries; delete from tc_units; delete from tc_templates;
      delete from tc_meta where key in ('access-ready', 'access-version', 'plan-rows-ready', 'dictionaries-ready', 'units-ready', 'templates-ready');`);
    const defaults = (await repo.read())!;
    expect(defaults.users!.length).toBeGreaterThan(1);
    await repo.update((d) => ({ ...d!, messages: [...d!.messages, { id: 'm-migr', authorId: 1, text: 'после переноса', sentAt: NOW.toISOString() }] }) as Data);
    const after = (await repo.read())!;
    expect(after.users!.map((u) => u.email).sort()).toEqual(defaults.users!.map((u) => u.email).sort());
    expect(after.roles!.length).toBe(defaults.roles!.length);
    expect(after.planRows!.length).toBe(defaults.planRows!.length);
    expect(after.dictionaries!.length).toBe(defaults.dictionaries!.length);
    expect(after.units!.length).toBe(defaults.units!.length);
    expect(after.templates!.map((t) => t.name)).toEqual(defaults.templates!.map((t) => t.name));
    expect(after.users!.find((u) => u.employeeId === 101)?.unitId).toBe('s-dev');
  });
});
