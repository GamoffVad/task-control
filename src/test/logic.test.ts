import { describe, expect, it, vi } from 'vitest';
import {
  addMonths,
  deadlineBucket,
  defaultDeadlineFor,
  fmtRange,
  fromInputDateTime,
  planWeekStart,
  plural,
  startOfWeek,
  toDateKey,
  toInputDateTime,
} from '../lib/dates';
import {
  bucketize,
  buildReportEntries,
  clampScore,
  groupByCell,
  employeeScoreContext,
  excludedFromScoring,
  kpiByDirection,
  kpiByEmployee,
  type ScoringContext,
  reportRows,
  reportToCsv,
  baseScore,
  searchTasks,
  taskScore,
  tasksInWeek,
  upsertReport,
  validateTask,
} from '../lib/logic';
import { layoutDay } from '../lib/calendarLayout';
import { DEFAULT_SCORING, DEFAULT_USERS } from '../lib/access';
import { DEFAULT_UNITS } from '../lib/units';
import { unreadMessages } from '../lib/chat';
import { createSeed } from '../lib/seed';
import { taskAccess } from '../lib/permissions';
import { migrate, reducer } from '../lib/store';
import type { AppState, Report, ScoringSettings, Task, User } from '../lib/types';

// Основные тесты проверяют демоотдел из 7 человек; большой отдел — в bigdept.test.tsx.
vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

// Четверг, 17 сентября 2026, 12:00.
const NOW = new Date(2026, 8, 17, 12, 0);

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Задача',
  rowId: '1.1',
  category: null,
  assigneeIds: [1],
  start: new Date(2026, 8, 17, 10).toISOString(),
  end: new Date(2026, 8, 17, 11).toISOString(),
  docName: '',
  docNumber: '',
  result: '',
  done: false,
  score: null,
  doneAt: null,
  ...over,
});

describe('даты', () => {
  it('плановая неделя начинается в пятницу', () => {
    expect(toDateKey(planWeekStart(NOW))).toBe('2026-09-11');
    expect(toDateKey(planWeekStart(new Date(2026, 8, 18)))).toBe('2026-09-18');
    expect(toDateKey(planWeekStart(new Date(2026, 8, 20)))).toBe('2026-09-18');
  });

  it('неделя календаря начинается в понедельник, в том числе в воскресенье', () => {
    expect(toDateKey(startOfWeek(NOW))).toBe('2026-09-14');
    expect(toDateKey(startOfWeek(new Date(2026, 8, 20)))).toBe('2026-09-14');
  });

  it('распределяет сроки по колонкам контроля', () => {
    expect(deadlineBucket(new Date(2026, 8, 16, 23), NOW)).toBe('overdue');
    expect(deadlineBucket(new Date(2026, 8, 17, 8), NOW)).toBe('today');
    expect(deadlineBucket(new Date(2026, 8, 20), NOW)).toBe('week');
    expect(deadlineBucket(new Date(2026, 8, 21), NOW)).toBe('nextWeek');
    expect(deadlineBucket(new Date(2026, 8, 27), NOW)).toBe('nextWeek');
    expect(deadlineBucket(new Date(2026, 8, 28), NOW)).toBe('month');
    expect(deadlineBucket(new Date(2026, 9, 16), NOW)).toBe('month');
    // Квартал: до конца квартала, но не меньше трёх месяцев вперёд (до 17.12).
    expect(deadlineBucket(new Date(2026, 10, 30), NOW)).toBe('quarter');
    expect(deadlineBucket(new Date(2026, 11, 20), NOW)).toBe('later');
  });

  it('срок по умолчанию попадает в свою колонку', () => {
    for (const b of ['today', 'week', 'nextWeek', 'month', 'quarter'] as const) {
      expect(deadlineBucket(defaultDeadlineFor(b, NOW), NOW)).toBe(b);
    }
    // В пятницу «на этой неделе» — это выходные, а не прошедшая дата.
    const friday = new Date(2026, 8, 18, 12);
    expect(deadlineBucket(defaultDeadlineFor('week', friday), friday)).toBe('week');
    const sunday = new Date(2026, 8, 20, 12);
    expect(['today', 'week']).toContain(deadlineBucket(defaultDeadlineFor('week', sunday), sunday));
  });

  it('прибавляет месяцы без перескока через конец месяца', () => {
    expect(toDateKey(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    expect(toDateKey(addMonths(new Date(2026, 2, 31), -1))).toBe('2026-02-28');
  });

  it('преобразует значение datetime-local туда и обратно', () => {
    const d = new Date(2026, 8, 17, 9, 5);
    expect(toInputDateTime(d)).toBe('2026-09-17T09:05');
    expect(fromInputDateTime('2026-09-17T09:05')?.getTime()).toBe(d.getTime());
    expect(fromInputDateTime('')).toBeNull();
  });

  it('склоняет существительные', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, 'балл', 'балла', 'баллов'))).toEqual([
      'балл', 'балла', 'баллов', 'баллов', 'балл', 'балла', 'баллов',
    ]);
    expect(plural(1.5, 'балл', 'балла', 'баллов')).toBe('балла');
  });

  it('форматирует диапазон дат', () => {
    expect(fmtRange(new Date(2026, 8, 11), new Date(2026, 8, 17))).toBe('11 – 17 сентября');
    expect(fmtRange(new Date(2026, 7, 28), new Date(2026, 8, 3))).toBe('28 августа – 3 сентября');
  });
});

