// Хранилище в Microsoft SQL Server (развёртывание в IIS корпоративной сети). Повторяет pgRepo.ts:
// каждая сущность — своя таблица, изменения пишутся в транзакции под общей блокировкой (sp_getapplock).
// Драйвер msnodesqlv8 работает через ODBC Windows, поэтому возможен вход по учётной записи пула IIS без пароля.
// Даты хранятся в UTC (datetime2) и передаются строками ISO — без преобразований часового пояса в драйвере.
import sql from 'msnodesqlv8';
import type { Connection, sqlQueryParamType } from 'msnodesqlv8/types';
import { DEFAULT_DICTIONARIES } from '../src/lib/seed';
import { DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_USERS } from '../src/lib/access';
import { planRows as DEFAULT_PLAN_ROWS, sortedPlanRows } from '../src/lib/data';
import type { Absence, ChatRead, Data, Notice, DictionaryEntry, DocumentTemplate, Entitlement, ManagedUser, Message, Permission, PlanRow, Report, RoleDefinition, Task, Unit } from '../src/lib/types';
import { DEFAULT_UNITS } from '../src/lib/units';
import { DEFAULT_TEMPLATES, templateScope } from '../src/lib/templates';
import type { Repo } from './repo';

const LOCK_RESOURCE = 'task-control';

/** Таблицы и индексы; повторный запуск ничего не меняет. Тот же текст выполняет установщик IIS (db/schema.sql). */
export const SCHEMA = `
if object_id(N'dbo.tc_meta', N'U') is null create table dbo.tc_meta ([key] nvarchar(100) not null primary key, [value] nvarchar(max) not null);
if object_id(N'dbo.tc_tasks', N'U') is null create table dbo.tc_tasks (
  id nvarchar(100) not null primary key,
  seq bigint identity(1,1) not null,
  title nvarchar(300) not null,
  row_id nvarchar(48) null,
  category nvarchar(48) null,
  assignee_ids nvarchar(max) not null check (isjson(assignee_ids) = 1),
  start_at datetime2(3) not null,
  end_at datetime2(3) not null,
  doc_name nvarchar(300) not null default N'',
  doc_number nvarchar(100) not null default N'',
  result nvarchar(max) not null default N'',
  done bit not null default 0,
  score float null,
  done_at datetime2(3) null
);
if object_id(N'dbo.tc_absences', N'U') is null create table dbo.tc_absences (
  id nvarchar(100) not null primary key,
  employee_id int not null,
  [type] nvarchar(20) not null check ([type] in (N'vacation', N'trip', N'dayoff', N'sick', N'study')),
  date_from date not null,
  date_to date null,
  [status] nvarchar(20) not null check ([status] in (N'request', N'approved', N'rejected')),
  note nvarchar(500) not null default N'',
  decided_by int null,
  created_at datetime2(3) not null
);
if not exists (select 1 from sys.indexes where name = N'tc_absences_employee') create index tc_absences_employee on dbo.tc_absences (employee_id, date_from);
if object_id(N'dbo.tc_entitlements', N'U') is null create table dbo.tc_entitlements (
  employee_id int not null,
  [year] int not null,
  vacation_days int not null,
  carried_over int not null default 0,
  dayoff_accrued int not null default 0,
  primary key (employee_id, [year])
);
if object_id(N'dbo.tc_reports', N'U') is null create table dbo.tc_reports (week_start date not null primary key, submitted_at datetime2(3) not null, entries nvarchar(max) not null check (isjson(entries) = 1));
if object_id(N'dbo.tc_messages', N'U') is null create table dbo.tc_messages (id nvarchar(100) not null primary key, author_id int not null, [text] nvarchar(max) not null, sent_at datetime2(3) not null);
if object_id(N'dbo.tc_dictionaries', N'U') is null create table dbo.tc_dictionaries (id nvarchar(100) not null primary key, dictionary nvarchar(40) not null, code nvarchar(48) not null, title nvarchar(160) not null, color nvarchar(7) null);
if not exists (select 1 from sys.indexes where name = N'tc_dictionaries_kind_code') create unique index tc_dictionaries_kind_code on dbo.tc_dictionaries (dictionary, code);
if object_id(N'dbo.tc_plan_rows', N'U') is null create table dbo.tc_plan_rows (id nvarchar(48) not null primary key, title nvarchar(200) not null, is_header bit not null default 0, base_score float not null default 0);
if object_id(N'dbo.tc_users', N'U') is null create table dbo.tc_users (
  employee_id int not null primary key,
  email nvarchar(200) not null unique,
  [role] nvarchar(20) not null,
  active bit not null default 1,
  windows_login nvarchar(128) not null default N'',
  full_name nvarchar(200) not null default N'',
  [position] nvarchar(200) not null default N'',
  unit_id nvarchar(100) null
);
if not exists (select 1 from sys.indexes where name = N'tc_users_windows_login') create unique index tc_users_windows_login on dbo.tc_users (windows_login) where windows_login <> N'';
if object_id(N'dbo.tc_units', N'U') is null create table dbo.tc_units (id nvarchar(100) not null primary key, parent_id nvarchar(100) null, kind nvarchar(20) not null, [name] nvarchar(200) not null);
if object_id(N'dbo.tc_templates', N'U') is null create table dbo.tc_templates (id nvarchar(100) not null primary key, [name] nvarchar(160) not null, body nvarchar(max) not null, scope nvarchar(20) null);
if object_id(N'dbo.tc_chat_reads', N'U') is null create table dbo.tc_chat_reads (employee_id int not null primary key, read_at datetime2(3) not null);
if object_id(N'dbo.tc_notices', N'U') is null create table dbo.tc_notices (id nvarchar(100) not null primary key, [at] datetime2(3) not null, recipients nvarchar(max) not null check (isjson(recipients) = 1), title nvarchar(300) not null, body nvarchar(max) not null, url nvarchar(500) not null);
if not exists (select 1 from sys.indexes where name = N'tc_notices_at') create index tc_notices_at on dbo.tc_notices ([at]);
if object_id(N'dbo.tc_roles', N'U') is null create table dbo.tc_roles ([role] nvarchar(20) not null primary key, [name] nvarchar(100) not null, permissions nvarchar(max) not null check (isjson(permissions) = 1));
`;

