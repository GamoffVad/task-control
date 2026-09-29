// Чистые функции предметной области — покрыты модульными тестами.
import { categoryLabel, department, employees, fullName, planRows, unitOf } from './data';
import { deadlineBucket, inRange, periodStart, planWeekRange, fromDateKey, toDateKey } from './dates';
import { unitWithDescendants } from './units';
import { DEFAULT_SCORING } from './access';
import type { AppState, DeadlineBucket, Employee, ManagedUser, Period, PlanRow, Report, ReportEntry, ScoringSettings, Task, Unit } from './types';

/** Базовый вес позиции плана (из справочника; позже — из БД). */
export const baseScore = (rowId: string | null, rows: PlanRow[] = planRows): number | null => {
  const row = rowId ? rows.find((item) => item.id === rowId) : undefined;
  return row && !row.isHeader ? row.baseScore : null;
};

/** Баллы за исполнение задачи: индивидуальные, иначе базовый вес позиции. */
export const taskScore = (t: Pick<Task, 'rowId' | 'score'>, rows: PlanRow[] = planRows): number => t.score ?? baseScore(t.rowId, rows) ?? 0;

export const MIN_SCORE = 0.1;
export const MAX_SCORE = 15;

export const clampScore = (n: number): number => {
  if (!Number.isFinite(n)) return MIN_SCORE;
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(n * 10) / 10));
};

export const taskEnd = (t: Task): Date => new Date(t.end);
export const taskStart = (t: Task): Date => new Date(t.start);

export const isOverdue = (t: Task, now: Date = new Date()): boolean =>
  !t.done && deadlineBucket(taskEnd(t), now) === 'overdue';

export const overdueTasks = (tasks: Task[], now: Date = new Date()): Task[] => tasks.filter((t) => isOverdue(t, now));

/** Задачи плановой недели по строке и сотруднику. */
export const tasksInWeek = (tasks: Task[], weekStart: Date): Task[] => {
  const { from, to } = planWeekRange(weekStart);
  return tasks.filter((t) => inRange(taskEnd(t), from, to));
};

export const cellKey = (rowId: string, employeeId: number) => `${rowId}|${employeeId}`;

export const groupByCell = (tasks: Task[]): Map<string, Task[]> => {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.rowId) continue;
    for (const a of t.assigneeIds) {
      const key = cellKey(t.rowId, a);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.end.localeCompare(b.end));
  return map;
};

export const bucketize = (
  tasks: Task[],
  employeeId: number | null,
  now: Date = new Date(),
  opts: { includeDone?: boolean } = {},
): Record<DeadlineBucket, Task[]> => {
  const out: Record<DeadlineBucket, Task[]> = { overdue: [], today: [], week: [], nextWeek: [], month: [], quarter: [], later: [] };
  for (const t of tasks) {
    if (t.done && !opts.includeDone) continue;
    if (employeeId !== null && !t.assigneeIds.includes(employeeId)) continue;
    out[deadlineBucket(taskEnd(t), now)].push(t);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.end.localeCompare(b.end));
  return out;
};

/** Снимок исполненных задач недели для отчёта: одна запись на исполнителя. */
export const buildReportEntries = (state: Pick<AppState, 'tasks'> & { planRows?: PlanRow[] }, weekStart: Date): ReportEntry[] => {
  const rows = state.planRows ?? planRows;
  const entries: ReportEntry[] = [];
  for (const t of tasksInWeek(state.tasks, weekStart)) {
    if (!t.done || !t.rowId) continue;
    const row = rows.find((item) => item.id === t.rowId);
    if (!row || row.isHeader) continue;
    for (const assigneeId of t.assigneeIds) {
      entries.push({
        taskId: t.id,
        rowId: t.rowId,
        rowTitle: row.title,
        assigneeId,
        title: t.title,
        deadline: t.end,
        result: t.result,
        docName: t.docName,
        docNumber: t.docNumber,
        score: taskScore(t, rows),
        doneAt: t.doneAt ?? t.end,
      });
    }
  }
  return entries;
};

/** Отчёт за неделю заменяет предыдущую отправку той же недели. */
export const upsertReport = (reports: Report[], report: Report): Report[] =>
  [...reports.filter((r) => r.weekStart !== report.weekStart), report].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

export const findReport = (reports: Report[], weekStart: Date): Report | undefined =>
  reports.find((r) => r.weekStart === toDateKey(weekStart));

export const entriesInPeriod = (reports: Report[], period: Period, now: Date = new Date()): ReportEntry[] => {
  const from = periodStart(period, now);
  const all = reports.flatMap((r) => r.entries);
  return from ? all.filter((e) => new Date(e.doneAt) >= from) : all;
};

// ——— Правила подсчёта баллов ———

