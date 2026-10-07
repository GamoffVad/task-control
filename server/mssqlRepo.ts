// Хранилище в Microsoft SQL Server (2016 и новее, проверено на 2025). База и таблицы создаются
// при первом обращении, поэтому на сервере достаточно учётной записи с правом создавать базы.
// Изменения пишутся в транзакции под общей блокировкой sp_getapplock.
// Вход: MSSQL_USER задан — учётная запись SQL Server (драйвер tedious); не задан — учётная запись Windows,
// под которой работает приложение (пул IIS), через ODBC (драйвер msnodesqlv8), без пароля в настройках.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sql from 'mssql';
import { DEFAULT_DICTIONARIES } from '../src/lib/seed';
import { ACCESS_VERSION, DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_SCORING, DEFAULT_USERS, withAddedPermissions } from '../src/lib/access';
import { planRows as DEFAULT_PLAN_ROWS, sortedPlanRows } from '../src/lib/data';
import type { Absence, ChatRead, Data, Notice, DictionaryEntry, DocumentTemplate, Entitlement, ManagedUser, Message, Permission, PlanRow, Report, RoleDefinition, Task, Unit } from '../src/lib/types';
import { DEFAULT_UNITS } from '../src/lib/units';
import { DEFAULT_TEMPLATES, templateScope } from '../src/lib/templates';
import type { Repo } from './repo';

/** Имя блокировки: одновременные правки разных пользователей выстраиваются в очередь. */
const LOCK = 'task-control';
const LOCK_TIMEOUT_MS = 15_000;

/**
 * Описание таблиц: по нему схема и создаётся, и сверяется. При каждом подключении (а значит, при каждой
 * публикации) недостающие таблицы создаются, а в существующих дописываются недостающие столбцы;
 * существующие строки, столбцы и данные не изменяются и не удаляются.
 */
type Column = {
  name: string;
  /** Тип SQL Server: «nvarchar(64)», «datetimeoffset(3)», «bigint identity(1,1)»… */
  type: string;
  nullable?: boolean;
  /** Значение по умолчанию (выражение SQL) — и для новых строк, и для строк, которые уже есть, когда столбец дописывается. */
  default?: string;
  /** Проверка значения: условие для check-ограничения. */
  check?: string;
};
type SchemaTable = {
  name: string;
  columns: Column[];
  /** Первичный ключ: имена столбцов; с именем ограничения — для составного ключа. */
  primaryKey: string[];
  primaryKeyName?: string;
  /** Уникальные столбцы: имя ограничения → столбец. */
  unique?: Record<string, string>;
  /** Индексы: создаются, если индекса с таким именем ещё нет. */
  indexes?: { name: string; columns: string; unique?: boolean; where?: string }[];
};

const NOW_SQL = 'sysdatetimeoffset()';