type Row = Record<string, any>;
type Q = { query: (text: string, params?: unknown[]) => Promise<Row[]> };

/** Метка времени UTC из datetime2 (строка стиля 126 без зоны) — в ISO. */
const iso = (v: string | null) => (v === null ? null : new Date(`${v}Z`).toISOString());
/** Выражения выборки: даты — строками, без участия драйвера. */
const ts = (col: string) => `convert(varchar(33), ${col}, 126) as ${col}`;
const day = (col: string) => `convert(char(10), ${col}, 23) as ${col}`;

const readAll = async (q: Q): Promise<Data | null> => {
  const meta = new Map((await q.query('select [key], [value] from dbo.tc_meta')).map((r) => [r.key as string, r.value as string]));
  if (!meta.has('seeded')) return null;
  const units = await q.query('select * from dbo.tc_units order by id');
  const templates = await q.query('select * from dbo.tc_templates order by [name], id');
  const tasks = await q.query(`select id, title, row_id, category, assignee_ids, ${ts('start_at')}, ${ts('end_at')}, doc_name, doc_number, result, done, score, ${ts('done_at')} from dbo.tc_tasks order by seq`);
  const absences = await q.query(`select id, employee_id, [type], ${day('date_from')}, ${day('date_to')}, [status], note, decided_by, ${ts('created_at')} from dbo.tc_absences order by date_from, id`);
  const entitlements = await q.query('select * from dbo.tc_entitlements order by [year], employee_id');
  const reports = await q.query(`select ${day('week_start')}, ${ts('submitted_at')}, entries from dbo.tc_reports order by week_start`);
  const messages = await q.query(`select id, author_id, [text], ${ts('sent_at')} from dbo.tc_messages order by sent_at, id`);
  const chatReads = await q.query(`select employee_id, ${ts('read_at')} from dbo.tc_chat_reads order by employee_id`);
  const notices = await q.query(`select id, ${ts('at')}, recipients, title, body, url from dbo.tc_notices order by [at], id`);
  const dictionaries = await q.query('select * from dbo.tc_dictionaries order by dictionary, title, id');
  const storedPlanRows = await q.query('select * from dbo.tc_plan_rows order by id');
  const users = await q.query('select * from dbo.tc_users order by employee_id');
  const roles = await q.query('select * from dbo.tc_roles order by [role]');
  const accessReady = meta.has('access-ready');
  const storedRoles: RoleDefinition[] = accessReady ? roles.map((r): RoleDefinition => ({ role: r.role, name: r.name, permissions: JSON.parse(r.permissions) })) : DEFAULT_ROLES;
  const migratedRoles = meta.get('access-version') === '2' ? storedRoles : storedRoles.map((role): RoleDefinition => role.role === 'administrator' && !role.permissions.includes('authentication.manage') ? { ...role, permissions: [...role.permissions, 'authentication.manage' as Permission] } : role);
  const authentication = meta.get('authentication-settings');
  return {
    tasks: tasks.map(
      (r): Task => ({
        id: r.id,
        title: r.title,
        rowId: r.row_id,
        category: r.category,
        assigneeIds: JSON.parse(r.assignee_ids),
        start: iso(r.start_at)!,
        end: iso(r.end_at)!,
        docName: r.doc_name,
        docNumber: r.doc_number,
        result: r.result,
        done: r.done,
        score: r.score,
        doneAt: iso(r.done_at),
      }),
    ),
    absences: absences.map(
      (r): Absence => ({
        id: r.id,
        employeeId: r.employee_id,
        type: r.type,
        from: r.date_from,
        to: r.date_to,
        status: r.status,
        note: r.note,
        decidedBy: r.decided_by,
        createdAt: iso(r.created_at)!,
      }),
    ),
    entitlements: entitlements.map(
      (r): Entitlement => ({
        employeeId: r.employee_id,
        year: r.year,
        vacationDays: r.vacation_days,
        carriedOver: r.carried_over,
        dayoffAccrued: r.dayoff_accrued,
      }),
    ),
    reports: reports.map((r): Report => ({ weekStart: r.week_start, submittedAt: iso(r.submitted_at)!, entries: JSON.parse(r.entries) })),
    messages: messages.map((r): Message => ({ id: r.id, authorId: r.author_id, text: r.text, sentAt: iso(r.sent_at)! })),
    chatReads: chatReads.map((r): ChatRead => ({ employeeId: r.employee_id, readAt: iso(r.read_at)! })),
    notices: notices.map((r): Notice => ({ id: r.id, at: iso(r.at)!, to: JSON.parse(r.recipients), title: r.title, body: r.body, url: r.url })),
    dictionaries: meta.has('dictionaries-ready')
      ? dictionaries.map((r): DictionaryEntry => ({ id: r.id, dictionary: r.dictionary, code: r.code, title: r.title, ...(r.color ? { color: r.color } : {}) }))
      : DEFAULT_DICTIONARIES,
    planRows: meta.has('plan-rows-ready')
      ? sortedPlanRows(storedPlanRows.map((r): PlanRow => ({ id: r.id, title: r.title, isHeader: r.is_header, baseScore: Number(r.base_score) })))
      : DEFAULT_PLAN_ROWS.map((row) => ({ ...row })),
    users: accessReady ? users.map((r): ManagedUser => ({ employeeId: r.employee_id, email: r.email, fullName: r.full_name, position: r.position, windowsLogin: r.windows_login || r.email.split('@')[0], role: r.role, active: r.active, ...(r.unit_id ? { unitId: r.unit_id } : {}) })) : DEFAULT_USERS,
    templates: meta.has('templates-ready') ? templates.map((r): DocumentTemplate => ({ id: r.id, name: r.name, body: r.body, scope: templateScope({ id: r.id, scope: r.scope }) })) : DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    units: meta.has('units-ready') ? units.map((r): Unit => ({ id: r.id, parentId: r.parent_id, kind: r.kind, name: r.name })) : DEFAULT_UNITS.map((u) => ({ ...u })),
    roles: migratedRoles,
    authentication: authentication ? JSON.parse(authentication) : { ...DEFAULT_AUTHENTICATION },
  };
};

