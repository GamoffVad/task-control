// Начало периода показателей (с 1-го числа месяца) и обнуление показателей.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, DEFAULT_USERS } from '../lib/access';
import { periodStart, startOfMonth, toDateKey } from '../lib/dates';
import { entriesInPeriod, kpiByEmployee } from '../lib/logic';
import { fromData, reducer, toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Report, ReportEntry } from '../lib/types';

const NOW = new Date(2026, 9, 9, 15, 0); // 9 октября 2026

const entry = (assigneeId: number, doneAt: string, score = 5): ReportEntry => ({
  taskId: `t-${assigneeId}-${doneAt}`, rowId: '1.1', rowTitle: 'x', assigneeId, title: 'z', deadline: doneAt, result: 'ok', docName: '', docNumber: '', score, doneAt,
});
const report = (weekStart: string, entries: ReportEntry[]): Report => ({ weekStart, submittedAt: `${weekStart}T12:00:00.000Z`, entries });

describe('начало периода показателей', () => {
  it('отсчёт идёт с 1-го числа месяца', () => {
    expect(toDateKey(periodStart('month', NOW)!)).toBe('2026-09-01');
    expect(toDateKey(periodStart('quarter', NOW)!)).toBe('2026-07-01');
    expect(toDateKey(periodStart('half', NOW)!)).toBe('2026-04-01');
    expect(toDateKey(periodStart('year', NOW)!)).toBe('2025-10-01');
    expect(periodStart('all', NOW)).toBeNull();
  });

  it('не зависит от числа, на которое приходится «сегодня»', () => {
    for (const day of [1, 9, 31]) {
      const now = new Date(2026, 9, day, 10, 0);
      expect(toDateKey(periodStart('month', now)!)).toBe('2026-09-01');
    }
    // Конец месяца с разной длиной: 31 мая минус месяц — не «31 апреля», а 1 апреля.
    expect(toDateKey(periodStart('month', new Date(2026, 4, 31))!)).toBe('2026-04-01');
    expect(startOfMonth(new Date(2026, 1, 28, 23, 59)).getDate()).toBe(1);
  });

  it('баллы с 1-го числа входят в период, а за день до — нет', () => {
    const reports = [report('2026-08-28', [entry(3, new Date(2026, 7, 31, 23, 0).toISOString())]), report('2026-09-04', [entry(3, new Date(2026, 8, 1, 0, 30).toISOString(), 7)])];
    const rows = kpiByEmployee(reports, 'month', NOW);
    expect(rows.find((r) => r.employeeId === 3)).toMatchObject({ total: 7, count: 1 });
    expect(entriesInPeriod(reports, 'month', NOW)).toHaveLength(1);
    expect(entriesInPeriod(reports, 'all', NOW)).toHaveLength(2);
  });
});

describe('обнуление показателей', () => {
  const stateFor = (employeeId: number) => {
    const seed = createSeed(NOW);
    const account = DEFAULT_USERS.find((u) => u.employeeId === employeeId)!;
    const data = { ...toData(seed), roles: DEFAULT_ROLES, reports: [report('2026-08-07', [entry(3, '2026-08-08T10:00:00.000Z')]), report('2026-09-11', [entry(3, '2026-09-12T10:00:00.000Z')])] };
    return fromData(data, { email: account.email, employeeId, role: account.role });
  };

  it('удаляет все отчёты, а задачи не трогает', () => {
    const s = stateFor(1);
    const next = reducer(s, { type: 'resetScores' });
    expect(next.reports).toEqual([]);
    expect(next.tasks).toEqual(s.tasks);
    expect(kpiByEmployee(next.reports, 'all', NOW).every((r) => r.total === 0)).toBe(true);
  });

  it('удаляет отчёты недель до даты и оставляет остальные', () => {
    const next = reducer(stateFor(1), { type: 'resetScores', before: '2026-09-01' });
    expect(next.reports.map((r) => r.weekStart)).toEqual(['2026-09-11']);
  });

  it('при пустом списке отчётов возвращает новое состояние: сервер не примет это за отказ в праве', () => {
    const s = reducer(stateFor(1), { type: 'resetScores' });
    expect(reducer(s, { type: 'resetScores' })).not.toBe(s);
  });

  it('без права на правила оценки ничего не меняет', () => {
    const s = stateFor(3);
    expect(reducer(s, { type: 'resetScores' })).toBe(s);
    expect(reducer(stateFor(2), { type: 'resetScores', before: '2026-09-01' })).toEqual(stateFor(2));
  });
});