export const TABLES: SchemaTable[] = [
  { name: 'tc_meta', primaryKey: ['key'], columns: [{ name: 'key', type: 'nvarchar(64)' }, { name: 'value', type: 'nvarchar(max)', default: "''" }] },
  {
    name: 'tc_tasks',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'seq', type: 'bigint identity(1,1)' },
      { name: 'title', type: 'nvarchar(max)', default: "''" },
      { name: 'row_id', type: 'nvarchar(64)', nullable: true },
      { name: 'category', type: 'nvarchar(64)', nullable: true },
      { name: 'assignee_ids', type: 'nvarchar(max)', default: "'[]'" },
      { name: 'start_at', type: 'datetimeoffset(3)', default: NOW_SQL },
      { name: 'end_at', type: 'datetimeoffset(3)', default: NOW_SQL },
      { name: 'doc_name', type: 'nvarchar(max)', default: "''" },
      { name: 'doc_number', type: 'nvarchar(max)', default: "''" },
      { name: 'result', type: 'nvarchar(max)', default: "''" },
      { name: 'done', type: 'bit', default: '0' },
      { name: 'score', type: 'decimal(10,2)', nullable: true },
      { name: 'done_at', type: 'datetimeoffset(3)', nullable: true },
    ],
  },
  {
    name: 'tc_absences',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'employee_id', type: 'int', default: '0' },
      { name: 'type', type: 'nvarchar(16)', default: "'vacation'", check: "[type] in ('vacation','trip','dayoff','sick','study')" },
      { name: 'date_from', type: 'char(10)', default: "'1970-01-01'" },
      { name: 'date_to', type: 'char(10)', nullable: true },
      { name: 'status', type: 'nvarchar(16)', default: "'request'", check: "[status] in ('request','approved','rejected')" },
      { name: 'note', type: 'nvarchar(max)', default: "''" },
      { name: 'decided_by', type: 'int', nullable: true },
      { name: 'created_at', type: 'datetimeoffset(3)', default: NOW_SQL },
    ],
    indexes: [{ name: 'tc_absences_employee', columns: '[employee_id], [date_from]' }],
  },
  {
    name: 'tc_entitlements',
    primaryKey: ['employee_id', 'year'],
    primaryKeyName: 'pk_tc_entitlements',
    columns: [
      { name: 'employee_id', type: 'int' },
      { name: 'year', type: 'int' },
      { name: 'vacation_days', type: 'int', default: '0' },
      { name: 'carried_over', type: 'int', default: '0' },
      { name: 'dayoff_accrued', type: 'int', default: '0' },
    ],
  },
  {
    name: 'tc_reports',
    primaryKey: ['week_start'],
    columns: [
      { name: 'week_start', type: 'char(10)' },
      { name: 'submitted_at', type: 'datetimeoffset(3)', default: NOW_SQL },
      { name: 'entries', type: 'nvarchar(max)', default: "'[]'" },
    ],
  },
  {
    name: 'tc_messages',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'author_id', type: 'int', default: '0' },
      { name: 'text', type: 'nvarchar(max)', default: "''" },
      { name: 'sent_at', type: 'datetimeoffset(3)', default: NOW_SQL },
    ],
  },
  {
    name: 'tc_dictionaries',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'dictionary', type: 'nvarchar(64)', default: "''" },
      { name: 'code', type: 'nvarchar(64)', default: "''" },
      { name: 'title', type: 'nvarchar(256)', default: "''" },
      { name: 'color', type: 'nvarchar(32)', nullable: true },
    ],
    // Сравнение без учёта регистра обеспечивает параметр сортировки базы, поэтому lower() не нужен.
    indexes: [{ name: 'tc_dictionaries_kind_code', columns: '[dictionary], [code]', unique: true }],
  },
  {
    name: 'tc_plan_rows',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'title', type: 'nvarchar(max)', default: "''" },
      { name: 'is_header', type: 'bit', default: '0' },
      { name: 'base_score', type: 'decimal(10,2)', default: '0' },
    ],
  },
  {
    name: 'tc_users',
    primaryKey: ['employee_id'],
    unique: { uq_tc_users_email: 'email' },
    columns: [
      { name: 'employee_id', type: 'int' },
      { name: 'email', type: 'nvarchar(256)', default: "''" },
      { name: 'role', type: 'nvarchar(32)', default: "'executor'" },
      { name: 'active', type: 'bit', default: '1' },
      { name: 'windows_login', type: 'nvarchar(128)', default: "''" },
      { name: 'full_name', type: 'nvarchar(256)', default: "''" },
      { name: 'position', type: 'nvarchar(256)', default: "''" },
      { name: 'unit_id', type: 'nvarchar(64)', nullable: true },
    ],
    // Фильтрованному индексу нужен QUOTED_IDENTIFIER ON: через драйвер он включён,
    // но схему должно быть можно применить и вручную через sqlcmd или SSMS.
    indexes: [{ name: 'tc_users_windows_login', columns: '[windows_login]', unique: true, where: "[windows_login] <> ''" }],
  },
  {
    name: 'tc_units',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'parent_id', type: 'nvarchar(64)', nullable: true },
      { name: 'kind', type: 'nvarchar(32)', default: "'section'" },
      { name: 'name', type: 'nvarchar(256)', default: "''" },
    ],
  },
  {
    name: 'tc_templates',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'name', type: 'nvarchar(256)', default: "''" },
      { name: 'body', type: 'nvarchar(max)', default: "''" },
      { name: 'scope', type: 'nvarchar(32)', nullable: true },
    ],
  },
  {
    name: 'tc_chat_reads',
    primaryKey: ['employee_id'],
    columns: [
      { name: 'employee_id', type: 'int' },
      { name: 'read_at', type: 'datetimeoffset(3)', default: NOW_SQL },
    ],
  },
  {
    name: 'tc_notices',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'nvarchar(64)' },
      { name: 'at', type: 'datetimeoffset(3)', default: NOW_SQL },
      { name: 'recipients', type: 'nvarchar(max)', default: "'[]'" },
      { name: 'title', type: 'nvarchar(256)', default: "''" },
      { name: 'body', type: 'nvarchar(max)', default: "''" },
      { name: 'url', type: 'nvarchar(256)', default: "''" },
    ],
    indexes: [{ name: 'tc_notices_at', columns: '[at]' }],
  },
  {
    name: 'tc_roles',
    primaryKey: ['role'],
    columns: [
      { name: 'role', type: 'nvarchar(32)' },
      { name: 'name', type: 'nvarchar(128)', default: "''" },
      { name: 'permissions', type: 'nvarchar(max)', default: "'[]'" },
    ],
  },
];

/** Имена ограничений — как в прежних версиях схемы, чтобы базы, созданные ими, совпадали. */
const LEGACY_DEFAULT_NAMES: Record<string, string> = {
  'tc_entitlements.carried_over': 'df_tc_entitlements_carried',
  'tc_entitlements.dayoff_accrued': 'df_tc_entitlements_dayoff',
  'tc_plan_rows.is_header': 'df_tc_plan_rows_header',
  'tc_plan_rows.base_score': 'df_tc_plan_rows_score',
  'tc_users.windows_login': 'df_tc_users_login',
};
const defaultName = (table: string, column: string) => LEGACY_DEFAULT_NAMES[`${table}.${column}`] ?? `df_${table}_${column}`;

/** Определение столбца; addDefault — значение по умолчанию и для уже существующих строк при дописывании столбца. */
const columnSql = (table: SchemaTable, c: Column): string => {
  const parts = [`[${c.name}]`, c.type];
  if (!c.type.includes('identity')) parts.push(c.nullable ? 'null' : 'not null');
  else parts.push('not null');
  if (c.default !== undefined) parts.push(`constraint ${defaultName(table.name, c.name)} default ${c.default}`);
  if (c.check) parts.push(`constraint ck_${table.name}_${c.name} check (${c.check})`);
  return parts.join(' ');
};

const createTableSql = (t: SchemaTable): string => {
  const lines = t.columns.map((c) => {
    const unique = Object.entries(t.unique ?? {}).find(([, column]) => column === c.name)?.[0];
    const pk = t.primaryKey.length === 1 && t.primaryKey[0] === c.name ? ' primary key' : '';
    return `    ${columnSql(t, c)}${pk}${unique ? ` constraint ${unique} unique` : ''}`;
  });
  if (t.primaryKey.length > 1) lines.push(`    constraint ${t.primaryKeyName ?? `pk_${t.name}`} primary key (${t.primaryKey.map((k) => `[${k}]`).join(', ')})`);
  return `if object_id(N'dbo.${t.name}', N'U') is null create table dbo.${t.name} (\n${lines.join(',\n')})`;
};