/** Столбец: имя, тип переменной T-SQL и значение из объекта. Тип 'ts' — метка времени ISO → datetime2(3) в UTC. */
type Col<T> = [name: string, type: string, get: (x: T) => unknown];

type Table<T> = {
  key: (x: T) => string;
  upsert: (q: Q, x: T) => Promise<unknown>;
  remove: (q: Q, x: T) => Promise<unknown>;
};

const quote = (name: string) => `[${name}]`;

/** Обновление по ключу, при отсутствии строки — вставка (под блокировкой транзакции гонки нет). */
const table = <T>(name: string, keys: string[], cols: Col<T>[], opts: { insertOnly?: string[] } = {}): Table<T> => {
  const declare = cols
    .map(([col, type]) =>
      type === 'ts'
        ? `@${col} datetime2(3) = cast(switchoffset(cast(? as datetimeoffset(3)), '+00:00') as datetime2(3))`
        : `@${col} ${type} = ?`,
    )
    .join(', ');
  const where = keys.map((k) => `${quote(k)} = @${k}`).join(' and ');
  const updatable = cols.filter(([col]) => !keys.includes(col) && !opts.insertOnly?.includes(col));
  const upsertSql = `declare ${declare};
update dbo.${name} set ${updatable.map(([col]) => `${quote(col)} = @${col}`).join(', ')} where ${where};
if @@rowcount = 0 insert into dbo.${name} (${cols.map(([col]) => quote(col)).join(', ')}) values (${cols.map(([col]) => `@${col}`).join(', ')});`;
  const keyCols = keys.map((k) => cols.find(([col]) => col === k)!);
  const removeSql = `delete from dbo.${name} where ${keys.map((k) => `${quote(k)} = ?`).join(' and ')}`;
  return {
    key: (x) => keyCols.map(([, , get]) => String(get(x))).join('|'),
    upsert: (q, x) => q.query(upsertSql, cols.map(([, , get]) => get(x) ?? null)),
    remove: (q, x) => q.query(removeSql, keyCols.map(([, , get]) => get(x))),
  };
};