describe('логика задач', () => {
  it('проверяет обязательные поля', () => {
    const errs = validateTask({ ...task(), title: '  ', assigneeIds: [], end: new Date(2026, 8, 17, 9).toISOString(), done: true, result: '' });
    expect(Object.keys(errs).sort()).toEqual(['assigneeIds', 'done', 'end', 'title']);
    expect(validateTask(task())).toEqual({});
  });

  it('ограничивает вес позиции диапазоном 0,1–15', () => {
    expect(clampScore(0)).toBe(0.1);
    expect(clampScore(99)).toBe(15);
    expect(clampScore(2.345)).toBe(2.3);
    expect(clampScore(Number.NaN)).toBe(0.1);
    expect(baseScore('1.1')).toBe(5);
    expect(baseScore('1')).toBeNull();
    expect(baseScore(null)).toBeNull();
    expect(taskScore({ rowId: '1.1', score: null })).toBe(5);
    expect(taskScore({ rowId: '1.1', score: 7 })).toBe(7);
    expect(taskScore({ rowId: null, score: null })).toBe(0);
  });

  it('раскладывает задачу с несколькими исполнителями по ячейкам', () => {
    const cells = groupByCell([task({ assigneeIds: [1, 3] }), task({ id: 't2', rowId: null })]);
    expect([...cells.keys()].sort()).toEqual(['1.1|1', '1.1|3']);
  });

  it('берёт в неделю задачи со сроком с пятницы по четверг', () => {
    const inside = task({ end: new Date(2026, 8, 17, 23, 59).toISOString() });
    const nextFriday = task({ id: 't2', end: new Date(2026, 8, 18, 0, 0).toISOString() });
    const prevThursday = task({ id: 't3', end: new Date(2026, 8, 10, 18).toISOString() });
    expect(tasksInWeek([inside, nextFriday, prevThursday], planWeekStart(NOW)).map((t) => t.id)).toEqual(['t1']);
  });

  it('не показывает исполненные задачи на доске и фильтрует по сотруднику', () => {
    const b = bucketize(
      [
        task({ id: 'a', end: new Date(2026, 8, 15).toISOString() }),
        task({ id: 'b', end: new Date(2026, 8, 15).toISOString(), done: true, result: 'ок' }),
        task({ id: 'c', end: new Date(2026, 8, 15).toISOString(), assigneeIds: [2] }),
      ],
      1,
      NOW,
    );
    expect(b.overdue.map((t) => t.id)).toEqual(['a']);
  });

  it('формирует отчёт с баллами задачи и одной записью на исполнителя', () => {
    const t = task({ done: true, result: 'Готово', assigneeIds: [1, 2], score: 8, doneAt: NOW.toISOString() });
    const entries = buildReportEntries({ tasks: [t, task({ id: 'x' })] }, planWeekStart(NOW));
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.score === 8)).toBe(true);
    expect(reportRows(entries).map((r) => r.id)).toEqual(['1', '1.1']);
  });

  it('повторная отправка недели заменяет отчёт, а не дублирует', () => {
    const r1: Report = { weekStart: '2026-09-11', submittedAt: 'a', entries: [] };
    const r2: Report = { weekStart: '2026-09-11', submittedAt: 'b', entries: [] };
    const other: Report = { weekStart: '2026-09-04', submittedAt: 'c', entries: [] };
    expect(upsertReport([r1, other], r2)).toEqual([other, r2]);
  });

  it('считает показатели за период', () => {
    const entry = (assigneeId: number, score: number, doneAt: Date) => ({
      taskId: `${assigneeId}-${score}`, rowId: '1.1', rowTitle: '', assigneeId, title: '', deadline: '', result: '',
      docName: '', docNumber: '', score, doneAt: doneAt.toISOString(),
    });
    const reports: Report[] = [
      { weekStart: '2026-01-02', submittedAt: '', entries: [entry(2, 5, new Date(2026, 0, 5))] },
      { weekStart: '2026-09-11', submittedAt: '', entries: [entry(1, 2.5, new Date(2026, 8, 15)), entry(1, 2, new Date(2026, 8, 16))] },
    ];
    const month = kpiByEmployee(reports, 'month', NOW);
    expect(month[0]).toEqual({ employeeId: 1, total: 4.5, count: 2, excluded: false });
    expect(month.find((r) => r.employeeId === 2)?.total).toBe(0);
    expect(kpiByEmployee(reports, 'all', NOW)[0]).toEqual({ employeeId: 2, total: 5, count: 1, excluded: false });
    expect(month).toHaveLength(7);

    const context = employeeScoreContext(reports.flatMap((report) => report.entries), 1, 7);
    expect(context).toEqual({ employeeTotal: 4.5, departmentTotal: 9.5, departmentAverage: 1.4, relativeToAverage: 331.6, contribution: 47.4, excluded: false });
    expect(employeeScoreContext([], 1, 7)).toEqual({ employeeTotal: 0, departmentTotal: 0, departmentAverage: 0, relativeToAverage: null, contribution: null, excluded: false });
  });

  describe('правила подсчёта баллов', () => {
    // Сотрудники 1 и 2 — «Руководство» (g-1), 3 и 4 — «Проектная группа 1» (g-2), 5 и 6 — «Проектная группа 2» (g-3).
    const done = new Date(2026, 8, 15);
    const entry = (assigneeId: number, score: number) => ({
      taskId: `t-${assigneeId}`, rowId: '1.1', rowTitle: '', assigneeId, title: '', deadline: '', result: '',
      docName: '', docNumber: '', score, doneAt: done.toISOString(),
    });
    const reports: Report[] = [{ weekStart: '2026-09-11', submittedAt: '', entries: [entry(1, 10), entry(3, 6), entry(5, 4)] }];
    const ctx = (over: Partial<ScoringSettings> = {}): ScoringContext => ({
      scoring: { ...DEFAULT_SCORING, ...over },
      users: DEFAULT_USERS,
      units: DEFAULT_UNITS,
    });

    it('без настроек считаются все сотрудники', () => {
      expect(excludedFromScoring(ctx()).size).toBe(0);
      const rows = kpiByEmployee(reports, 'month', NOW, ctx());
      expect(rows[0]).toMatchObject({ employeeId: 1, total: 10, excluded: false });
    });

    it('исключённое подразделение не входит в общую оценку, но баллы сохраняются', () => {
      const excluded = excludedFromScoring(ctx({ excludedUnitIds: ['g-1'] }));
      expect([...excluded].sort((a, b) => a - b)).toEqual([1, 2]);
      const rows = kpiByEmployee(reports, 'month', NOW, ctx({ excludedUnitIds: ['g-1'] }));
      // Баллы руководителя видны, но он ушёл вниз списка.
      expect(rows.find((r) => r.employeeId === 1)).toMatchObject({ total: 10, excluded: true });
      expect(rows[0].excluded).toBe(false);
      expect(rows.at(-1)!.excluded).toBe(true);
    });

    it('исключение убирает баллы из итога и среднего', () => {
      const all = employeeScoreContext(reports[0].entries, 3, 7, ctx());
      expect(all.departmentTotal).toBe(20);
      const without = employeeScoreContext(reports[0].entries, 3, 7, ctx({ excludedUnitIds: ['g-1'] }));
      // Осталось 10 баллов на 5 сотрудников: семеро минус двое из руководства.
      expect(without.departmentTotal).toBe(10);
      expect(without.departmentAverage).toBe(2);
      expect(without.excluded).toBe(false);
      expect(employeeScoreContext(reports[0].entries, 1, 7, ctx({ excludedUnitIds: ['g-1'] })).excluded).toBe(true);
    });

    it('знаменатель среднего выбирается настройкой', () => {
      const staff = employeeScoreContext(reports[0].entries, 3, 7, ctx());
      // Все семеро: 20 / 7.
      expect(staff.departmentAverage).toBe(2.9);
      const withScore = employeeScoreContext(reports[0].entries, 3, 7, ctx({ averageBase: 'withScore' }));
      // Только трое, у кого есть баллы: 20 / 3.
      expect(withScore.departmentAverage).toBe(6.7);
    });

    it('поимённое исключение работает наравне с подразделением', () => {
      expect([...excludedFromScoring(ctx({ excludedEmployeeIds: [3] }))]).toEqual([3]);
    });

    it('разрез по направлениям даёт общий и средний балл', () => {
      const directions = kpiByDirection(reports, 'month', NOW, ctx({ averageBase: 'withScore' }));
      const first = directions.find((d) => d.name === 'Руководство')!;
      expect(first).toMatchObject({ total: 10, average: 10, count: 1, excluded: false });
      const second = directions.find((d) => d.name === 'Проектная группа 1')!;
      expect(second).toMatchObject({ total: 6, average: 6 });
      // Направление без баллов остаётся в списке с нулём.
      expect(directions.some((d) => d.total === 0)).toBe(true);
    });

    it('полностью исключённое направление помечается и уходит вниз', () => {
      const directions = kpiByDirection(reports, 'month', NOW, ctx({ excludedUnitIds: ['g-1'] }));
      // Баллы направления остаются видимыми, хотя в итог отдела оно не входит.
      expect(directions.at(-1)).toMatchObject({ name: 'Руководство', excluded: true, total: 10 });
      expect(directions[0].excluded).toBe(false);
    });
  });

  it('выгружает CSV с экранированием и BOM', () => {
    const csv = reportToCsv(
      {
        weekStart: '2026-09-11',
        submittedAt: '',
        entries: [{ taskId: 't', rowId: '1.1', rowTitle: 'Поз', assigneeId: 1, title: 'Текст; с "кавычками"', deadline: NOW.toISOString(), result: '', docName: 'Док', docNumber: '5', score: 2.5, doneAt: '' }],
      },
      () => 'Иванов',
    );
    expect(csv.startsWith('﻿Позиция;')).toBe(true);
    expect(csv).toContain('"Текст; с ""кавычками"""');
    expect(csv).toContain('Док № 5;2,5');
  });
});