/** Столбец, которого нет в существующей таблице, дописывается; у NOT NULL — со значением по умолчанию для старых строк. */
const addColumnSql = (t: SchemaTable, c: Column): string =>
  `if col_length('dbo.${t.name}', '${c.name}') is null alter table dbo.${t.name} add ${columnSql(t, c)}`;

const indexSql = (t: SchemaTable, i: NonNullable<SchemaTable['indexes']>[number]): string =>
  `${i.where ? 'set quoted_identifier on;\n   ' : ''}if not exists (select 1 from sys.indexes where name = '${i.name}' and object_id = object_id(N'dbo.${t.name}'))
     create ${i.unique ? 'unique ' : ''}index ${i.name} on dbo.${t.name} (${i.columns})${i.where ? ` where ${i.where}` : ''}`;

/**
 * Схема — отдельными операторами: SQL Server компилирует пакет целиком,
 * и созданную в том же пакете таблицу изменить нельзя. Каждый оператор защищён проверкой существования.
 */
export const SCHEMA: string[] = TABLES.flatMap((t) => [
  createTableSql(t),
  // Ключевые столбцы есть всегда, остальные сверяются по одному.
  ...t.columns.filter((c) => !t.primaryKey.includes(c.name)).map((c) => addColumnSql(t, c)),
  ...(t.indexes ?? []).map((i) => indexSql(t, i)),
]);

// ——— Параметры запросов ———

type Param = { type: sql.ISqlType | (() => sql.ISqlType); value: unknown };

/** Текст; null передаётся с явным типом, иначе драйвер не выведет его сам. */
const S = (v: string | null | undefined, len = sql.MAX): Param => ({ type: sql.NVarChar(len), value: v ?? null });
const I = (v: number | null | undefined): Param => ({ type: sql.Int(), value: v ?? null });
const BIT = (v: boolean | null | undefined): Param => ({ type: sql.Bit(), value: v ?? null });
const DT = (v: string | null | undefined): Param => ({ type: sql.DateTimeOffset(3), value: v == null ? null : new Date(v) });
const NUM = (v: number | null | undefined): Param => ({ type: sql.Decimal(10, 2), value: v ?? null });
/** Массивы и объекты хранятся строкой JSON: в SQL Server нет типов массива и jsonb. */
const J = (v: unknown): Param => ({ type: sql.NVarChar(sql.MAX), value: JSON.stringify(v ?? null) });

/** Исполнитель запросов: пул или транзакция. */
export type Q = { request(): sql.Request };

const run = async (q: Q, text: string, params: Param[] = []): Promise<sql.IResult<Record<string, unknown>>> => {
  const request = q.request();
  // Не @p1: драйвер ODBC сам называет параметры @P1, @P2…, и имена совпали бы (регистр в SQL Server не важен).
  params.forEach((p, i) => request.input(`v${i + 1}`, p.type, p.value));
  return request.query(text);
};

const rows = async (q: Q, text: string, params: Param[] = []): Promise<Record<string, unknown>[]> => (await run(q, text, params)).recordset ?? [];

// ——— Чтение ———

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());
const json = <T>(v: string | null, fallback: T): T => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const meta = async (q: Q, key: string): Promise<string | null> => {
  const found = await rows(q, 'select [value] from dbo.tc_meta where [key] = @v1', [S(key, 64)]);
  return found.length ? (found[0] as { value: string }).value : null;
};

/** Таблицы, по которым видно, что в базе уже есть данные приложения. */
const DATA_TABLES = ['tc_users', 'tc_tasks', 'tc_absences', 'tc_reports', 'tc_messages', 'tc_dictionaries', 'tc_plan_rows', 'tc_units', 'tc_templates', 'tc_roles'] as const;
/** Отметка готовности раздела и таблица, в которой лежат его строки. */
const READY_TABLE: Record<string, (typeof DATA_TABLES)[number]> = {
  'dictionaries-ready': 'tc_dictionaries',
  'plan-rows-ready': 'tc_plan_rows',
  'units-ready': 'tc_units',
  'templates-ready': 'tc_templates',
  'access-ready': 'tc_users',
};

const hasRows = async (q: Q, table: (typeof DATA_TABLES)[number]): Promise<boolean> =>
  (await rows(q, `select top 1 1 as [x] from dbo.${table}`)).length > 0;

/**
 * Раздел записан: есть отметка в tc_meta или строки в его таблице. Строки важнее отметки: если отметок нет
 * (база восстановлена из копии, создана скриптом или перенесена), данные не подменяются значениями
 * по умолчанию и не перезаписываются ими при следующем сохранении.
 */
const isReady = async (q: Q, key: string): Promise<boolean> => (await meta(q, key)) != null || hasRows(q, READY_TABLE[key]);

/** Демоданные пишутся только в действительно пустую базу. */
const isSeeded = async (q: Q): Promise<boolean> => {
  if ((await meta(q, 'seeded')) != null) return true;
  for (const table of DATA_TABLES) if (await hasRows(q, table)) return true;
  return false;
};