const TASKS = table<Task>('tc_tasks', ['id'], [
  ['id', 'nvarchar(100)', (t) => t.id],
  ['title', 'nvarchar(300)', (t) => t.title],
  ['row_id', 'nvarchar(48)', (t) => t.rowId],
  ['category', 'nvarchar(48)', (t) => t.category],
  ['assignee_ids', 'nvarchar(max)', (t) => JSON.stringify(t.assigneeIds)],
  ['start_at', 'ts', (t) => t.start],
  ['end_at', 'ts', (t) => t.end],
  ['doc_name', 'nvarchar(300)', (t) => t.docName],
  ['doc_number', 'nvarchar(100)', (t) => t.docNumber],
  ['result', 'nvarchar(max)', (t) => t.result],
  ['done', 'bit', (t) => t.done],
  ['score', 'float', (t) => t.score],
  ['done_at', 'ts', (t) => t.doneAt],
]);

const ABSENCES = table<Absence>('tc_absences', ['id'], [
  ['id', 'nvarchar(100)', (a) => a.id],
  ['employee_id', 'int', (a) => a.employeeId],
  ['type', 'nvarchar(20)', (a) => a.type],
  ['date_from', 'date', (a) => a.from],
  ['date_to', 'date', (a) => a.to],
  ['status', 'nvarchar(20)', (a) => a.status],
  ['note', 'nvarchar(500)', (a) => a.note],
  ['decided_by', 'int', (a) => a.decidedBy],
  ['created_at', 'ts', (a) => a.createdAt],
], { insertOnly: ['created_at'] });

