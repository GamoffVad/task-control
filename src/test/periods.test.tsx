import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { addDays, reportEnd, toDateKey } from '../lib/dates';
import { buildReportEntries, entriesInPeriod, tasksInWeek } from '../lib/logic';
import { DEFAULT_PERIOD_SETTINGS, normalizePeriodSettings, validPeriodSettings, validReportRange, weeklyPeriodDays, weeklyPeriodEnd, weeklyPeriodStart } from '../lib/periods';
import { planDocContext, planItems } from '../lib/planExport';
import { fromData, migrate, reducer, toData } from '../lib/reducer';
import { reportDocContext } from '../lib/reportExport';
import { createSeed } from '../lib/seed';
import { loadState } from '../lib/store';
import { StoreProvider } from '../lib/StoreProvider';
import type { AppState, PeriodSettings, Task } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 8, 17, 12);
const SETTINGS: PeriodSettings = { planning: { startDay: 1, endDay: 5 }, reporting: { startDay: 2, endDay: 1 } };
const state = (): AppState => ({ ...createSeed(NOW), periodSettings: SETTINGS, reports: [], user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const task = (id: string, date: string): Task => ({ ...state().tasks[0], id, title: id, rowId: '1.1', assigneeIds: [1], done: true, end: date, doneAt: date });
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());

describe('настраиваемые недельные периоды', () => {
  it('по умолчанию сохраняет пятницу — четверг, любые границы включительны', () => {
    expect(normalizePeriodSettings()).toEqual(DEFAULT_PERIOD_SETTINGS);
    expect(toDateKey(weeklyPeriodStart(NOW, DEFAULT_PERIOD_SETTINGS.planning))).toBe('2026-09-11');
    for (let startDay = 0; startDay <= 6; startDay++) for (let endDay = 0; endDay <= 6; endDay++) {
      const p = { startDay, endDay };
      const from = weeklyPeriodStart(NOW, p);
      const to = weeklyPeriodEnd(from, p);
      expect(from.getDay()).toBe(startDay);
      expect(to.getDay()).toBe(endDay);
      expect(from.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(addDays(from, 7).getTime()).toBeGreaterThan(NOW.getTime());
      expect(weeklyPeriodDays(p)).toBeGreaterThanOrEqual(1);
      expect(weeklyPeriodDays(p)).toBeLessThanOrEqual(7);
      expect(validReportRange(from, to)).toBe(true);
    }
    const from = weeklyPeriodStart(new Date(2027, 0, 1), { startDay: 1, endDay: 0 });
    expect(toDateKey(from)).toBe('2026-12-28');
    expect(toDateKey(weeklyPeriodEnd(from, { startDay: 1, endDay: 0 }))).toBe('2027-01-03');
  });
  it('проверяет настройки и допускает изменение только с нужным разрешением', () => {
    for (const bad of [null, {}, { planning: { startDay: 7, endDay: 0 }, reporting: SETTINGS.reporting }, { ...SETTINGS, reporting: { startDay: '2', endDay: 1 } }]) expect(validPeriodSettings(bad)).toBe(false);
    const s = state();
    expect(reducer(s, { type: 'savePeriodSettings', settings: DEFAULT_PERIOD_SETTINGS }).periodSettings).toEqual(DEFAULT_PERIOD_SETTINGS);
    const executor = { ...s, user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' as const } };
    expect(reducer(executor, { type: 'savePeriodSettings', settings: DEFAULT_PERIOD_SETTINGS })).toBe(executor);
    expect(validReportRange(NOW, addDays(NOW, 7))).toBe(false);
    expect(validReportRange(NOW, addDays(NOW, -1))).toBe(false);
  });
  it('сохраняет настройки при перезагрузке и переносит новые права старому администратору', () => {
    const s = state();
    expect(migrate(s).periodSettings).toEqual(SETTINGS);
    expect(fromData(toData(s), s.user).periodSettings).toEqual(SETTINGS);
    const old = { ...s, periodSettings: undefined, roles: s.roles.map((r) => ({ ...r, permissions: r.permissions.filter((p) => p !== 'periods.manage') })) };
    const next = migrate(old);
    expect(next.periodSettings).toEqual(DEFAULT_PERIOD_SETTINGS);
    expect(next.user?.permissions).toContain('periods.manage');
  });
  it('план и выгрузка используют свои даты, отчёт — свои; включает конец дня', () => {
    const s = state();
    s.tasks = [task('до плана', '2026-09-13T23:59:59'), task('первый день', '2026-09-14T00:00:00'), task('последний день', '2026-09-18T23:59:59'), task('после плана', '2026-09-19T00:00:00')];
    const from = weeklyPeriodStart(NOW, SETTINGS.planning);
    const end = weeklyPeriodEnd(from, SETTINGS.planning);
    expect(tasksInWeek(s.tasks, from, end).map((t) => t.id)).toEqual(['первый день', 'последний день']);
    const items = planItems(s.tasks, s.planRows, from, [1], end);
    expect(planDocContext(items, s.planRows, from, s.user, NOW, end)).toMatchObject({ с: '14.09.2026', по: '18.09.2026', всего: 2 });
    const reportStart = weeklyPeriodStart(from, SETTINGS.reporting);
    const reportFinish = weeklyPeriodEnd(reportStart, SETTINGS.reporting);
    expect(buildReportEntries(s, reportStart, reportFinish).map((e) => e.taskId)).toEqual(['до плана', 'первый день']);
    const next = reducer(s, { type: 'submitReport', weekStart: reportStart, now: NOW });
    expect(next.reports[0]).toMatchObject({ weekStart: '2026-09-08', periodEnd: '2026-09-14' });
  });
  it('отправленный отчёт сохраняет конец периода после смены настройки, старые остаются семидневными', () => {
    const s = reducer(state(), { type: 'submitReport', weekStart: new Date(2026, 8, 8), periodEnd: new Date(2026, 8, 10), now: NOW });
    const changed = reducer(s, { type: 'savePeriodSettings', settings: DEFAULT_PERIOD_SETTINGS });
    expect(reportDocContext(changed.reports[0], s.planRows, new Date(2026, 8, 8), s.user, NOW)).toMatchObject({ с: '08.09.2026', по: '10.09.2026' });
    expect(toDateKey(reportEnd({ weekStart: '2026-09-04' }))).toBe('2026-09-10');
    expect(reducer(s, { type: 'submitReport', weekStart: NOW, periodEnd: addDays(NOW, 7) })).toBe(s);
  });
  it('перекрывающиеся отчёты после смены границ не удваивают баллы задачи', () => {
    const s = state(); s.tasks = [task('общая', '2026-09-14T12:00:00')];
    const entries = buildReportEntries(s, new Date(2026, 8, 14));
    const reports = [{ weekStart: '2026-09-11', submittedAt: '2026-09-17', entries }, { weekStart: '2026-09-14', submittedAt: '2026-09-20', entries: entries.map((e) => ({ ...e, score: 9 })) }];
    expect(entriesInPeriod(reports, 'all', NOW)).toHaveLength(1);
    expect(entriesInPeriod(reports, 'all', NOW)[0].score).toBe(9);
  });
  it('настройки сохраняются в администрировании и применяются к планированию', async () => {
    render(<StoreProvider initial={state()}><MemoryRouter initialEntries={['/admin']}><AppRoutes /></MemoryRouter></StoreProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Периоды' }));
    await user.click(screen.getByRole('button', { name: /^Плановый период: последний день/ }));
    await user.type(screen.getByRole('combobox', { name: 'Поиск: Плановый период: последний день' }), 'воскрес');
    await user.click(screen.getByRole('option', { name: 'Воскресенье' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить периоды' }));
    expect(screen.getByRole('status')).toHaveTextContent('Периоды сохранены');
    expect(loadState().periodSettings?.planning).toEqual({ startDay: 1, endDay: 0 });
    await user.click(screen.getByRole('link', { name: 'Планирование' }));
    expect(document.querySelector('.stepper')).toHaveTextContent('14 – 20 сентября');
    expect(screen.getByText(/Понедельник — воскресенье/)).toBeInTheDocument();
  });
  it('направляет отчёт с отдельными границами из планирования', async () => {
    const s = state(); s.tasks = [task('до плана', '2026-09-13T23:59:59'), task('в плане', '2026-09-18T12:00:00')];
    render(<StoreProvider initial={s}><MemoryRouter initialEntries={['/planning']}><AppRoutes /></MemoryRouter></StoreProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Направить в отчёт/ }));
    expect(loadState().reports[0]).toMatchObject({ weekStart: '2026-09-08', periodEnd: '2026-09-14' });
    expect(loadState().reports[0].entries.map((e) => e.taskId)).toEqual(['до плана']);
  });
  it('история открывает отчёт со старой границей; новый формируется по настройкам', async () => {
    const s = state();
    s.reports = [{ weekStart: '2026-09-04', submittedAt: NOW.toISOString(), entries: [] }];
    s.tasks = [task('исполнено', '2026-09-10T12:00:00')];
    render(<StoreProvider initial={s}><MemoryRouter initialEntries={['/reports']}><AppRoutes /></MemoryRouter></StoreProvider>);
    const user = userEvent.setup();
    expect(document.querySelector('.stepper')).toHaveTextContent('8 – 14 сентября');
    await user.click(screen.getByRole('button', { name: 'Направить в отчёт' }));
    expect(loadState().reports.find((r) => r.weekStart === '2026-09-08')?.periodEnd).toBe('2026-09-14');
    await user.click(screen.getByRole('button', { name: /^Отправленные отчёты/ }));
    await user.click(screen.getByRole('option', { name: '04.09.2026 — 10.09.2026' }));
    expect(document.querySelector('.stepper')).toHaveTextContent('4 – 10 сентября');
    expect(within(screen.getByRole('main')).getByText('Отчёт за этот период отправлен без исполненных задач.')).toBeInTheDocument();
  });
});
