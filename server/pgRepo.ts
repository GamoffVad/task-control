// Хранилище в PostgreSQL (Neon). Каждая сущность — своя таблица; изменения пишутся в транзакции
// под общей блокировкой, поэтому одновременные правки разных пользователей не теряются.
import pg from 'pg';
import { DEFAULT_DICTIONARIES } from '../src/lib/seed';
import { ACCESS_VERSION, DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_SCORING, DEFAULT_USERS, withAddedPermissions } from '../src/lib/access';
import { planRows as DEFAULT_PLAN_ROWS, sortedPlanRows } from '../src/lib/data';
import type { Absence, ChatRead, Data, Notice, DictionaryEntry, DocumentTemplate, Entitlement, ManagedUser, Message, PlanRow, Report, RoleDefinition, Task, Unit } from '../src/lib/types';
import { DEFAULT_UNITS } from '../src/lib/units';
import { DEFAULT_TEMPLATES, templateScope } from '../src/lib/templates';
import type { Repo } from './repo';

// DATE — строкой YYYY-MM-DD (без сдвига часового пояса), NUMERIC — числом.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => parseFloat(v));

const LOCK_KEY = 724001;

export const SCHEMA = `
create table if not exists tc_meta (key text primary key, value text not null);
create table if not exists tc_tasks (
  id text primary key,
  seq bigint generated always as identity,
  title text not null,
  row_id text,
  category text,
  assignee_ids integer[] not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  doc_name text not null default '',
  doc_number text not null default '',
  result text not null default '',
  done boolean not null default false,
  score numeric,
  done_at timestamptz
);
create table if not exists tc_absences (
  id text primary key,
  employee_id integer not null,
  type text not null check (type in ('vacation','trip','dayoff','sick','study')),
  date_from date not null,
  date_to date,
  status text not null check (status in ('request','approved','rejected')),
  note text not null default '',
  decided_by integer,
  created_at timestamptz not null
);
create index if not exists tc_absences_employee on tc_absences (employee_id, date_from);
create table if not exists tc_entitlements (
  employee_id integer not null,
  year integer not null,
  vacation_days integer not null,
  carried_over integer not null default 0,
  dayoff_accrued integer not null default 0,
  primary key (employee_id, year)
);
create table if not exists tc_reports (week_start date primary key, submitted_at timestamptz not null, entries jsonb not null);
create table if not exists tc_messages (id text primary key, author_id integer not null, text text not null, sent_at timestamptz not null);
create table if not exists tc_dictionaries (id text primary key, dictionary text not null, code text not null, title text not null);
create unique index if not exists tc_dictionaries_kind_code on tc_dictionaries (dictionary, lower(code));
alter table tc_dictionaries add column if not exists color text;
create table if not exists tc_plan_rows (id text primary key, title text not null, is_header boolean not null default false, base_score numeric not null default 0);
create table if not exists tc_users (employee_id integer primary key, email text not null unique, role text not null, active boolean not null default true);
alter table tc_users add column if not exists windows_login text not null default '';
alter table tc_users add column if not exists full_name text not null default '';
alter table tc_users add column if not exists position text not null default '';
alter table tc_users add column if not exists unit_id text;
create table if not exists tc_units (id text primary key, parent_id text, kind text not null, name text not null);
create table if not exists tc_templates (id text primary key, name text not null, body text not null);
alter table tc_templates add column if not exists scope text;
create table if not exists tc_chat_reads (employee_id integer primary key, read_at timestamptz not null);
create table if not exists tc_notices (id text primary key, at timestamptz not null, recipients jsonb not null, title text not null, body text not null, url text not null);
create index if not exists tc_notices_at on tc_notices (at);
create unique index if not exists tc_users_windows_login on tc_users (lower(windows_login)) where windows_login <> '';
create table if not exists tc_roles (role text primary key, name text not null, permissions jsonb not null);
`;

type Q = pg.PoolClient | pg.Pool;

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());