const ENTITLEMENTS = table<Entitlement>('tc_entitlements', ['employee_id', 'year'], [
  ['employee_id', 'int', (e) => e.employeeId],
  ['year', 'int', (e) => e.year],
  ['vacation_days', 'int', (e) => e.vacationDays],
  ['carried_over', 'int', (e) => e.carriedOver],
  ['dayoff_accrued', 'int', (e) => e.dayoffAccrued],
]);

const REPORTS = table<Report>('tc_reports', ['week_start'], [
  ['week_start', 'date', (r) => r.weekStart],
  ['submitted_at', 'ts', (r) => r.submittedAt],
  ['entries', 'nvarchar(max)', (r) => JSON.stringify(r.entries)],
]);

const MESSAGES = table<Message>('tc_messages', ['id'], [
  ['id', 'nvarchar(100)', (m) => m.id],
  ['author_id', 'int', (m) => m.authorId],
  ['text', 'nvarchar(max)', (m) => m.text],
  ['sent_at', 'ts', (m) => m.sentAt],
], { insertOnly: ['author_id', 'sent_at'] });

const CHAT_READS = table<ChatRead>('tc_chat_reads', ['employee_id'], [
  ['employee_id', 'int', (r) => r.employeeId],
  ['read_at', 'ts', (r) => r.readAt],
]);

const NOTICES = table<Notice>('tc_notices', ['id'], [
  ['id', 'nvarchar(100)', (n) => n.id],
  ['at', 'ts', (n) => n.at],
  ['recipients', 'nvarchar(max)', (n) => JSON.stringify(n.to)],
  ['title', 'nvarchar(300)', (n) => n.title],
  ['body', 'nvarchar(max)', (n) => n.body],
  ['url', 'nvarchar(500)', (n) => n.url],
]);

const DICTIONARIES = table<DictionaryEntry>('tc_dictionaries', ['id'], [
  ['id', 'nvarchar(100)', (e) => e.id],
  ['dictionary', 'nvarchar(40)', (e) => e.dictionary],
  ['code', 'nvarchar(48)', (e) => e.code],
  ['title', 'nvarchar(160)', (e) => e.title],
  ['color', 'nvarchar(7)', (e) => e.color],
]);

const PLAN_ROWS = table<PlanRow>('tc_plan_rows', ['id'], [
  ['id', 'nvarchar(48)', (r) => r.id],
  ['title', 'nvarchar(200)', (r) => r.title],
  ['is_header', 'bit', (r) => r.isHeader],
  ['base_score', 'float', (r) => r.baseScore],
]);

const USERS = table<ManagedUser>('tc_users', ['employee_id'], [
  ['employee_id', 'int', (u) => u.employeeId],
  ['email', 'nvarchar(200)', (u) => u.email],
  ['full_name', 'nvarchar(200)', (u) => u.fullName],
  ['position', 'nvarchar(200)', (u) => u.position],
  ['windows_login', 'nvarchar(128)', (u) => u.windowsLogin],
  ['role', 'nvarchar(20)', (u) => u.role],
  ['active', 'bit', (u) => u.active],
  ['unit_id', 'nvarchar(100)', (u) => u.unitId],
]);

const UNITS = table<Unit>('tc_units', ['id'], [
  ['id', 'nvarchar(100)', (u) => u.id],
  ['parent_id', 'nvarchar(100)', (u) => u.parentId],
  ['kind', 'nvarchar(20)', (u) => u.kind],
  ['name', 'nvarchar(200)', (u) => u.name],
]);

