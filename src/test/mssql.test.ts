// @vitest-environment node
// Хранилище Microsoft SQL Server (server/mssqlRepo.ts): настройки подключения, схема и запись изменений.
// Проверка на настоящем сервере включается переменными MSSQL_TEST_SERVER/USER/PASSWORD:
//   npm run test:mssql — см. README, раздел «Проверки».
// Без MSSQL_TEST_USER — вход Windows под текущей учётной записью (ODBC, msnodesqlv8).
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, createMssqlRepo, mssqlSettingsFromEnv, odbcConnectionString, pickOdbcDriver, SCHEMA, TABLES, usesWindowsLogin } from '../../server/mssqlRepo';
import { schemaUpdateScript } from '../../server/databaseScript';
import { secretFromEnv } from '../../server/auth';
import { storageKindFromEnv } from '../../server/storage';
import type { Repo } from '../../server/repo';
import { fromData, reducer, toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Data } from '../lib/types';

const NOW = new Date(2026, 8, 17, 12, 0);

describe('SQL Server: настройки подключения', () => {
  it('без MSSQL_SERVER хранилище не выбирается', () => {
    expect(mssqlSettingsFromEnv({})).toBeNull();
    // Других хранилищ нет: без SQL Server приложение не работает.
    expect(storageKindFromEnv({})).toBe('none');
    expect(storageKindFromEnv({ MSSQL_SERVER: 'localhost' })).toBe('sqlserver');
  });

  it('имя базы по умолчанию — TaskControl, экземпляр разбирается из имени сервера', () => {
    const s = mssqlSettingsFromEnv({ MSSQL_SERVER: 'SQLSRV\\BUH' })!;
    expect(s).toMatchObject({ server: 'SQLSRV', instanceName: 'BUH', database: 'TaskControl' });
    // Внутри сети сертификат обычно самоподписанный.
    expect(s).toMatchObject({ encrypt: true, trustServerCertificate: true });
  });

  it('учётная запись, порт и отдельный экземпляр берутся из переменных', () => {
    const s = mssqlSettingsFromEnv({
      MSSQL_SERVER: '10.199.127.30',
      MSSQL_DATABASE: 'Plan',
      MSSQL_PORT: '1444',
      MSSQL_USER: 'tc_app',
      MSSQL_PASSWORD: 'secret',
      MSSQL_ENCRYPT: 'false',
    })!;
    expect(s).toMatchObject({ server: '10.199.127.30', database: 'Plan', port: 1444, user: 'tc_app', password: 'secret', encrypt: false });
  });

  it('SQL Server даёт свой ключ подписи сеансов', () => {
    expect(storageKindFromEnv({ MSSQL_SERVER: 'SQLSRV' })).toBe('sqlserver');
    expect(mssqlSettingsFromEnv({ MSSQL_DOMAIN: 'CORP', MSSQL_SERVER: 'SQLSRV' })!.domain).toBe('CORP');
    // Без AUTH_SECRET ключ выводится из настроек базы, а не остаётся отладочным.
    expect(secretFromEnv({ MSSQL_SERVER: 'SQLSRV' })).not.toBe('task-control-dev-secret');
    expect(secretFromEnv({ MSSQL_SERVER: 'SQLSRV' })).toBe(secretFromEnv({ MSSQL_SERVER: 'SQLSRV' }));
    expect(secretFromEnv({ MSSQL_SERVER: 'SQLSRV' })).not.toBe(secretFromEnv({ MSSQL_SERVER: 'OTHER' }));
  });

  it('без MSSQL_USER — вход Windows через ODBC, с ним — учётная запись SQL Server', () => {
    expect(usesWindowsLogin(mssqlSettingsFromEnv({ MSSQL_SERVER: 'localhost' })!)).toBe(true);
    expect(usesWindowsLogin(mssqlSettingsFromEnv({ MSSQL_SERVER: 'localhost', MSSQL_USER: 'tc_app', MSSQL_PASSWORD: 'x' })!)).toBe(false);
    // Самый новый установленный драйвер; заданный в настройках — важнее; «SQL Server» есть в любой Windows.
    expect(pickOdbcDriver(['SQL Server', 'ODBC Driver 17 for SQL Server', 'ODBC Driver 18 for SQL Server'])).toBe('ODBC Driver 18 for SQL Server');
    expect(pickOdbcDriver(['SQL Server'])).toBe('SQL Server');
    expect(pickOdbcDriver([])).toBe('SQL Server');
    expect(pickOdbcDriver(['ODBC Driver 18 for SQL Server'], 'ODBC Driver 17 for SQL Server')).toBe('ODBC Driver 17 for SQL Server');
    const named = mssqlSettingsFromEnv({ MSSQL_SERVER: 'SQLSRV\\BUH', MSSQL_PORT: '1450' })!;
    expect(odbcConnectionString(named, 'TaskControl', 'ODBC Driver 18 for SQL Server')).toBe(
      'Driver={ODBC Driver 18 for SQL Server};Server=SQLSRV\\BUH,1450;Database=TaskControl;Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=yes;',
    );
    expect(odbcConnectionString(mssqlSettingsFromEnv({ MSSQL_SERVER: 'localhost' })!, 'master', 'SQL Server')).toBe('Driver={SQL Server};Server=localhost;Database=master;Trusted_Connection=yes;');
  });

  it('схема создаётся отдельными операторами и повторный запуск её не ломает', () => {
    expect(SCHEMA.length).toBeGreaterThan(10);
    // Каждый оператор защищён проверкой существования, иначе второй запуск упал бы.
    for (const statement of SCHEMA) expect(statement).toMatch(/if\s+(object_id|not exists|exists|col_length)/i);
    // Фильтрованному индексу нужен QUOTED_IDENTIFIER ON, иначе схему не применить вручную.
    expect(SCHEMA.find((s) => s.includes('tc_users_windows_login'))).toMatch(/set quoted_identifier on/i);
  });
  it('расширяет старый код события и снимает ограничение на пять видов', () => {
    expect(SCHEMA.join('\n')).toContain('alter table dbo.tc_absences drop constraint [ck_tc_absences_type]');
    expect(SCHEMA.join('\n')).toContain('alter column [type] nvarchar(64) not null');
    expect(SCHEMA.join('\n')).toContain('[duty_type] nvarchar(48) null');
  });
});