/**
 * Данные для правил оценки. Правила применяются при показе, поэтому расчёт всегда идёт
 * по текущим настройкам — и прошлые периоды пересчитываются вместе с ними.
 */
export type ScoringContext = {
  scoring: ScoringSettings;
  /** Учётные записи: подразделение сотрудника и признак «действующая». */
  users: ManagedUser[];
  units: Unit[];
};

const defaultContext: ScoringContext = { scoring: DEFAULT_SCORING, users: [], units: [] };

/** Сотрудники вне общей оценки: по подразделению (вместе с вложенными) и поимённо. */
export const excludedFromScoring = (ctx: ScoringContext = defaultContext): Set<number> => {
  const out = new Set(ctx.scoring.excludedEmployeeIds);
  for (const unitId of ctx.scoring.excludedUnitIds) {
    const inside = unitWithDescendants(ctx.units, unitId);
    for (const user of ctx.users) if (inside.has(unitOf(user) ?? '')) out.add(user.employeeId);
  }
  return out;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Итог по набору баллов сотрудников: общий, средний и что взято знаменателем. */
export type ScoreSummary = { total: number; average: number; counted: number };

export const summarize = (totals: Map<number, number>, ctx: ScoringContext = defaultContext): ScoreSummary => {
  const excluded = excludedFromScoring(ctx);
  const ids = [...totals.keys()].filter((id) => !excluded.has(id));
  const total = round1(ids.reduce((sum, id) => sum + (totals.get(id) ?? 0), 0));
  const active = new Map(ctx.users.map((u) => [u.employeeId, u.active]));
  const counted = ids.filter((id) => {
    if (ctx.scoring.averageBase === 'withScore') return (totals.get(id) ?? 0) > 0;
    if (ctx.scoring.averageBase === 'active') return active.get(id) !== false;
    return true;
  }).length;
  return { total, average: counted > 0 ? round1(total / counted) : 0, counted };
};

export type EmployeeScoreContext = {
  employeeTotal: number;
  departmentTotal: number;
  departmentAverage: number;
  relativeToAverage: number | null;
  contribution: number | null;
  /** Сотрудник не входит в общую оценку: его баллы видны, но в итог отдела не идут. */
  excluded: boolean;
};

/**
 * Контекст баллов сотрудника: общий и средний балл отдела считаются по правилам оценки.
 * departmentSize используется только при правиле «все сотрудники».
 */
export const employeeScoreContext = (
  entries: Pick<ReportEntry, 'assigneeId' | 'score'>[],
  employeeId: number,
  departmentSize: number,
  ctx: ScoringContext = defaultContext,
): EmployeeScoreContext => {
  const employeeTotal = round1(entries.filter((entry) => entry.assigneeId === employeeId).reduce((sum, entry) => sum + entry.score, 0));
  const totals = new Map<number, number>();
  // Знаменатель «все сотрудники» — численность отдела, поэтому в набор входят и те, у кого баллов нет.
  for (const e of employees) totals.set(e.id, 0);
  for (const entry of entries) totals.set(entry.assigneeId, (totals.get(entry.assigneeId) ?? 0) + entry.score);
  const summary = summarize(totals, ctx);
  // Правило «все сотрудники» опирается на переданную численность: она учитывает выбранную группу.
  const excluded = excludedFromScoring(ctx);
  const size = ctx.scoring.averageBase === 'staff' ? Math.max(0, departmentSize - [...excluded].filter((id) => totals.has(id)).length) : summary.counted;
  const average = size > 0 ? summary.total / size : 0;
  return {
    employeeTotal,
    departmentTotal: summary.total,
    departmentAverage: round1(average),
    relativeToAverage: average > 0 ? round1((employeeTotal / average) * 100) : null,
    contribution: summary.total > 0 ? round1((employeeTotal / summary.total) * 100) : null,
    excluded: excluded.has(employeeId),
  };
};

export type KpiRow = { employeeId: number; total: number; count: number; excluded: boolean };

export const kpiByEmployee = (reports: Report[], period: Period, now: Date = new Date(), ctx: ScoringContext = defaultContext): KpiRow[] => {
  const excluded = excludedFromScoring(ctx);
  const map = new Map<number, KpiRow>(employees.map((e) => [e.id, { employeeId: e.id, total: 0, count: 0, excluded: excluded.has(e.id) }]));
  for (const e of entriesInPeriod(reports, period, now)) {
    const rowEntry = map.get(e.assigneeId);
    if (!rowEntry) continue;
    rowEntry.total = round1(rowEntry.total + e.score);
    rowEntry.count += 1;
  }
  // Исключённые уходят вниз списка: их баллы видны, но в общую оценку не входят.
  return [...map.values()].sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.total - a.total || a.employeeId - b.employeeId);
};