const TEMPLATES = table<DocumentTemplate>('tc_templates', ['id'], [
  ['id', 'nvarchar(100)', (t) => t.id],
  ['name', 'nvarchar(160)', (t) => t.name],
  ['body', 'nvarchar(max)', (t) => t.body],
  ['scope', 'nvarchar(20)', (t) => t.scope],
]);

const ROLES = table<RoleDefinition>('tc_roles', ['role'], [
  ['role', 'nvarchar(20)', (r) => r.role],
  ['name', 'nvarchar(100)', (r) => r.name],
  ['permissions', 'nvarchar(max)', (r) => JSON.stringify(r.permissions)],
]);

/** Сравнение без учёта порядка ключей объектов. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Записывает только добавленные, изменённые и удалённые записи. Удаление — первым, чтобы освободить уникальные значения. */
const sync = async <T>(q: Q, t: Table<T>, before: T[], after: T[]) => {
  const next = new Set(after.map(t.key));
  for (const x of before) if (!next.has(t.key(x))) await t.remove(q, x);
  const old = new Map(before.map((x) => [t.key(x), stable(x)]));
  for (const x of after) if (old.get(t.key(x)) !== stable(x)) await t.upsert(q, x);
};

/** Запись в tc_meta; overwrite = false — только если ключа ещё нет. */
const setMeta = (q: Q, key: string, value: string, overwrite = true) =>
  q.query(
    `declare @k nvarchar(100) = ?, @v nvarchar(max) = ?;
     ${overwrite ? 'update dbo.tc_meta set [value] = @v where [key] = @k; if @@rowcount = 0' : 'if not exists (select 1 from dbo.tc_meta where [key] = @k)'}
       insert into dbo.tc_meta ([key], [value]) values (@k, @v);`,
    [key, value],
  );

/** Небольшой пул соединений: чтения идут параллельно, транзакция занимает соединение целиком. */
const createPool = (connectionString: string, max: number) => {
  const idle: Connection[] = [];
  const all = new Set<Connection>();
  const acquire = async (): Promise<Connection> => idle.pop() ?? (await sql.promises.open(connectionString).then((c) => (all.add(c), c)));
  const drop = (c: Connection) => {
    all.delete(c);
    void c.promises.close().catch(() => undefined);
  };
  const release = (c: Connection, broken = false) => {
    if (broken || idle.length >= max) drop(c);
    else idle.push(c);
  };
  const wrap = (c: Connection): Q => ({
    query: async (text, params = []) => (await c.promises.query(text, params as sqlQueryParamType[])).first ?? [],
  });
  return {
    async use<T>(fn: (q: Q, c: Connection) => Promise<T>): Promise<T> {
      const c = await acquire();
      let broken = false;
      try {
        return await fn(wrap(c), c);
      } catch (e) {
        // Ошибка связи (SQLSTATE 08xxx) — соединение больше не используем; ошибка в запросе его не портит.
        broken = !!(e as { sqlstate?: string }).sqlstate?.startsWith('08');
        throw e;
      } finally {
        release(c, broken);
      }
    },
    async end() {
      idle.length = 0;
      await Promise.all([...all].map((c) => c.promises.close().catch(() => undefined)));
      all.clear();
    },
  };
};