const readAll = async (q: Q): Promise<Data | null> => {
  if (!(await isSeeded(q))) return null;
  const dictionariesReady = await isReady(q, 'dictionaries-ready');
  const planRowsReady = await isReady(q, 'plan-rows-ready');
  const unitsReady = await isReady(q, 'units-ready');
  const templatesReady = await isReady(q, 'templates-ready');
  const accessReady = await isReady(q, 'access-ready');
  const accessVersion = await meta(q, 'access-version');
  const authentication = await meta(q, 'authentication-settings');
  const scoring = await meta(q, 'scoring-settings');

  const r = async (text: string) => rows(q, text);
  const tasks = await r('select * from dbo.tc_tasks order by [seq]');
  const absences = await r('select * from dbo.tc_absences order by [date_from], [id]');
  const entitlements = await r('select * from dbo.tc_entitlements order by [year], [employee_id]');
  const reports = await r('select * from dbo.tc_reports order by [week_start]');
  const messages = await r('select * from dbo.tc_messages order by [sent_at], [id]');
  const chatReads = await r('select * from dbo.tc_chat_reads order by [employee_id]');
  const notices = await r('select * from dbo.tc_notices order by [at], [id]');
  const dictionaries = await r('select * from dbo.tc_dictionaries order by [dictionary], [title], [id]');
  const storedPlanRows = await r('select * from dbo.tc_plan_rows order by [id]');
  const users = await r('select * from dbo.tc_users order by [employee_id]');
  const units = await r('select * from dbo.tc_units order by [id]');
  const templates = await r('select * from dbo.tc_templates order by [name], [id]');
  const roles = await r('select * from dbo.tc_roles order by [role]');

  const storedRoles: RoleDefinition[] = accessReady
    ? roles.map((x): RoleDefinition => {
        const row = x as unknown as { role: string; name: string; permissions: string };
        return { role: row.role as RoleDefinition['role'], name: row.name, permissions: json<Permission[]>(row.permissions, []) };
      })
    : DEFAULT_ROLES;
  // Права, добавленные позже, дописываются администратору при чтении старой базы.
  const migratedRoles = accessVersion === ACCESS_VERSION ? storedRoles : withAddedPermissions(storedRoles);

  return {
    tasks: tasks.map((x) => {
      const t = x as unknown as { id: string; title: string; row_id: string | null; category: string | null; assignee_ids: string; start_at: Date; end_at: Date; doc_name: string; doc_number: string; result: string; done: boolean; score: number | null; done_at: Date | null };
      return {
        id: t.id,
        title: t.title,
        rowId: t.row_id,
        category: t.category,
        assigneeIds: json<number[]>(t.assignee_ids, []),
        start: iso(t.start_at)!,
        end: iso(t.end_at)!,
        docName: t.doc_name,
        docNumber: t.doc_number,
        result: t.result,
        done: t.done,
        score: t.score == null ? null : Number(t.score),
        doneAt: iso(t.done_at),
      } as Task;
    }),
    absences: absences.map((x) => {
      const a = x as unknown as { id: string; employee_id: number; type: Absence['type']; date_from: string; date_to: string | null; status: Absence['status']; note: string; decided_by: number | null; created_at: Date };
      return { id: a.id, employeeId: a.employee_id, type: a.type, from: a.date_from, to: a.date_to, status: a.status, note: a.note, decidedBy: a.decided_by, createdAt: iso(a.created_at)! } as Absence;
    }),
    entitlements: entitlements.map((x) => {
      const e = x as unknown as { employee_id: number; year: number; vacation_days: number; carried_over: number; dayoff_accrued: number };
      return { employeeId: e.employee_id, year: e.year, vacationDays: e.vacation_days, carriedOver: e.carried_over, dayoffAccrued: e.dayoff_accrued } as Entitlement;
    }),
    reports: reports.map((x) => {
      const rep = x as unknown as { week_start: string; submitted_at: Date; entries: string };
      return { weekStart: rep.week_start, submittedAt: iso(rep.submitted_at)!, entries: json<Report['entries']>(rep.entries, []) } as Report;
    }),
    messages: messages.map((x) => {
      const m = x as unknown as { id: string; author_id: number; text: string; sent_at: Date };
      return { id: m.id, authorId: m.author_id, text: m.text, sentAt: iso(m.sent_at)! } as Message;
    }),
    chatReads: chatReads.map((x) => {
      const c = x as unknown as { employee_id: number; read_at: Date };
      return { employeeId: c.employee_id, readAt: iso(c.read_at)! } as ChatRead;
    }),
    notices: notices.map((x) => {
      const n = x as unknown as { id: string; at: Date; recipients: string; title: string; body: string; url: string };
      return { id: n.id, at: iso(n.at)!, to: json<number[]>(n.recipients, []), title: n.title, body: n.body, url: n.url } as Notice;
    }),
    dictionaries: dictionariesReady
      ? dictionaries.map((x) => {
          const d = x as unknown as { id: string; dictionary: DictionaryEntry['dictionary']; code: string; title: string; color: string | null };
          return { id: d.id, dictionary: d.dictionary, code: d.code, title: d.title, ...(d.color ? { color: d.color } : {}) } as DictionaryEntry;
        })
      : DEFAULT_DICTIONARIES,
    planRows: planRowsReady
      ? sortedPlanRows(
          storedPlanRows.map((x) => {
            const p = x as unknown as { id: string; title: string; is_header: boolean; base_score: number };
            return { id: p.id, title: p.title, isHeader: p.is_header, baseScore: Number(p.base_score) } as PlanRow;
          }),
        )
      : DEFAULT_PLAN_ROWS.map((row) => ({ ...row })),
    // Сотрудники — ровно то, что в tc_users: пустая таблица — пустой список, демонстрационные не подставляются.
    // Без единого администратора сервер сам добавит того, кто публиковал приложение (server/app.ts).
    users: users.map((x) => {
      const u = x as unknown as { employee_id: number; email: string; full_name: string; position: string; windows_login: string; role: ManagedUser['role']; active: boolean; unit_id: string | null };
      return { employeeId: u.employee_id, email: u.email, fullName: u.full_name, position: u.position, windowsLogin: u.windows_login || u.email.split('@')[0], role: u.role, active: u.active, ...(u.unit_id ? { unitId: u.unit_id } : {}) } as ManagedUser;
    }),
    templates: templatesReady
      ? templates.map((x) => {
          const t = x as unknown as { id: string; name: string; body: string; scope: string | null };
          return { id: t.id, name: t.name, body: t.body, scope: templateScope({ id: t.id, scope: t.scope ?? undefined }) } as DocumentTemplate;
        })
      : DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    units: unitsReady
      ? units.map((x) => {
          const u = x as unknown as { id: string; parent_id: string | null; kind: Unit['kind']; name: string };
          return { id: u.id, parentId: u.parent_id, kind: u.kind, name: u.name } as Unit;
        })
      : DEFAULT_UNITS.map((u) => ({ ...u })),
    roles: migratedRoles,
    authentication: authentication ? JSON.parse(authentication) : { ...DEFAULT_AUTHENTICATION },
    scoring: scoring ? JSON.parse(scoring) : { ...DEFAULT_SCORING },
    // Отметка версии прав: без неё общий код дописывал бы их администратору при каждом чтении.
    ...(accessVersion ? { accessVersion } : {}),
  };
};