describe('хранилище', () => {
  const MANAGER: User = { email: 'user@example.com', employeeId: 1, role: 'manager' };
  const ADMIN: User = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
  const EXECUTOR: User = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' };
  const seed = (user: User = MANAGER): AppState => ({ ...createSeed(NOW), user });

  it('демонстрационные данные согласованы', () => {
    const s = createSeed(NOW);
    const ids = new Set(s.tasks.map((t) => t.id));
    expect(ids.size).toBe(s.tasks.length);
    for (const t of s.tasks) {
      expect(validateTask(t)).toEqual({});
      expect(new Date(t.end) >= new Date(t.start)).toBe(true);
    }
    expect(s.reports.at(-1)?.weekStart).toBe('2026-09-04');
    expect(s.reports.at(-1)?.entries.length).toBeGreaterThan(0);
    expect(bucketize(s.tasks, null, NOW).overdue.length).toBeGreaterThan(0);
  });

  it('создаёт, изменяет и удаляет задачу', () => {
    let s = seed();
    const count = s.tasks.length;
    const { id: _omit, doneAt: _d, ...draft } = task({ title: 'Новая' });
    s = reducer(s, { type: 'saveTask', draft, now: NOW });
    expect(s.tasks).toHaveLength(count + 1);
    const created = s.tasks.at(-1)!;
    expect(created.id).not.toBe('t1');

    s = reducer(s, { type: 'saveTask', draft: { ...created, done: true, result: 'Сделано' }, now: NOW });
    const updated = s.tasks.find((t) => t.id === created.id)!;
    expect(updated.done).toBe(true);
    expect(updated.doneAt).toBe(NOW.toISOString());

    // Повторное сохранение не сдвигает дату исполнения.
    s = reducer(s, { type: 'saveTask', draft: { ...updated, title: 'Переименована' }, now: new Date(2026, 9, 1) });
    expect(s.tasks.find((t) => t.id === created.id)!.doneAt).toBe(NOW.toISOString());

    s = reducer(s, { type: 'deleteTask', id: created.id });
    expect(s.tasks).toHaveLength(count);
  });

  it('снимает отметку исполнения вместе с датой', () => {
    let s = seed();
    const done = s.tasks.find((t) => t.done)!;
    s = reducer(s, { type: 'saveTask', draft: { ...done, done: false } });
    expect(s.tasks.find((t) => t.id === done.id)!.doneAt).toBeNull();
  });

  it('хранит баллы задачи в пределах 0,1–15 и сбрасывает к базовым', () => {
    let s = seed();
    const t = s.tasks.find((x) => x.rowId === '1.1')!;
    s = reducer(s, { type: 'saveTask', draft: { ...t, score: 20 } });
    expect(s.tasks.find((x) => x.id === t.id)!.score).toBe(15);
    s = reducer(s, { type: 'saveTask', draft: { ...t, score: null } });
    expect(s.tasks.find((x) => x.id === t.id)!.score).toBeNull();
    expect(validateTask({ ...t, score: Number.NaN }).score).toBeDefined();
  });

  it('исполнитель меняет только исполнение своих задач', () => {
    let s = seed(EXECUTOR);
    const own = s.tasks.find((x) => x.assigneeIds.includes(3) && !x.done)!;
    const other = s.tasks.find((x) => !x.assigneeIds.includes(3))!;
    s = reducer(s, { type: 'saveTask', draft: { ...own, title: 'Взлом', score: 15, assigneeIds: [1], result: 'Готово', done: true } });
    const saved = s.tasks.find((x) => x.id === own.id)!;
    expect(saved).toMatchObject({ title: own.title, score: own.score, assigneeIds: own.assigneeIds, result: 'Готово', done: true });
    const before = s;
    s = reducer(s, { type: 'saveTask', draft: { ...other, result: 'чужое', done: true } });
    expect(s).toBe(before);
    expect(reducer(s, { type: 'deleteTask', id: own.id })).toBe(s);
    expect(reducer(s, { type: 'submitReport', weekStart: planWeekStart(NOW) })).toBe(s);
    expect(reducer(s, { type: 'reset' })).toBe(s);
  });

  it('исполнитель создаёт задачу только себе и без индивидуальных баллов', () => {
    let s = seed(EXECUTOR);
    const { id: _i, doneAt: _d, ...draft } = task({ title: 'Своя', assigneeIds: [1, 5], score: 9 });
    s = reducer(s, { type: 'saveTask', draft });
    expect(s.tasks.at(-1)).toMatchObject({ title: 'Своя', assigneeIds: [3], score: null });
  });

  it('определяет доступ к задаче по роли', () => {
    const own = task({ assigneeIds: [3] });
    expect(taskAccess(MANAGER, own)).toEqual({ plan: true, execution: true, score: true, delete: true });
    expect(taskAccess(EXECUTOR, own)).toEqual({ plan: false, execution: true, score: false, delete: false });
    expect(taskAccess(EXECUTOR, task({ assigneeIds: [4] })).execution).toBe(false);
    expect(taskAccess(EXECUTOR, null).plan).toBe(true);
    expect(taskAccess(null, own).execution).toBe(false);
  });

  it('переносит данные версии 1: вес строки — в задачи, роль — из карточки', () => {
    const v1 = {
      version: 1,
      tasks: [{ ...task(), category: undefined, score: undefined }, { ...task({ id: 't2', rowId: '2.1' }), category: undefined, score: undefined }],
      reports: [],
      messages: [],
      user: { email: 'sidorov@example.com', employeeId: 3 },
      scores: { '1.1': 9 },
    };
    const m = migrate(v1 as never);
    expect(m.version).toBe(5);
    expect(m.absences).toEqual([]);
    expect(m.tasks.map((t) => [t.score, t.category])).toEqual([[9, null], [null, null]]);
    expect(m.user?.role).toBe('executor');
  });

  it('отправляет отчёт текущей недели', () => {
    let s = seed();
    const before = s.reports.length;
    s = reducer(s, { type: 'submitReport', weekStart: planWeekStart(NOW), now: NOW });
    expect(s.reports).toHaveLength(before + 1);
    s = reducer(s, { type: 'submitReport', weekStart: planWeekStart(NOW), now: NOW });
    expect(s.reports).toHaveLength(before + 1);
    expect(s.reports.at(-1)!.entries.length).toBeGreaterThan(0);
  });

  it('не отправляет пустое сообщение и сообщение без входа', () => {
    let s = seed();
    const n = s.messages.length;
    s = reducer(s, { type: 'sendMessage', text: '   ' });
    expect(s.messages).toHaveLength(n);
    s = reducer({ ...s, user: null }, { type: 'sendMessage', text: 'Привет' });
    expect(s.messages).toHaveLength(n);
    s = reducer(seed(), { type: 'sendMessage', text: '  Привет  ' });
    expect(s.messages.at(-1)).toMatchObject({ authorId: 1, text: 'Привет' });
  });

  it('считает непрочитанные сообщения и отмечает прочитанное', () => {
    const at = (h: number) => new Date(2026, 8, 21, h).toISOString();
    let s: AppState = { ...seed(), messages: [
      { id: 'a', authorId: 2, text: 'раз', sentAt: at(9) },
      { id: 'b', authorId: 1, text: 'моё', sentAt: at(10) },
      { id: 'c', authorId: 3, text: 'два', sentAt: at(11) },
    ], chatReads: [] };
    // Ещё не открывал — непрочитаны все чужие.
    expect(unreadMessages(s.messages, s.chatReads, 1).map((m) => m.id)).toEqual(['a', 'c']);
    s = reducer(s, { type: 'markChatRead', now: new Date(2026, 8, 21, 10, 30) });
    expect(unreadMessages(s.messages, s.chatReads, 1).map((m) => m.id)).toEqual(['c']);
    // Отметка назад не двигается, у других сотрудников не меняется.
    s = reducer(s, { type: 'markChatRead', now: new Date(2026, 8, 21, 8) });
    expect(s.chatReads).toEqual([{ employeeId: 1, readAt: new Date(2026, 8, 21, 10, 30).toISOString() }]);
    expect(unreadMessages(s.messages, s.chatReads, 3).map((m) => m.id)).toEqual(['a', 'b']);
    // Своё сообщение — всё до него прочитано.
    s = reducer(s, { type: 'sendMessage', text: 'ответ', now: new Date(2026, 8, 21, 12) });
    expect(unreadMessages(s.messages, s.chatReads, 1)).toEqual([]);
    expect(reducer({ ...s, user: null }, { type: 'markChatRead' }).chatReads).toBe(s.chatReads);
  });

  it('сброс сохраняет вход пользователя', () => {
    const s = reducer({ ...seed(ADMIN), tasks: [] }, { type: 'reset', now: NOW });
    expect(s.user?.employeeId).toBe(1);
    expect(s.tasks.length).toBeGreaterThan(0);
  });

  it('администратор назначает роли, а руководитель не меняет пользователей', () => {
    const adminState = seed(ADMIN);
    const changed = reducer(adminState, { type: 'saveManagedUser', employeeId: 3, role: 'manager', active: true });
    expect(changed.users.find((user) => user.employeeId === 3)?.role).toBe('manager');
    const managerState = seed(MANAGER);
    expect(reducer(managerState, { type: 'saveManagedUser', employeeId: 3, role: 'manager', active: true })).toBe(managerState);
  });

  it('удаляет пользователя, но защищает текущую учётную запись и последнего администратора', () => {
    const s = seed(ADMIN);
    const changed = reducer(s, { type: 'deleteManagedUser', employeeId: 3 });
    expect(changed.users.some((user) => user.employeeId === 3)).toBe(false);
    expect(reducer(s, { type: 'deleteManagedUser', employeeId: 1 })).toBe(s);
    const otherAdmin = { ...s.users[1], role: 'administrator' as const, active: true };
    const withOtherAdmin = { ...s, users: [...s.users.slice(0, 1), otherAdmin, ...s.users.slice(2)] };
    expect(reducer(withOtherAdmin, { type: 'deleteManagedUser', employeeId: 2 }).users.some((user) => user.employeeId === 2)).toBe(false);
  });

  it('не позволяет убрать права у последнего администратора', () => {
    const s = seed(ADMIN);
    const changed = reducer(s, { type: 'saveRolePermissions', role: 'administrator', permissions: ['tasks.plan'] });
    expect(changed).toBe(s);
    const executor = reducer(s, { type: 'saveRolePermissions', role: 'executor', permissions: ['tasks.execute', 'reports.view'] });
    expect(executor.roles.find((role) => role.role === 'executor')?.permissions).toContain('reports.view');
  });

  it('администратор добавляет, редактирует и удаляет свободную позицию плана', () => {
    const s = seed(ADMIN);
    const added = reducer(s, { type: 'savePlanRow', draft: { id: '1.9', title: 'Новая позиция', isHeader: false, baseScore: 3 } });
    expect(added.planRows).toContainEqual({ id: '1.9', title: 'Новая позиция', isHeader: false, baseScore: 3 });
    const renamed = reducer(added, { type: 'savePlanRow', draft: { originalId: '1.9', id: '1.10', title: 'Уточнённая позиция', isHeader: false, baseScore: 4 } });
    expect(renamed.planRows).toContainEqual({ id: '1.10', title: 'Уточнённая позиция', isHeader: false, baseScore: 4 });
    const removed = reducer(renamed, { type: 'deletePlanRow', id: '1.10' });
    expect(removed.planRows.some((row) => row.id === '1.10')).toBe(false);
  });

  it('родитель позиции — существующий раздел; раздел переезжает вместе с вложенными позициями и задачами', () => {
    const s = seed(ADMIN);
    // Нет раздела «5» и нельзя вложить в рабочую позицию.
    expect(reducer(s, { type: 'savePlanRow', draft: { id: '5.1', title: 'Сирота', isHeader: false, baseScore: 3 } })).toBe(s);
    expect(reducer(s, { type: 'savePlanRow', draft: { id: '2.1.1', title: 'Во вложении', isHeader: false, baseScore: 3 } })).toBe(s);
    const tasksBefore = s.tasks.filter((t) => t.rowId === '3.1.2').length;
    expect(tasksBefore).toBeGreaterThan(0);
    const moved = reducer(s, { type: 'savePlanRow', draft: { originalId: '3.1', id: '2.9', title: 'Разработка программных модулей', isHeader: true, baseScore: 0 } });
    expect(moved.planRows.some((r) => r.id.startsWith('3.1'))).toBe(false);
    expect(moved.planRows.filter((r) => r.id.startsWith('2.9.'))).toHaveLength(13);
    expect(moved.tasks.filter((t) => t.rowId === '2.9.2')).toHaveLength(tasksBefore);
    expect(moved.tasks.some((t) => t.rowId?.startsWith('3.1.'))).toBe(false);
    // В собственное поддерево переносить нельзя, раздел с вложенными нельзя сделать рабочей позицией.
    expect(reducer(s, { type: 'savePlanRow', draft: { originalId: '3.1', id: '3.1.20', title: 'x', isHeader: true, baseScore: 0 } })).toBe(s);
    expect(reducer(s, { type: 'savePlanRow', draft: { originalId: '3.1', id: '3.1', title: 'x', isHeader: false, baseScore: 2 } })).toBe(s);
  });
});