const readAll = async (q: Q): Promise<Data | null> => {
  const seeded = await q.query(`select value from tc_meta where key = 'seeded'`);
  if (!seeded.rowCount) return null;
  const dictionariesReady = await q.query(`select value from tc_meta where key = 'dictionaries-ready'`);
  const planRowsReady = await q.query(`select value from tc_meta where key = 'plan-rows-ready'`);
  const unitsReady = await q.query(`select value from tc_meta where key = 'units-ready'`);
  const units = await q.query('select * from tc_units order by id');
  const templatesReady = await q.query(`select value from tc_meta where key = 'templates-ready'`);
  const templates = await q.query('select * from tc_templates order by name, id');
  const accessReady = await q.query(`select value from tc_meta where key = 'access-ready'`);
  const accessVersion = await q.query(`select value from tc_meta where key = 'access-version'`);
  const authentication = await q.query(`select value from tc_meta where key = 'authentication-settings'`);
  const scoring = await q.query(`select value from tc_meta where key = 'scoring-settings'`);
  const tasks = await q.query('select * from tc_tasks order by seq');
  const absences = await q.query('select * from tc_absences order by date_from, id');
  const entitlements = await q.query('select * from tc_entitlements order by year, employee_id');
  const reports = await q.query('select * from tc_reports order by week_start');
  const messages = await q.query('select * from tc_messages order by sent_at, id');
  const chatReads = await q.query('select * from tc_chat_reads order by employee_id');
  const notices = await q.query('select * from tc_notices order by at, id');
  const dictionaries = await q.query('select * from tc_dictionaries order by dictionary, title, id');
  const storedPlanRows = await q.query('select * from tc_plan_rows order by id');
  const users = await q.query('select * from tc_users order by employee_id');
  const roles = await q.query('select * from tc_roles order by role');
  const storedRoles: RoleDefinition[] = accessReady.rowCount ? roles.rows.map((r): RoleDefinition => ({ role: r.role, name: r.name, permissions: r.permissions })) : DEFAULT_ROLES;
  const migratedRoles = accessVersion.rows[0]?.value === ACCESS_VERSION ? storedRoles : withAddedPermissions(storedRoles);
  return {
    tasks: tasks.rows.map(
      (r): Task => ({
        id: r.id,
        title: r.title,
        rowId: r.row_id,
        category: r.category,
        assigneeIds: r.assignee_ids,
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
    absences: absences.rows.map(
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
    entitlements: entitlements.rows.map(
      (r): Entitlement => ({
        employeeId: r.employee_id,
        year: r.year,
        vacationDays: r.vacation_days,
        carriedOver: r.carried_over,
        dayoffAccrued: r.dayoff_accrued,
      }),
    ),
    reports: reports.rows.map((r): Report => ({ weekStart: r.week_start, submittedAt: iso(r.submitted_at)!, entries: r.entries })),
    messages: messages.rows.map((r): Message => ({ id: r.id, authorId: r.author_id, text: r.text, sentAt: iso(r.sent_at)! })),
    chatReads: chatReads.rows.map((r): ChatRead => ({ employeeId: r.employee_id, readAt: iso(r.read_at)! })),
    notices: notices.rows.map((r): Notice => ({ id: r.id, at: iso(r.at)!, to: r.recipients, title: r.title, body: r.body, url: r.url })),
    dictionaries: dictionariesReady.rowCount
      ? dictionaries.rows.map((r): DictionaryEntry => ({ id: r.id, dictionary: r.dictionary, code: r.code, title: r.title, ...(r.color ? { color: r.color } : {}) }))
      : DEFAULT_DICTIONARIES,
    planRows: planRowsReady.rowCount
      ? sortedPlanRows(storedPlanRows.rows.map((r): PlanRow => ({ id: r.id, title: r.title, isHeader: r.is_header, baseScore: r.base_score })))
      : DEFAULT_PLAN_ROWS.map((row) => ({ ...row })),
    users: accessReady.rowCount ? users.rows.map((r): ManagedUser => ({ employeeId: r.employee_id, email: r.email, fullName: r.full_name, position: r.position, windowsLogin: r.windows_login || r.email.split('@')[0], role: r.role, active: r.active, ...(r.unit_id ? { unitId: r.unit_id } : {}) })) : DEFAULT_USERS,
    templates: templatesReady.rowCount ? templates.rows.map((r): DocumentTemplate => ({ id: r.id, name: r.name, body: r.body, scope: templateScope({ id: r.id, scope: r.scope }) })) : DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    units: unitsReady.rowCount ? units.rows.map((r): Unit => ({ id: r.id, parentId: r.parent_id, kind: r.kind, name: r.name })) : DEFAULT_UNITS.map((u) => ({ ...u })),
    roles: migratedRoles,
    authentication: authentication.rowCount ? JSON.parse(authentication.rows[0].value) : { ...DEFAULT_AUTHENTICATION },
    scoring: scoring.rowCount ? JSON.parse(scoring.rows[0].value) : { ...DEFAULT_SCORING },
    // Отметка версии прав: без неё общий код дописывал бы их администратору при каждом чтении.
    ...(accessVersion.rowCount ? { accessVersion: accessVersion.rows[0].value as string } : {}),
  };
};

type Table<T> = {
  key: (x: T) => string;
  upsert: (q: Q, x: T) => Promise<unknown>;
  remove: (q: Q, x: T) => Promise<unknown>;
};

const TASKS: Table<Task> = {
  key: (t) => t.id,
  upsert: (q, t) =>
    q.query(
      `insert into tc_tasks (id, title, row_id, category, assignee_ids, start_at, end_at, doc_name, doc_number, result, done, score, done_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set title=$2, row_id=$3, category=$4, assignee_ids=$5, start_at=$6, end_at=$7,
         doc_name=$8, doc_number=$9, result=$10, done=$11, score=$12, done_at=$13`,
      [t.id, t.title, t.rowId, t.category, t.assigneeIds, t.start, t.end, t.docName, t.docNumber, t.result, t.done, t.score, t.doneAt],
    ),
  remove: (q, t) => q.query('delete from tc_tasks where id = $1', [t.id]),
};

const ABSENCES: Table<Absence> = {
  key: (a) => a.id,
  upsert: (q, a) =>
    q.query(
      `insert into tc_absences (id, employee_id, type, date_from, date_to, status, note, decided_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set employee_id=$2, type=$3, date_from=$4, date_to=$5, status=$6, note=$7, decided_by=$8`,
      [a.id, a.employeeId, a.type, a.from, a.to, a.status, a.note, a.decidedBy, a.createdAt],
    ),
  remove: (q, a) => q.query('delete from tc_absences where id = $1', [a.id]),
};

const ENTITLEMENTS: Table<Entitlement> = {
  key: (e) => `${e.employeeId}|${e.year}`,
  upsert: (q, e) =>
    q.query(
      `insert into tc_entitlements (employee_id, year, vacation_days, carried_over, dayoff_accrued) values ($1,$2,$3,$4,$5)
       on conflict (employee_id, year) do update set vacation_days=$3, carried_over=$4, dayoff_accrued=$5`,
      [e.employeeId, e.year, e.vacationDays, e.carriedOver, e.dayoffAccrued],
    ),
  remove: (q, e) => q.query('delete from tc_entitlements where employee_id = $1 and year = $2', [e.employeeId, e.year]),
};

const REPORTS: Table<Report> = {
  key: (r) => r.weekStart,
  upsert: (q, r) =>
    q.query(
      `insert into tc_reports (week_start, submitted_at, entries) values ($1,$2,$3)
       on conflict (week_start) do update set submitted_at=$2, entries=$3`,
      [r.weekStart, r.submittedAt, JSON.stringify(r.entries)],
    ),
  remove: (q, r) => q.query('delete from tc_reports where week_start = $1', [r.weekStart]),
};

const MESSAGES: Table<Message> = {
  key: (m) => m.id,
  upsert: (q, m) =>
    q.query(
      `insert into tc_messages (id, author_id, text, sent_at) values ($1,$2,$3,$4)
       on conflict (id) do update set text=$3`,
      [m.id, m.authorId, m.text, m.sentAt],
    ),
  remove: (q, m) => q.query('delete from tc_messages where id = $1', [m.id]),
};

const CHAT_READS: Table<ChatRead> = {
  key: (r) => String(r.employeeId),
  upsert: (q, r) =>
    q.query(
      `insert into tc_chat_reads (employee_id, read_at) values ($1,$2)
       on conflict (employee_id) do update set read_at=$2`,
      [r.employeeId, r.readAt],
    ),
  remove: (q, r) => q.query('delete from tc_chat_reads where employee_id = $1', [r.employeeId]),
};

const NOTICES: Table<Notice> = {
  key: (n) => n.id,
  upsert: (q, n) =>
    q.query(
      `insert into tc_notices (id, at, recipients, title, body, url) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set at=$2, recipients=$3, title=$4, body=$5, url=$6`,
      [n.id, n.at, JSON.stringify(n.to), n.title, n.body, n.url],
    ),
  remove: (q, n) => q.query('delete from tc_notices where id = $1', [n.id]),
};

const DICTIONARIES: Table<DictionaryEntry> = {
  key: (entry) => entry.id,
  upsert: (q, entry) =>
    q.query(
      `insert into tc_dictionaries (id, dictionary, code, title, color) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set dictionary=$2, code=$3, title=$4, color=$5`,
      [entry.id, entry.dictionary, entry.code, entry.title, entry.color ?? null],
    ),
  remove: (q, entry) => q.query('delete from tc_dictionaries where id = $1', [entry.id]),
};

const PLAN_ROWS: Table<PlanRow> = {
  key: (row) => row.id,
  upsert: (q, row) => q.query(
    `insert into tc_plan_rows (id, title, is_header, base_score) values ($1,$2,$3,$4)
     on conflict (id) do update set title=$2, is_header=$3, base_score=$4`,
    [row.id, row.title, row.isHeader, row.baseScore],
  ),
  remove: (q, row) => q.query('delete from tc_plan_rows where id = $1', [row.id]),
};

const USERS: Table<ManagedUser> = {
  key: (user) => String(user.employeeId),
  upsert: (q, user) => q.query(
    `insert into tc_users (employee_id, email, full_name, position, windows_login, role, active, unit_id) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (employee_id) do update set email=$2, full_name=$3, position=$4, windows_login=$5, role=$6, active=$7, unit_id=$8`,
    [user.employeeId, user.email, user.fullName, user.position, user.windowsLogin, user.role, user.active, user.unitId ?? null],
  ),
  remove: (q, user) => q.query('delete from tc_users where employee_id = $1', [user.employeeId]),
};

const UNITS: Table<Unit> = {
  key: (unit) => unit.id,
  upsert: (q, unit) => q.query(
    `insert into tc_units (id, parent_id, kind, name) values ($1,$2,$3,$4)
     on conflict (id) do update set parent_id=$2, kind=$3, name=$4`,
    [unit.id, unit.parentId, unit.kind, unit.name],
  ),
  remove: (q, unit) => q.query('delete from tc_units where id = $1', [unit.id]),
};

const TEMPLATES: Table<DocumentTemplate> = {
  key: (t) => t.id,
  upsert: (q, t) => q.query(
    `insert into tc_templates (id, name, body, scope) values ($1,$2,$3,$4)
     on conflict (id) do update set name=$2, body=$3, scope=$4`,
    [t.id, t.name, t.body, t.scope],
  ),
  remove: (q, t) => q.query('delete from tc_templates where id = $1', [t.id]),
};

const ROLES: Table<RoleDefinition> = {
  key: (role) => role.role,
  upsert: (q, role) => q.query(
    `insert into tc_roles (role, name, permissions) values ($1,$2,$3)
     on conflict (role) do update set name=$2, permissions=$3`,
    [role.role, role.name, JSON.stringify(role.permissions)],
  ),
  remove: (q, role) => q.query('delete from tc_roles where role = $1', [role.role]),
};

/** Сравнение без учёта порядка ключей: jsonb возвращает объекты с переставленными ключами. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Записывает только добавленные, изменённые и удалённые записи. */
const sync = async <T>(q: Q, table: Table<T>, before: T[], after: T[]) => {
  const old = new Map(before.map((x) => [table.key(x), stable(x)]));
  const seen = new Set<string>();
  for (const x of after) {
    const k = table.key(x);
    seen.add(k);
    if (old.get(k) !== stable(x)) await table.upsert(q, x);
  }
  for (const x of before) if (!seen.has(table.key(x))) await table.remove(q, x);
};

export const createPgRepo = (connectionString: string, opts: { max?: number } = {}): Repo => {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 3, idleTimeoutMillis: 10_000 });
  let ready: Promise<unknown> | null = null;
  const ensureSchema = () => (ready ??= pool.query(SCHEMA).catch((e) => ((ready = null), Promise.reject(e))));

  return {
    kind: 'postgres',
    ping: async () => {
      await ensureSchema();
      await pool.query('select 1');
    },
    close: () => pool.end(),
    async read() {
      await ensureSchema();
      return readAll(pool);
    },
    async update(fn) {
      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
        const accessVersion = await client.query(`select value from tc_meta where key = 'access-version'`);
        const current = await readAll(client);
        const next = fn(current);
        const empty: Data = { tasks: [], absences: [], entitlements: [], reports: [], messages: [], chatReads: [], planRows: DEFAULT_PLAN_ROWS.map((row) => ({ ...row })), dictionaries: DEFAULT_DICTIONARIES, users: DEFAULT_USERS, roles: DEFAULT_ROLES, units: DEFAULT_UNITS, templates: DEFAULT_TEMPLATES, authentication: { ...DEFAULT_AUTHENTICATION }, scoring: { ...DEFAULT_SCORING } };
        const before = current ?? empty;
        // Пока таблица ни разу не записывалась, чтение подставляет значения по умолчанию.
        // Сравнивать с ними нельзя: иначе значения по умолчанию сочтутся уже сохранёнными и не попадут в базу.
        const ready = async (key: string) => (await client.query('select 1 from tc_meta where key = $1', [key])).rowCount;
        const baseline: Data = {
          ...before,
          dictionaries: (await ready('dictionaries-ready')) ? before.dictionaries : [],
          planRows: (await ready('plan-rows-ready')) ? before.planRows : [],
          users: (await ready('access-ready')) ? before.users : [],
          roles: (await ready('access-ready')) ? before.roles : [],
          units: (await ready('units-ready')) ? before.units : [],
          templates: (await ready('templates-ready')) ? before.templates : [],
        };
        await sync(client, TASKS, before.tasks, next.tasks);
        await sync(client, ABSENCES, before.absences, next.absences);
        await sync(client, ENTITLEMENTS, before.entitlements, next.entitlements);
        await sync(client, REPORTS, before.reports, next.reports);
        await sync(client, MESSAGES, before.messages, next.messages);
        await sync(client, CHAT_READS, before.chatReads ?? [], next.chatReads ?? []);
        // Журнал уведомлений пишется, только если его передали (правки без него журнал не трогают).
        if (next.notices) await sync(client, NOTICES, before.notices ?? [], next.notices);
        await sync(client, DICTIONARIES, baseline.dictionaries, next.dictionaries);
        await sync(client, PLAN_ROWS, baseline.planRows ?? [], next.planRows ?? DEFAULT_PLAN_ROWS);
        await sync(client, USERS, baseline.users, next.users);
        await sync(client, ROLES, baseline.roles, next.roles);
        await sync(client, UNITS, baseline.units ?? [], next.units ?? DEFAULT_UNITS);
        await sync(client, TEMPLATES, baseline.templates ?? [], next.templates ?? DEFAULT_TEMPLATES);
        if (accessVersion.rows[0]?.value !== ACCESS_VERSION) {
          for (const role of next.roles) await ROLES.upsert(client, role);
          await client.query(`insert into tc_meta (key, value) values ('access-version', $1) on conflict (key) do update set value = excluded.value`, [ACCESS_VERSION]);
        }
        if (stable(before.scoring ?? DEFAULT_SCORING) !== stable(next.scoring ?? DEFAULT_SCORING)) {
          await client.query(
            `insert into tc_meta (key, value) values ('scoring-settings', $1)
             on conflict (key) do update set value = excluded.value`,
            [JSON.stringify(next.scoring ?? DEFAULT_SCORING)],
          );
        }
        if (stable(before.authentication) !== stable(next.authentication)) {
          await client.query(
            `insert into tc_meta (key, value) values ('authentication-settings', $1)
             on conflict (key) do update set value = excluded.value`,
            [JSON.stringify(next.authentication)],
          );
        }
        await client.query(`insert into tc_meta (key, value) values ('seeded', now()::text) on conflict (key) do nothing`);
        await client.query(`insert into tc_meta (key, value) values ('dictionaries-ready', now()::text) on conflict (key) do update set value = excluded.value`);
        await client.query(`insert into tc_meta (key, value) values ('plan-rows-ready', now()::text) on conflict (key) do update set value = excluded.value`);
        await client.query(`insert into tc_meta (key, value) values ('access-ready', now()::text) on conflict (key) do update set value = excluded.value`);
        await client.query(`insert into tc_meta (key, value) values ('units-ready', now()::text) on conflict (key) do update set value = excluded.value`);
        await client.query(`insert into tc_meta (key, value) values ('templates-ready', now()::text) on conflict (key) do update set value = excluded.value`);
        await client.query('commit');
        return next;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  };
};