// ——— Проверка на настоящем сервере ———

const server = process.env.MSSQL_TEST_SERVER;
const user = process.env.MSSQL_TEST_USER;
const password = process.env.MSSQL_TEST_PASSWORD;
const database = `TaskControlTest${process.pid}`;
const live = !!server;

const masterConfig = (): sql.config => ({
  server: server!,
  database: 'master',
  ...(user ? { user } : {}),
  ...(password ? { password } : {}),
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
});

/** Прямой запрос в обход хранилища: для подготовки «старой» базы. */
// Соединения переиспользуются: на каждый оператор схемы новый пул открывался бы дольше, чем идёт тест.
const pools = new Map<string, Promise<sql.ConnectionPool>>();
const poolFor = (db: string) => {
  let pool = pools.get(db);
  if (!pool) {
    pool = user
      ? new sql.ConnectionPool({ ...masterConfig(), database: db }).connect()
      : import('mssql/msnodesqlv8').then((odbc) => {
          const settings = { server: server!, database: db, encrypt: false, trustServerCertificate: true };
          const driver = process.env.MSSQL_TEST_ODBC_DRIVER || 'SQL Server';
          return new (odbc.default as unknown as typeof sql).ConnectionPool({ connectionString: odbcConnectionString(settings, db, driver) } as unknown as sql.config).connect();
        });
    pools.set(db, pool);
  }
  return pool;
};
const raw = async (text: string, db = database) => (await poolFor(db)).request().query(text);
const closePools = async () => {
  for (const pool of pools.values()) await (await pool).close().catch(() => undefined);
  pools.clear();
};

let repo: Repo;