// ——— Запись ———

type Table<T> = {
  key: (x: T) => string;
  upsert: (q: Q, x: T) => Promise<unknown>;
  remove: (q: Q, x: T) => Promise<unknown>;
};

/** В SQL Server нет «insert … on conflict»: сначала update, и только если строки не было — insert. */
const upsert = (q: Q, table: string, where: string, set: string, columns: string, values: string, params: Param[]) =>
  run(q, `update dbo.${table} set ${set} where ${where}; if @@rowcount = 0 insert into dbo.${table} (${columns}) values (${values});`, params);

const TASKS: Table<Task> = {
  key: (t) => t.id,
  upsert: (q, t) =>
    upsert(
      q,
      'tc_tasks',
      '[id] = @v1',
      '[title]=@v2, [row_id]=@v3, [category]=@v4, [assignee_ids]=@v5, [start_at]=@v6, [end_at]=@v7, [doc_name]=@v8, [doc_number]=@v9, [result]=@v10, [done]=@v11, [score]=@v12, [done_at]=@v13',
      '[id],[title],[row_id],[category],[assignee_ids],[start_at],[end_at],[doc_name],[doc_number],[result],[done],[score],[done_at]',
      '@v1,@v2,@v3,@v4,@v5,@v6,@v7,@v8,@v9,@v10,@v11,@v12,@v13',
      [S(t.id, 64), S(t.title), S(t.rowId, 64), S(t.category, 64), J(t.assigneeIds), DT(t.start), DT(t.end), S(t.docName), S(t.docNumber), S(t.result), BIT(t.done), NUM(t.score), DT(t.doneAt)],
    ),
  remove: (q, t) => run(q, 'delete from dbo.tc_tasks where [id] = @v1', [S(t.id, 64)]),
};

const ABSENCES: Table<Absence> = {
  key: (a) => a.id,
  upsert: (q, a) =>
    upsert(
      q,
      'tc_absences',
      '[id] = @v1',
      '[employee_id]=@v2, [type]=@v3, [date_from]=@v4, [date_to]=@v5, [status]=@v6, [note]=@v7, [decided_by]=@v8',
      '[id],[employee_id],[type],[date_from],[date_to],[status],[note],[decided_by],[created_at]',
      '@v1,@v2,@v3,@v4,@v5,@v6,@v7,@v8,@v9',
      [S(a.id, 64), I(a.employeeId), S(a.type, 16), S(a.from, 10), S(a.to, 10), S(a.status, 16), S(a.note), I(a.decidedBy), DT(a.createdAt)],
    ),
  remove: (q, a) => run(q, 'delete from dbo.tc_absences where [id] = @v1', [S(a.id, 64)]),
};

const ENTITLEMENTS: Table<Entitlement> = {
  key: (e) => `${e.employeeId}|${e.year}`,
  upsert: (q, e) =>
    upsert(
      q,
      'tc_entitlements',
      '[employee_id] = @v1 and [year] = @v2',
      '[vacation_days]=@v3, [carried_over]=@v4, [dayoff_accrued]=@v5',
      '[employee_id],[year],[vacation_days],[carried_over],[dayoff_accrued]',
      '@v1,@v2,@v3,@v4,@v5',
      [I(e.employeeId), I(e.year), I(e.vacationDays), I(e.carriedOver), I(e.dayoffAccrued)],
    ),
  remove: (q, e) => run(q, 'delete from dbo.tc_entitlements where [employee_id] = @v1 and [year] = @v2', [I(e.employeeId), I(e.year)]),
};

const REPORTS: Table<Report> = {
  key: (r) => r.weekStart,
  upsert: (q, r) =>
    upsert(q, 'tc_reports', '[week_start] = @v1', '[submitted_at]=@v2, [entries]=@v3', '[week_start],[submitted_at],[entries]', '@v1,@v2,@v3', [S(r.weekStart, 10), DT(r.submittedAt), J(r.entries)]),
  remove: (q, r) => run(q, 'delete from dbo.tc_reports where [week_start] = @v1', [S(r.weekStart, 10)]),
};

const MESSAGES: Table<Message> = {
  key: (m) => m.id,
  upsert: (q, m) => upsert(q, 'tc_messages', '[id] = @v1', '[text]=@v3', '[id],[author_id],[text],[sent_at]', '@v1,@v2,@v3,@v4', [S(m.id, 64), I(m.authorId), S(m.text), DT(m.sentAt)]),
  remove: (q, m) => run(q, 'delete from dbo.tc_messages where [id] = @v1', [S(m.id, 64)]),
};