describe('подразделения', () => {
  const ADMIN: User = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
  const seed = (user: User): AppState => ({ ...createSeed(NOW), user });
  it('иерархия: организация → управление → отдел → отделение, родитель строго уровнем выше', () => {
    const s = seed(ADMIN);
    const bad = reducer(s, { type: 'saveUnit', draft: { parentId: 'u-org', kind: 'section', name: 'Отделение прямо в организации' } });
    expect(bad).toBe(s);
    const orphan = reducer(s, { type: 'saveUnit', draft: { parentId: null, kind: 'department', name: 'Отдел без управления' } });
    expect(orphan).toBe(s);
    const added = reducer(s, { type: 'saveUnit', draft: { parentId: 'u-dept-dev', kind: 'section', name: 'Отделение внедрения' } });
    const unit = added.units.find((u) => u.name === 'Отделение внедрения')!;
    expect(unit).toMatchObject({ parentId: 'u-dept-dev', kind: 'section' });
    // Непустое подразделение удалить нельзя, пустое — можно.
    expect(reducer(added, { type: 'deleteUnit', id: 'g-2' })).toBe(added);
    expect(reducer(added, { type: 'deleteUnit', id: 'u-dir-it' })).toBe(added);
    expect(reducer(added, { type: 'deleteUnit', id: unit.id }).units.some((u) => u.id === unit.id)).toBe(false);
  });

  it('пользователь переводится в другое подразделение, несуществующее — отклоняется', () => {
    const s = seed(ADMIN);
    const moved = reducer(s, { type: 'saveManagedUser', employeeId: 3, role: 'executor', active: true, unitId: 'g-3' });
    expect(moved.users.find((u) => u.employeeId === 3)?.unitId).toBe('g-3');
    expect(reducer(s, { type: 'saveManagedUser', employeeId: 3, role: 'executor', active: true, unitId: 'нет-такого' })).toBe(s);
  });
});

