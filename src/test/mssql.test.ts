// @vitest-environment node
// Хранилище Microsoft SQL Server (server/mssqlRepo.ts): настройки подключения, схема и запись изменений.
// Проверка на настоящем сервере включается переменными MSSQL_TEST_SERVER/USER/PASSWORD:
//   npm run test:mssql — см. README, раздел «Проверки».
// Без MSSQL_TEST_USER — вход Windows под текущей учётной записью (ODBC, msnodesqlv8).
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMssqlRepo, mssqlSettingsFromEnv, odbcConnectionString, pickOdbcDriver, SCHEMA, usesWindowsLogin } from '../../server/mssqlRepo';
import { secretFromEnv } from '../../server/auth';
import { storageKindFromEnv } from '../../server/storage';
import type { Repo } from '../../server/repo';
import { toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Data } from '../lib/types';

const NOW = new Date(2026, 8, 17, 12, 0);

describe('SQL Server: настройки подключения', () => {
  it('без MSSQL_SERVER хранилище не выбирается', () => {
    expect(mssqlSettingsFromEnv({})).toBeNull();
    expect(storageKindFromEnv({})).toBe('file');
    expect(storageKindFromEnv({ DATABASE_URL: 'postgres://x' })).toBe('postgres');
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

  it('SQL Server имеет приоритет над PostgreSQL и даёт свой ключ подписи сеансов', () => {
    const env = { MSSQL_SERVER: 'SQLSRV', DATABASE_URL: 'postgres://x' };
    expect(storageKindFromEnv(env)).toBe('sqlserver');
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
    for (const statement of SCHEMA) expect(statement).toMatch(/if\s+(object_id|not exists|col_length)/i);
    // Фильтрованному индексу нужен QUOTED_IDENTIFIER ON, иначе схему не применить вручную.
    expect(SCHEMA.find((s) => s.includes('tc_users_windows_login'))).toMatch(/set quoted_identifier on/i);
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
  });

  it('демоданные разрешены, только если таблиц до подключения не было', async () => {
    // Первое хранилище создало таблицы само — ему можно заполнить базу демоданными.
    expect(await repo.seedDemo!()).toBe(true);
    // Следующий запуск видит уже существующие (пусть и пустые) таблицы — демоданных не будет.
    const again = createMssqlRepo({ server: server!, database, ...(user ? { user } : {}), ...(password ? { password } : {}), encrypt: false, trustServerCertificate: true });
    try {
      expect(await again.seedDemo!()).toBe(false);
    } finally {
      await again.close?.();
    }
  });

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

  it('база старой версии: при первой записи сохраняются пользователи, роли, словари и позиции плана по умолчанию', async () => {
    await raw(`delete from dbo.tc_users; delete from dbo.tc_roles; delete from dbo.tc_plan_rows; delete from dbo.tc_dictionaries; delete from dbo.tc_units; delete from dbo.tc_templates;
      delete from dbo.tc_meta where [key] in ('access-ready', 'access-version', 'plan-rows-ready', 'dictionaries-ready', 'units-ready', 'templates-ready');`);
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