export const createMssqlRepo = (connectionString: string, opts: { max?: number } = {}): Repo => {
  const pool = createPool(connectionString, opts.max ?? 4);
  let ready: Promise<unknown> | null = null;
  const ensureSchema = () => (ready ??= pool.use((q) => q.query(SCHEMA)).catch((e) => ((ready = null), Promise.reject(e))));
  // Изменения процесса — по очереди: драйвер выполняет запросы в потоках libuv (их 4), и транзакции,
  // ждущие sp_getapplock, заняли бы все потоки, не дав держателю блокировки завершиться.
  // Блокировка в SQL Server остаётся для нескольких процессов (перезапуск пула IIS с перекрытием).
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };

  return {
    kind: 'sqlserver',
    close: () => pool.end(),
    async read() {
      await ensureSchema();
      return pool.use((q) => readAll(q));
    },
    async update(fn) {
      await ensureSchema();
      return serial(() => pool.use(async (q, c) => {
        await c.promises.beginTransaction();
        try {
          const [lock] = await q.query(
            `declare @r int; exec @r = sp_getapplock @Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000; select @r as r`,
            [LOCK_RESOURCE],
          );
          if (!lock || lock.r < 0) throw new Error('SQL Server: не удалось получить блокировку данных за 30 секунд.');
          const meta = new Map((await q.query('select [key], [value] from dbo.tc_meta')).map((r) => [r.key as string, r.value as string]));
          const current = await readAll(q);
          const next = fn(current);
          const empty: Data = { tasks: [], absences: [], entitlements: [], reports: [], messages: [], chatReads: [], planRows: DEFAULT_PLAN_ROWS.map((row) => ({ ...row })), dictionaries: DEFAULT_DICTIONARIES, users: DEFAULT_USERS, roles: DEFAULT_ROLES, units: DEFAULT_UNITS, templates: DEFAULT_TEMPLATES, authentication: { ...DEFAULT_AUTHENTICATION } };
          const before = current ?? empty;
          // Пока таблица ни разу не записывалась, чтение подставляет значения по умолчанию.
          // Сравнивать с ними нельзя: иначе значения по умолчанию сочтутся уже сохранёнными и не попадут в базу.
          const baseline: Data = {
            ...before,
            dictionaries: meta.has('dictionaries-ready') ? before.dictionaries : [],
            planRows: meta.has('plan-rows-ready') ? before.planRows : [],
            users: meta.has('access-ready') ? before.users : [],
            roles: meta.has('access-ready') ? before.roles : [],
            units: meta.has('units-ready') ? before.units : [],
            templates: meta.has('templates-ready') ? before.templates : [],
          };
          await sync(q, TASKS, before.tasks, next.tasks);
          await sync(q, ABSENCES, before.absences, next.absences);
          await sync(q, ENTITLEMENTS, before.entitlements, next.entitlements);
          await sync(q, REPORTS, before.reports, next.reports);
          await sync(q, MESSAGES, before.messages, next.messages);
          await sync(q, CHAT_READS, before.chatReads ?? [], next.chatReads ?? []);
          // Журнал уведомлений пишется, только если его передали (правки без него журнал не трогают).
          if (next.notices) await sync(q, NOTICES, before.notices ?? [], next.notices);
          await sync(q, DICTIONARIES, baseline.dictionaries, next.dictionaries);
          await sync(q, PLAN_ROWS, baseline.planRows ?? [], next.planRows ?? DEFAULT_PLAN_ROWS);
          await sync(q, USERS, baseline.users, next.users);
          await sync(q, ROLES, baseline.roles, next.roles);
          await sync(q, UNITS, baseline.units ?? [], next.units ?? DEFAULT_UNITS);
          await sync(q, TEMPLATES, baseline.templates ?? [], next.templates ?? DEFAULT_TEMPLATES);
          if (meta.get('access-version') !== '2') {
            for (const role of next.roles) await ROLES.upsert(q, role);
            await setMeta(q, 'access-version', '2');
          }
          if (stable(before.authentication) !== stable(next.authentication)) await setMeta(q, 'authentication-settings', JSON.stringify(next.authentication));
          const stamp = new Date().toISOString();
          await setMeta(q, 'seeded', stamp, false);
          for (const key of ['dictionaries-ready', 'plan-rows-ready', 'access-ready', 'units-ready', 'templates-ready']) await setMeta(q, key, stamp);
          await c.promises.commit();
          return next;
        } catch (e) {
          await c.promises.rollback().catch(() => undefined);
          throw e;
        }
      }));
    },
  };
};