const CHAT_READS: Table<ChatRead> = {
  key: (r) => String(r.employeeId),
  upsert: (q, r) => upsert(q, 'tc_chat_reads', '[employee_id] = @v1', '[read_at]=@v2', '[employee_id],[read_at]', '@v1,@v2', [I(r.employeeId), DT(r.readAt)]),
  remove: (q, r) => run(q, 'delete from dbo.tc_chat_reads where [employee_id] = @v1', [I(r.employeeId)]),
};

const NOTICES: Table<Notice> = {
  key: (n) => n.id,
  upsert: (q, n) =>
    upsert(
      q,
      'tc_notices',
      '[id] = @v1',
      '[at]=@v2, [recipients]=@v3, [title]=@v4, [body]=@v5, [url]=@v6',
      '[id],[at],[recipients],[title],[body],[url]',
      '@v1,@v2,@v3,@v4,@v5,@v6',
      [S(n.id, 64), DT(n.at), J(n.to), S(n.title, 256), S(n.body), S(n.url, 256)],
    ),
  remove: (q, n) => run(q, 'delete from dbo.tc_notices where [id] = @v1', [S(n.id, 64)]),
};

const DICTIONARIES: Table<DictionaryEntry> = {
  key: (entry) => entry.id,
  upsert: (q, entry) =>
    upsert(
      q,
      'tc_dictionaries',
      '[id] = @v1',
      '[dictionary]=@v2, [code]=@v3, [title]=@v4, [color]=@v5',
      '[id],[dictionary],[code],[title],[color]',
      '@v1,@v2,@v3,@v4,@v5',
      [S(entry.id, 64), S(entry.dictionary, 64), S(entry.code, 64), S(entry.title, 256), S(entry.color ?? null, 32)],
    ),
  remove: (q, entry) => run(q, 'delete from dbo.tc_dictionaries where [id] = @v1', [S(entry.id, 64)]),
};

const PLAN_ROWS: Table<PlanRow> = {
  key: (row) => row.id,
  upsert: (q, row) =>
    upsert(q, 'tc_plan_rows', '[id] = @v1', '[title]=@v2, [is_header]=@v3, [base_score]=@v4', '[id],[title],[is_header],[base_score]', '@v1,@v2,@v3,@v4', [S(row.id, 64), S(row.title), BIT(row.isHeader), NUM(row.baseScore)]),
  remove: (q, row) => run(q, 'delete from dbo.tc_plan_rows where [id] = @v1', [S(row.id, 64)]),
};

const USERS: Table<ManagedUser> = {
  key: (user) => String(user.employeeId),
  upsert: (q, user) =>
    upsert(
      q,
      'tc_users',
      '[employee_id] = @v1',
      '[email]=@v2, [full_name]=@v3, [position]=@v4, [windows_login]=@v5, [role]=@v6, [active]=@v7, [unit_id]=@v8',
      '[employee_id],[email],[full_name],[position],[windows_login],[role],[active],[unit_id]',
      '@v1,@v2,@v3,@v4,@v5,@v6,@v7,@v8',
      [I(user.employeeId), S(user.email, 256), S(user.fullName, 256), S(user.position, 256), S(user.windowsLogin, 128), S(user.role, 32), BIT(user.active), S(user.unitId ?? null, 64)],
    ),
  remove: (q, user) => run(q, 'delete from dbo.tc_users where [employee_id] = @v1', [I(user.employeeId)]),
};

const UNITS: Table<Unit> = {
  key: (unit) => unit.id,
  upsert: (q, unit) =>
    upsert(q, 'tc_units', '[id] = @v1', '[parent_id]=@v2, [kind]=@v3, [name]=@v4', '[id],[parent_id],[kind],[name]', '@v1,@v2,@v3,@v4', [S(unit.id, 64), S(unit.parentId, 64), S(unit.kind, 32), S(unit.name, 256)]),
  remove: (q, unit) => run(q, 'delete from dbo.tc_units where [id] = @v1', [S(unit.id, 64)]),
};

const TEMPLATES: Table<DocumentTemplate> = {
  key: (t) => t.id,
  upsert: (q, t) =>
    upsert(q, 'tc_templates', '[id] = @v1', '[name]=@v2, [body]=@v3, [scope]=@v4', '[id],[name],[body],[scope]', '@v1,@v2,@v3,@v4', [S(t.id, 64), S(t.name, 256), S(t.body), S(t.scope, 32)]),
  remove: (q, t) => run(q, 'delete from dbo.tc_templates where [id] = @v1', [S(t.id, 64)]),
};

const ROLES: Table<RoleDefinition> = {
  key: (role) => role.role,
  upsert: (q, role) =>
    upsert(q, 'tc_roles', '[role] = @v1', '[name]=@v2, [permissions]=@v3', '[role],[name],[permissions]', '@v1,@v2,@v3', [S(role.role, 32), S(role.name, 128), J(role.permissions)]),
  remove: (q, role) => run(q, 'delete from dbo.tc_roles where [role] = @v1', [S(role.role, 32)]),
};

/** Сравнение без учёта порядка ключей: объекты из базы приходят с переставленными полями. */
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

const setMeta = (q: Q, key: string, value: string) =>
  run(q, 'update dbo.tc_meta set [value] = @v2 where [key] = @v1; if @@rowcount = 0 insert into dbo.tc_meta ([key],[value]) values (@v1,@v2);', [S(key, 64), S(value)]);

const setMetaOnce = (q: Q, key: string, value: string) =>
  run(q, 'if not exists (select 1 from dbo.tc_meta where [key] = @v1) insert into dbo.tc_meta ([key],[value]) values (@v1,@v2);', [S(key, 64), S(value)]);

// ——— Настройки подключения ———