describe('раскладка календаря', () => {
  const day = new Date(2026, 8, 17);
  const at = (d: number, h: number) => new Date(2026, 8, d, h).toISOString();

  it('не показывает задачи других дней', () => {
    const placed = layoutDay(
      [task({ id: 'prev', start: at(16, 9), end: at(16, 10) }), task({ id: 'next', start: at(18, 9), end: at(18, 10) })],
      day,
    );
    expect(placed).toEqual([]);
  });

  it('раскладывает пересечения по дорожкам и обрезает по границам дня', () => {
    const placed = layoutDay(
      [
        task({ id: 'a', start: at(17, 9), end: at(17, 11) }),
        task({ id: 'b', start: at(17, 10), end: at(17, 12) }),
        task({ id: 'c', start: at(17, 12), end: at(17, 13) }),
        task({ id: 'long', start: at(16, 20), end: at(17, 8) }),
      ],
      day,
    );
    const byId = Object.fromEntries(placed.map((p) => [p.task.id, p]));
    expect(byId.a).toMatchObject({ lane: 0, lanes: 2, top: 2, height: 2 });
    expect(byId.b).toMatchObject({ lane: 1, lanes: 2 });
    expect(byId.c).toMatchObject({ lane: 0, lanes: 1, top: 5 });
    expect(byId.long).toMatchObject({ top: 0, height: 1 });
  });
});