describe.skipIf(!live)('SQL Server: хранилище', () => {
  beforeAll(async () => {
    repo = createMssqlRepo({ server: server!, database, ...(user ? { user } : {}), ...(password ? { password } : {}), encrypt: false, trustServerCertificate: true });
  }, 120_000);

  afterAll(async () => {
    await repo?.close?.();
    await pools.get(database)?.then((p) => p.close()).catch(() => undefined);
    pools.delete(database);
    await raw(`if db_id(N'${database}') is not null begin alter database [${database}] set single_user with rollback immediate; drop database [${database}]; end`, 'master');
    await closePools();
  }, 120_000);

  it('создаёт базу и таблицы сама; пустая база читается как null', async () => {
    expect(await repo.read()).toBeNull();
    const tables = await raw('select count(*) as n from sys.tables');
    expect((tables.recordset[0] as { n: number }).n).toBeGreaterThan(10);
  }, 30_000);

  it('после заполнения данные читаются без искажений', async () => {
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
    // Роли читаются по алфавиту кода — как и в PostgreSQL, поэтому сравниваем без учёта порядка.
    expect([...back.roles!].sort((a, b) => a.role.localeCompare(b.role))).toEqual([...seed.roles!].sort((a, b) => a.role.localeCompare(b.role)));
    expect(back.users).toEqual(seed.users);
    // Подразделения и шаблоны читаются по id и названию — сравниваем без учёта порядка.
    expect([...back.units!].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...seed.units!].sort((a, b) => a.id.localeCompare(b.id)));
    expect([...back.templates!].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...seed.templates!].sort((a, b) => a.id.localeCompare(b.id)));
    expect(back.planRows).toEqual(seed.planRows);
  });

  it('сохраняет рисунок через границу года и оба фрагмента после стирания в SQL Server', async () => {
    const before = (await repo.read())!;
    const stroke = { employeeId: 3, type: 'vacation', vacationType: 'annual', from: '2030-12-30', to: '2031-01-03', mode: 'paint' as const };
    const admin = { employeeId: 1, email: before.users[0].email, role: 'administrator' as const };
    try {
      await repo.update((data) => toData(reducer(fromData(data!, admin), { type: 'paintAbsences', stroke, now: NOW })));
      expect((await repo.read())!.absences.find((a) => a.from === stroke.from)).toMatchObject({ to: '2031-01-03', status: 'approved' });
      await repo.update((data) => toData(reducer(fromData(data!, admin), { type: 'paintAbsences', stroke: { ...stroke, from: '2030-12-31', to: '2031-01-01', mode: 'erase' }, now: NOW })));
      const fragments = (await repo.read())!.absences.filter((a) => a.from >= '2030-12-30');
      expect(fragments.map((a) => [a.from, a.to]).sort()).toEqual([['2030-12-30', '2030-12-30'], ['2031-01-02', '2031-01-03']]);
      expect(new Set(fragments.map((a) => a.id)).size).toBe(2);
    } finally { await repo.update(() => before); }
  });

  it('обновляет старую таблицу отсутствий и сохраняет произвольные коды и виды дежурств', async () => {
    const before = (await repo.read())!;
    await raw("alter table dbo.tc_absences drop column [duty_type]; alter table dbo.tc_absences alter column [type] nvarchar(16) not null; alter table dbo.tc_absences add constraint ck_tc_absences_type check ([type] in ('vacation','trip','dayoff','sick','study'));");
    const again = createMssqlRepo({ server: server!, database, ...(user ? { user } : {}), ...(password ? { password } : {}), encrypt: false, trustServerCertificate: true });
    try {
      expect((await again.read())!.absences).toEqual(before.absences);
      const duty = { id: 'duty-test', employeeId: 3, type: 'duty', dutyType: 'daily', from: '2026-09-19', to: '2026-09-20', note: '', status: 'approved' as const, decidedBy: 1, createdAt: NOW.toISOString() };
      const custom = { ...duty, id: 'custom-test', type: 'отсутствие-с-длинным-кодом-из-справочника', dutyType: undefined };
      await again.update((data) => ({ ...data!, absences: [...data!.absences, duty, custom] }));
      const back = (await again.read())!;
      expect(back.absences.find((a) => a.id === duty.id)).toEqual(duty);
      expect(back.absences.find((a) => a.id === custom.id)?.type).toBe(custom.type);
      await again.update(() => before);
    } finally { await again.close?.(); }
  }, 60_000);

  it('сохраняет нормы, тип отпуска и дату ежегодного сброса в SQL Server', async () => {
    await repo.update(() => toData(createSeed(NOW)));
    await repo.update((data) => ({ ...data!, vacationSettings: { resetMonth: 4, resetDay: 15 }, users: data!.users.map((u) => u.employeeId === 3 ? { ...u, annualVacationDays: 42 } : u), absences: data!.absences.map((a) => a.type === 'vacation' ? { ...a, vacationType: 'annual', travelDaysBefore: 1, travelDaysAfter: 1 } : a) }));
    const back = (await repo.read())!;
    expect(back.vacationSettings).toEqual({ resetMonth: 4, resetDay: 15 });
    expect(back.users.find((u) => u.employeeId === 3)).toMatchObject({ annualVacationDays: 42 });
    expect(back.absences.filter((a) => a.type === 'vacation').every((a) => a.vacationType === 'annual' && a.travelDaysBefore === 1 && a.travelDaysAfter === 1)).toBe(true);
  });
  it('сохраняет цвета видов дежурств и отпусков после переподключения без изменения периодов', async () => {
    const before = (await repo.read())!;
    const again = createMssqlRepo({ server: server!, database, ...(user ? { user } : {}), ...(password ? { password } : {}), encrypt: false, trustServerCertificate: true });
    try {
      await repo.update((data) => ({ ...data!, dictionaries: data!.dictionaries.map((entry) => entry.dictionary === 'dutyType' ? { ...entry, color: '#174EA6' } : entry.dictionary === 'vacationType' ? { ...entry, color: '#663399' } : entry) }));
      const after = (await again.read())!;
      expect(after.dictionaries.filter((entry) => entry.dictionary === 'dutyType').every((entry) => entry.color === '#174EA6')).toBe(true);
      expect(after.dictionaries.filter((entry) => entry.dictionary === 'vacationType').every((entry) => entry.color === '#663399')).toBe(true);
      expect(after.absences).toEqual(before.absences);
      expect(after.entitlements).toEqual(before.entitlements);
    } finally { await again.close?.(); await repo.update(() => before); }
  });

  it('хранит общие периоды и фиксирует последний день отправленного отчёта', async () => {
    const before = (await repo.read())!;
    const settings = { planning: { startDay: 1, endDay: 0 }, reporting: { startDay: 1, endDay: 5 } };
    await repo.update((data) => ({ ...data!, periodSettings: settings, reports: data!.reports.map((r, i) => i === 0 ? { ...r, periodEnd: r.weekStart } : r) }));
    const back = (await repo.read())!;
    expect(back.periodSettings).toEqual(settings);
    expect(back.reports[0].periodEnd).toBe(back.reports[0].weekStart);
    await repo.update(() => before);
  });

  it('сохраняет и снимает скрытие сотрудника в SQL Server', async () => {
    const before = (await repo.read())!;
    await repo.update((data) => ({ ...data!, users: data!.users.map((account) => account.employeeId === 3 ? { ...account, hidden: true } : account) }));
    expect((await repo.read())!.users.find((account) => account.employeeId === 3)).toMatchObject({ hidden: true, active: true });
    await repo.update((data) => ({ ...data!, users: before.users }));
    expect((await repo.read())!.users.find((account) => account.employeeId === 3)?.hidden).toBeFalsy();
  });

  it('обновляет старую схему без потери записей, неизвестных столбцов и настроек; повторный запуск допустим', async () => {
    // Имитируем базу старой версии без служебных отметок, с дополнительными объектами организации.
    await raw(`delete from dbo.tc_meta where [key] in ('seeded', 'access-ready', 'access-version', 'dictionaries-ready', 'plan-rows-ready', 'units-ready', 'templates-ready');
      alter table dbo.tc_tasks add [corporate_reference] nvarchar(100) null;
      create table dbo.corporate_settings ([id] int primary key, [value] nvarchar(100));
      insert into dbo.corporate_settings values (1, N'Сохранить настройку');`);
    await raw("update dbo.tc_tasks set corporate_reference = N'Рабочий номер документа';");
    const removed: Record<string, string[]> = {
      tc_users: ['hidden', 'annual_vacation_days'], tc_absences: ['duty_type', 'vacation_type', 'travel_days_before', 'travel_days_after'], tc_reports: ['period_end'],
    };
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of TABLES) {
        const columns = table.columns.filter((c) => !removed[table.name]?.includes(c.name)).map((c) => `[${c.name}]`).join(',');
        result[table.name] = (await raw(`select ${columns} from dbo.${table.name} order by ${table.primaryKey.map((c) => `[${c}]`).join(',')}`)).recordset;
      }
      result.extra = (await raw('select id, corporate_reference from dbo.tc_tasks order by id;')).recordset;
      result.settings = (await raw('select * from dbo.corporate_settings;')).recordset;
      return result;
    };
    const before = await snapshot();
    await raw('alter table dbo.tc_users drop constraint df_tc_users_hidden; drop table dbo.tc_chat_reads;');
    for (const [table, columns] of Object.entries(removed)) for (const column of columns) await raw(`alter table dbo.${table} drop column [${column}];`);
    const again = createMssqlRepo({ server: server!, database, ...(user ? { user } : {}), ...(password ? { password } : {}), encrypt: false, trustServerCertificate: true });
    try {
      await again.ping!();
      expect(await snapshot()).toEqual(before);
      expect((await raw("select [hidden], [annual_vacation_days] from dbo.tc_users;")).recordset.every((row) => row.hidden === false && row.annual_vacation_days === null)).toBe(true);
      // Ручной скрипт и два одновременно запускаемых процесса используют ту же схему и блокировку.
      await raw(schemaUpdateScript().replace(/^\ufeff/, ''));
      await Promise.all([applySchema(await poolFor(database)), applySchema(await poolFor(database))]);
      expect(await snapshot()).toEqual(before);
    } finally {
      await again.close?.();
    }
  }, 120_000);

  it('ошибка миграции откатывает уже добавленные объекты и не меняет данные', async () => {
    const before = (await repo.read())!;
    await expect(applySchema(await poolFor(database), [
      'create table dbo.tc_upgrade_probe ([id] int);',
      "throw 50003, N'Контрольная ошибка обновления', 1;",
    ])).rejects.toThrow();
    expect((await raw("select object_id('dbo.tc_upgrade_probe') as probe;")).recordset[0].probe).toBeNull();
    expect(await repo.read()).toEqual(before);
  });

  it('ручной скрипт отказывается обновлять системную базу', async () => {
    await expect(raw(schemaUpdateScript().replace(/^\ufeff/, ''), 'master')).rejects.toThrow();
  });

  it('недостающие столбцы дописываются при подключении, данные остаются', async () => {
    const before = (await repo.read())!;
    // Как в базе старой версии или правленной вручную: столбцов нет.
    await raw(`alter table dbo.tc_users drop constraint df_tc_users_position; alter table dbo.tc_users drop column [position];
      declare @c sysname = (select name from sys.default_constraints where parent_object_id = object_id('dbo.tc_tasks') and col_name(parent_object_id, parent_column_id) = 'result');
      exec('alter table dbo.tc_tasks drop constraint ' + @c); alter table dbo.tc_tasks drop column [result];`);
    const again = createMssqlRepo({ server: server!, database, ...(user ? { user } : {}), ...(password ? { password } : {}), encrypt: false, trustServerCertificate: true });
    try {
      const after = (await again.read())!;
      const columns = await raw("select col_length('dbo.tc_users', 'position') as p, col_length('dbo.tc_tasks', 'result') as r");
      expect(columns.recordset[0]).toMatchObject({ p: expect.any(Number), r: expect.any(Number) });
      // Строки на месте; у дописанных столбцов — значения по умолчанию.
      expect(after.users.map((u) => u.email)).toEqual(before.users.map((u) => u.email));
      expect(after.tasks.map((t) => t.id)).toEqual(before.tasks.map((t) => t.id));
      expect(after.users.every((u) => u.position === '')).toBe(true);
    } finally {
      await again.close?.();
    }
  }, 60_000);

  it('повторное создание схемы ничего не ломает', async () => {
    for (const statement of SCHEMA) await raw(statement);
    expect((await repo.read())!.tasks.length).toBeGreaterThan(0);
  }, 30_000);

  it('даты отсутствий не сдвигаются часовым поясом', async () => {
    const before = (await repo.read())!;
    const vacation = { id: 'abs-tz', employeeId: 4, type: 'vacation' as const, from: '2026-01-01', to: '2026-01-10', status: 'approved' as const, note: '', decidedBy: 1, createdAt: NOW.toISOString() };
    await repo.update((d) => ({ ...d!, absences: [...before.absences, vacation] }));
    const back = (await repo.read())!.absences.find((a) => a.id === 'abs-tz')!;
    expect(back.from).toBe('2026-01-01');
    expect(back.to).toBe('2026-01-10');
  });

  it('хранит журнал уведомлений; правка без журнала его не трогает', async () => {
    const notice = { id: 'ntc-1', at: NOW.toISOString(), to: [1, 3], title: 'Новая задача', body: 'Проверить стенд', url: '/control' };
    await repo.update((d) => ({ ...d!, notices: [notice] }));
    expect((await repo.read())!.notices).toEqual([notice]);
    await repo.update((d) => {
      const { notices: _n, ...rest } = d!;
      return rest;
    });
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
      repo.update(() => {
        throw new Error('отказ');
      }),
    ).rejects.toThrow('отказ');
    expect(await repo.read()).toEqual(before);
  });

  it('одновременные правки не теряются', async () => {
    const start = (await repo.read())!.messages.length;
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        repo.update((d) => ({ ...d!, messages: [...d!.messages, { id: `m-par-${n}`, authorId: 1, text: `сообщение ${n}`, sentAt: NOW.toISOString() }] })),
      ),
    );
    const after = (await repo.read())!;
    expect(after.messages.length).toBe(start + 4);
    expect(after.messages.filter((m) => m.id.startsWith('m-par-')).length).toBe(4);
  });

  it('настройки способа входа сохраняются', async () => {
    await repo.update((d) => ({ ...d!, authentication: { mode: 'windows', allowEmergencyForm: true } }));
    expect((await repo.read())!.authentication).toEqual({ mode: 'windows', allowEmergencyForm: true });
    await repo.update((d) => ({ ...d!, authentication: { mode: 'form', allowEmergencyForm: true } }));
  });

  it('база без отметок: роли, словари и позиции плана — по умолчанию, а пустая tc_users не заменяется демонстрационными', async () => {
    await raw(`delete from dbo.tc_users; delete from dbo.tc_roles; delete from dbo.tc_plan_rows; delete from dbo.tc_dictionaries; delete from dbo.tc_units; delete from dbo.tc_templates;
      delete from dbo.tc_meta where [key] in ('access-ready', 'access-version', 'plan-rows-ready', 'dictionaries-ready', 'units-ready', 'templates-ready');`);
    const defaults = (await repo.read())!;
    // Сотрудники — только из таблицы: очищенная tc_users остаётся пустой.
    expect(defaults.users).toEqual([]);
    expect(defaults.units!.map((unit) => unit.kind).sort()).toEqual(['department', 'directorate', 'organization']);
    await repo.update((d) => ({ ...d!, messages: [...d!.messages, { id: 'm-migr', authorId: 1, text: 'после переноса', sentAt: NOW.toISOString() }] }) as Data);
    const after = (await repo.read())!;
    expect(after.users).toEqual([]);
    expect(after.roles!.length).toBe(defaults.roles!.length);
    expect(after.planRows!.length).toBe(defaults.planRows!.length);
    expect(after.dictionaries!.length).toBe(defaults.dictionaries!.length);
    expect(after.units!.length).toBe(defaults.units!.length);
    expect(after.templates!.map((t) => t.name)).toEqual(defaults.templates!.map((t) => t.name));
  });

  it('частично заполненная база только с нормами не считается новой и не получает тестовых сотрудников', async () => {
    for (const table of TABLES) await raw(`delete from dbo.${table.name};`);
    await raw('insert into dbo.tc_entitlements (employee_id, [year], vacation_days, carried_over, dayoff_accrued) values (901, 2026, 42, 3, 7);');
    const data = await repo.read();
    expect(data).not.toBeNull();
    expect(data!.users).toEqual([]);
    expect(data!.tasks).toEqual([]);
    expect(data!.reports).toEqual([]);
    expect(data!.entitlements).toEqual([{ employeeId: 901, year: 2026, vacationDays: 42, carriedOver: 3, dayoffAccrued: 7 }]);
  });
});