export type MssqlSettings = {
  /** Имя сервера: «SQLSRV», «SQLSRV\\INSTANCE» или адрес. */
  server: string;
  /** База данных; создаётся при первом обращении. */
  database: string;
  port?: number;
  instanceName?: string;
  user?: string;
  password?: string;
  /** Домен задаёт вход доменной учётной записью (NTLM) вместо учётной записи SQL Server. */
  domain?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  /** Драйвер ODBC для входа Windows (MSSQL_ODBC_DRIVER); по умолчанию — самый новый установленный. */
  odbcDriver?: string;
};

/** Вход Windows: учётная запись SQL Server не задана, подключаемся под учётной записью процесса. */
export const usesWindowsLogin = (s: MssqlSettings): boolean => !s.user;

/** Драйверы ODBC для SQL Server от новых к старым; «SQL Server» есть в любой Windows. */
export const ODBC_DRIVERS = ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'SQL Server Native Client 11.0', 'SQL Server'];

export const pickOdbcDriver = (installed: string[], preferred?: string): string =>
  preferred || ODBC_DRIVERS.find((name) => installed.includes(name)) || 'SQL Server';

/** Установленные драйверы ODBC — из реестра Windows. */
const installedOdbcDrivers = async (): Promise<string[]> => {
  try {
    const { stdout } = await promisify(execFile)('reg', ['query', 'HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers'], { windowsHide: true });
    return stdout.split(/\r?\n/).map((line) => /^\s+(.+?)\s+REG_SZ\s+/.exec(line)?.[1]).filter((name): name is string => !!name);
  } catch {
    return [];
  }
};

/** Строка подключения ODBC с проверкой подлинности Windows (Trusted_Connection). */
export const odbcConnectionString = (s: MssqlSettings, database: string, driver: string): string => {
  const server = `${s.server}${s.instanceName ? `\\${s.instanceName}` : ''}${s.port ? `,${s.port}` : ''}`;
  const parts = [`Driver={${driver}}`, `Server=${server}`, `Database=${database}`, 'Trusted_Connection=yes'];
  // Шифрование настраивается только у драйверов «ODBC Driver …»; старым драйверам эти ключи не нужны.
  if (driver.startsWith('ODBC Driver')) parts.push(`Encrypt=${s.encrypt ? 'yes' : 'no'}`, `TrustServerCertificate=${s.trustServerCertificate ? 'yes' : 'no'}`);
  return `${parts.join(';')};`;
};

const bool = (v: string | undefined, fallback: boolean) => (v == null || v === '' ? fallback : v === 'true' || v === '1');

/**
 * Настройки из переменных окружения. Достаточно MSSQL_SERVER; остальное — по умолчанию.
 * Возвращает null, когда SQL Server не настроен.
 */
export const mssqlSettingsFromEnv = (env: Record<string, string | undefined>): MssqlSettings | null => {
  const server = env.MSSQL_SERVER?.trim();
  if (!server) return null;
  const [host, named] = server.split('\\');
  const instanceName = env.MSSQL_INSTANCE?.trim() || named || undefined;
  const port = env.MSSQL_PORT ? Number(env.MSSQL_PORT) : undefined;
  return {
    server: host,
    database: env.MSSQL_DATABASE?.trim() || 'TaskControl',
    ...(instanceName ? { instanceName } : {}),
    ...(port ? { port } : {}),
    ...(env.MSSQL_USER ? { user: env.MSSQL_USER } : {}),
    ...(env.MSSQL_PASSWORD ? { password: env.MSSQL_PASSWORD } : {}),
    ...(env.MSSQL_DOMAIN ? { domain: env.MSSQL_DOMAIN } : {}),
    // Внутри корпоративной сети сертификат обычно самоподписанный, поэтому доверие включено.
    encrypt: bool(env.MSSQL_ENCRYPT, true),
    trustServerCertificate: bool(env.MSSQL_TRUST_SERVER_CERTIFICATE, true),
    ...(env.MSSQL_ODBC_DRIVER?.trim() ? { odbcDriver: env.MSSQL_ODBC_DRIVER.trim() } : {}),
  };
};

const poolConfig = (s: MssqlSettings, database: string): sql.config => ({
  server: s.server,
  database,
  ...(s.port ? { port: s.port } : {}),
  ...(s.user ? { user: s.user } : {}),
  ...(s.password ? { password: s.password } : {}),
  ...(s.domain ? { domain: s.domain } : {}),
  options: {
    encrypt: s.encrypt,
    trustServerCertificate: s.trustServerCertificate,
    ...(s.instanceName ? { instanceName: s.instanceName } : {}),
    // Даты хранятся строками YYYY-MM-DD, поэтому пояс сервера на них не влияет.
    useUTC: true,
    enableArithAbort: true,
  },
  pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
  requestTimeout: 30_000,
});

/** Пул соединений: tedious для учётной записи SQL Server, ODBC (msnodesqlv8) для входа Windows. */
const openPool = async (s: MssqlSettings, database: string): Promise<sql.ConnectionPool> => {
  if (!usesWindowsLogin(s)) return new sql.ConnectionPool(poolConfig(s, database));
  // Модуль загружается только для входа Windows: он нужен лишь на сервере Windows.
  const odbc = (await import('mssql/msnodesqlv8')).default as unknown as typeof sql;
  const driver = pickOdbcDriver(await installedOdbcDrivers(), s.odbcDriver);
  return new odbc.ConnectionPool({
    connectionString: odbcConnectionString(s, database, driver),
    options: { useUTC: true },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
    requestTimeout: 30_000,
  } as unknown as sql.config);
};