describe('поиск', () => {
  const list = [
    task({ id: 'a', title: 'Доклад о ходе внедрения', category: 'reportDept' }),
    task({ id: 'b', title: 'Сборка модуля', result: 'Передано на тестирование', assigneeIds: [4] }),
    task({ id: 'c', title: 'Журнал', docNumber: 'ЖР-2026', rowId: '4.1' }),
  ];
  const ids = (q: string) => searchTasks(list, q).map((t) => t.id);

  it('ищет по названию, результату, документу, позиции, категории и исполнителю', () => {
    expect(ids('доклад')).toEqual(['a']);
    expect(ids('тестирование')).toEqual(['b']);
    expect(ids('жр-2026')).toEqual(['c']);
    expect(ids('регистрация входящих')).toEqual(['c']);
    expect(ids('руководству отдела')).toEqual(['a']);
    expect(ids('кузнецов')).toEqual(['b']);
  });

  it('не различает регистр и ё/е, требует все слова, пустой запрос — всё', () => {
    expect(ids('СБОРКА')).toEqual(['b']);
    expect(ids('ход внедрения')).toEqual(['a']);
    expect(ids('сборка журнал')).toEqual([]);
    expect(ids('   ')).toEqual(['a', 'b', 'c']);
    expect(searchTasks([task({ title: 'Отчёт' })], 'отчет')).toHaveLength(1);
  });
});