/** Итог по направлению (отделению) отдела. */
export type DirectionRow = { id: string; name: string; total: number; average: number; count: number; people: number; excluded: boolean };

/** Разрез по направлениям: общий и средний балл каждого отделения. */
export const kpiByDirection = (reports: Report[], period: Period, now: Date = new Date(), ctx: ScoringContext = defaultContext): DirectionRow[] => {
  const rows = kpiByEmployee(reports, period, now, ctx);
  const byEmployee = new Map(rows.map((r) => [r.employeeId, r]));
  return department.groups
    .map((group): DirectionRow => {
      // Ряд показывает собственные баллы направления целиком: исключение влияет на итог отдела,
      // а не на само направление — иначе у руководства были бы задачи, но ноль баллов.
      const totals = new Map(group.employeeIds.map((id) => [id, byEmployee.get(id)?.total ?? 0]));
      const summary = summarize(totals, { ...ctx, scoring: { ...ctx.scoring, excludedUnitIds: [], excludedEmployeeIds: [] } });
      const count = group.employeeIds.reduce((sum, id) => sum + (byEmployee.get(id)?.count ?? 0), 0);
      // Направление целиком вне оценки, когда исключены все его сотрудники, — например, руководство.
      const excluded = group.employeeIds.length > 0 && group.employeeIds.every((id) => byEmployee.get(id)?.excluded);
      return { id: group.id, name: group.name, total: summary.total, average: summary.average, count, people: summary.counted, excluded };
    })
    .sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.total - a.total || a.name.localeCompare(b.name, 'ru'));
};

/** Строки отчёта: разделы остаются, только если под ними есть записи. */
export const reportRows = (entries: ReportEntry[], rows: PlanRow[] = planRows) => {
  const used = new Set(entries.map((e) => e.rowId));
  return rows.filter((r) => (r.isHeader ? [...used].some((id) => id.startsWith(`${r.id}.`)) : used.has(r.id)));
};

export type TaskDraft = Omit<Task, 'id' | 'doneAt'> & { id?: string };

export type TaskErrors = Partial<Record<'title' | 'end' | 'assigneeIds' | 'done' | 'score', string>>;

export const validateTask = (d: TaskDraft): TaskErrors => {
  const errors: TaskErrors = {};
  if (!d.title.trim()) errors.title = 'Введите название задачи.';
  if (new Date(d.end) < new Date(d.start)) errors.end = 'Окончание раньше начала: исправьте дату или время.';
  if (d.assigneeIds.length === 0) errors.assigneeIds = 'Выберите хотя бы одного исполнителя.';
  if (d.done && !d.result.trim()) errors.done = 'Чтобы отметить исполнение, опишите результат.';
  if (d.score !== null && !(Number.isFinite(d.score) && d.score >= MIN_SCORE && d.score <= MAX_SCORE)) {
    errors.score = 'Баллы — число от 0,1 до 15.';
  }
  return errors;
};

export const csvEscape = (v: string | number): string => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const reportToCsv = (report: Report, fullNameOf: (id: number) => string): string => {
  const head = ['Позиция', 'Наименование позиции', 'Исполнитель', 'Задача', 'Результат', 'Срок', 'Документ', 'Баллы'];
  const lines = report.entries.map((e) =>
    [
      e.rowId,
      e.rowTitle,
      fullNameOf(e.assigneeId),
      e.title,
      e.result,
      toDateKey(new Date(e.deadline)),
      [e.docName, e.docNumber && `№ ${e.docNumber}`].filter(Boolean).join(' '),
      String(e.score).replace('.', ','),
    ]
      .map(csvEscape)
      .join(';'),
  );
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
};

export const reportWeek = (r: Report) => fromDateKey(r.weekStart);

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Поиск по содержанию: название, результат, документ, позиция плана, категория, исполнители. */
export const searchTasks = (tasks: Task[], query: string, rows: PlanRow[] = planRows): Task[] => {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return tasks;
  return tasks.filter((t) => {
    const row = t.rowId ? rows.find((item) => item.id === t.rowId) : undefined;
    const hay = norm(
      [
        t.title,
        t.result,
        t.docName,
        t.docNumber,
        row ? `${row.id} ${row.title}` : '',
        t.category ? categoryLabel(t.category) : '',
        ...t.assigneeIds.map(fullName),
      ].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
};

const normName = (s: string) => s.toLocaleLowerCase('ru').replaceAll('ё', 'е');

/** Поиск сотрудника по фамилии, имени, отчеству и должности — без учёта регистра и «ё». */
export const matchesEmployee = (e: Employee, query: string): boolean => {
  const q = normName(query.trim());
  if (!q) return true;
  return normName(`${e.lastname} ${e.name} ${e.patronymic} ${e.position}`).includes(q);
};