/** Создаёт базу, если её ещё нет: приложение разворачивается на пустом сервере. */
export const ensureDatabase = async (settings: MssqlSettings): Promise<void> => {
  // Имя базы нельзя передать параметром, поэтому оно проверяется и экранируется (и в строке подключения).
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,120}$/.test(settings.database)) throw new Error(`Недопустимое имя базы данных: ${settings.database}`);
  const master = await openPool(settings, 'master');
  await master.connect();
  try {
    await master.request().query(`if db_id(N'${settings.database}') is null create database [${settings.database}]`);
  } finally {
    await master.close();
  }
};

export const createMssqlRepo = (settings: MssqlSettings): Repo => {
  let pool: sql.ConnectionPool | null = null;
  let ready: Promise<sql.ConnectionPool> | null = null;

  const connect = () =>
    (ready ??= (async () => {
      await ensureDatabase(settings);
      pool ??= await openPool(settings, settings.database);
      await pool.connect();
      // Сверка схемы при каждом запуске (то есть при каждой публикации): недостающие таблицы, столбцы
      // и индексы создаются, существующие строки и данные не меняются и не удаляются.
      for (const statement of SCHEMA) await pool.request().query(statement);
      return pool;
    })().catch((e) => ((ready = null), Promise.reject(e))));

  return {
    kind: 'sqlserver',
    ping: async () => {
      // connect() создаёт базу и таблицы, поэтому проверка охватывает всю готовность хранилища.
      await (await connect()).request().query('select 1');
    },
    close: async () => {
      if (ready) await ready.catch(() => undefined);
      await pool?.close();
    },
    async read() {
      return readAll(await connect());
    },
    async update(fn) {
      // Транзакция берётся у пула: так она работает с любым из двух драйверов.
      const tx = (await connect()).transaction();
      await tx.begin();
      try {
        // Общая блокировка: одновременные правки выстраиваются в очередь и не теряются.
        // Процедура вызывается запросом: так имена её параметров не зависят от драйвера.
        const locked = await rows(
          tx,
          `declare @rc int;
           exec @rc = sp_getapplock @Resource = @v1, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = @v2;
           select @rc as [rc];`,
          [S(LOCK, 255), I(LOCK_TIMEOUT_MS)],
        );
        const code = Number((locked[0] as unknown as { rc: number } | undefined)?.rc ?? 0);
        if (code < 0) throw new Error('База занята другой операцией, попробуйте ещё раз.');

        const accessVersion = await meta(tx, 'access-version');
        const current = await readAll(tx);
        const next = fn(current);
        const empty: Data = {
          tasks: [],
          absences: [],
          entitlements: [],
          reports: [],
          messages: [],
          chatReads: [],
          planRows: DEFAULT_PLAN_ROWS.map((row) => ({ ...row })),
          dictionaries: DEFAULT_DICTIONARIES,
          users: DEFAULT_USERS,
          roles: DEFAULT_ROLES,
          units: DEFAULT_UNITS,
          templates: DEFAULT_TEMPLATES,
          authentication: { ...DEFAULT_AUTHENTICATION },
          scoring: { ...DEFAULT_SCORING },
        };
        const before = current ?? empty;
        // Пока таблица ни разу не записывалась, чтение подставляет значения по умолчанию.
        // Сравнивать с ними нельзя: иначе они сочтутся уже сохранёнными и не попадут в базу.
        const baseline: Data = {
          ...before,
          dictionaries: (await isReady(tx, 'dictionaries-ready')) ? before.dictionaries : [],
          planRows: (await isReady(tx, 'plan-rows-ready')) ? before.planRows : [],
          users: (await isReady(tx, 'access-ready')) ? before.users : [],
          roles: (await isReady(tx, 'access-ready')) ? before.roles : [],
          units: (await isReady(tx, 'units-ready')) ? before.units : [],
          templates: (await isReady(tx, 'templates-ready')) ? before.templates : [],
        };

        await sync(tx, TASKS, before.tasks, next.tasks);
        await sync(tx, ABSENCES, before.absences, next.absences);
        await sync(tx, ENTITLEMENTS, before.entitlements, next.entitlements);
        await sync(tx, REPORTS, before.reports, next.reports);
        await sync(tx, MESSAGES, before.messages, next.messages);
        await sync(tx, CHAT_READS, before.chatReads ?? [], next.chatReads ?? []);
        // Журнал уведомлений пишется, только если его передали.
        if (next.notices) await sync(tx, NOTICES, before.notices ?? [], next.notices);
        await sync(tx, DICTIONARIES, baseline.dictionaries, next.dictionaries);
        await sync(tx, PLAN_ROWS, baseline.planRows ?? [], next.planRows ?? DEFAULT_PLAN_ROWS);
        await sync(tx, USERS, baseline.users, next.users);
        await sync(tx, ROLES, baseline.roles, next.roles);
        await sync(tx, UNITS, baseline.units ?? [], next.units ?? DEFAULT_UNITS);
        await sync(tx, TEMPLATES, baseline.templates ?? [], next.templates ?? DEFAULT_TEMPLATES);

        if (accessVersion !== ACCESS_VERSION) {
          for (const role of next.roles) await ROLES.upsert(tx, role);
          await setMeta(tx, 'access-version', ACCESS_VERSION);
        }
        if (stable(before.scoring ?? DEFAULT_SCORING) !== stable(next.scoring ?? DEFAULT_SCORING)) await setMeta(tx, 'scoring-settings', JSON.stringify(next.scoring ?? DEFAULT_SCORING));
        if (stable(before.authentication) !== stable(next.authentication)) await setMeta(tx, 'authentication-settings', JSON.stringify(next.authentication));

        await setMetaOnce(tx, 'seeded', new Date().toISOString());
        for (const key of ['dictionaries-ready', 'plan-rows-ready', 'access-ready', 'units-ready', 'templates-ready']) await setMeta(tx, key, new Date().toISOString());

        await tx.commit();
        return next;
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
    },
  };
};
