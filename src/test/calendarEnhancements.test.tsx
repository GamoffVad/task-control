import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { AbsencePanel } from '../components/AbsencePanel';
import { calendarMinutesAt, calendarOffset, calendarSlotHeights } from '../lib/calendarScale';
import { storeCalendarView } from '../lib/calendarView';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import type { CalendarView, ReportEntry, Task } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 9, 26, 12);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
afterEach(() => vi.restoreAllMocks());
const task = (id: string, assigneeIds: number[]): Task => ({ id, title: `Описание ${id}`, assigneeIds,
  start: new Date(2026, 9, 26, 9).toISOString(), end: new Date(2026, 9, 26, 9, 30).toISOString(),
  rowId: null, category: null, docName: '', docNumber: '', result: '', done: false, score: null, doneAt: null });
const setup = (view: CalendarView) => {
  storeCalendarView(view, 1);
  render(<StoreProvider initial={{ ...createSeed(NOW), tasks: [task('first', [3]), task('second', [5]), task('shared', [3, 5])],
    user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } }}>
    <MemoryRouter initialEntries={['/calendar']}><AppRoutes /></MemoryRouter>
  </StoreProvider>);
};
const choose = (label: string, name: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole('option', { name }));
};

describe('подразделения и адаптивные карточки календаря', () => {
  it.each<CalendarView>(['day', 'week', 'month'])('фильтрует подразделение и общие задачи в виде %s', (view) => {
    setup(view);
    choose('Группа', 'Проектная группа 1');
    expect(screen.getByText('Описание first')).toBeInTheDocument();
    expect(screen.getByText('Описание shared')).toBeInTheDocument();
    expect(screen.queryByText('Описание second')).not.toBeInTheDocument();
    choose('Сотрудник', 'Сидоров Д.Е.');
    choose('Группа', 'Проектная группа 2');
    expect(screen.getByRole('button', { name: 'Сотрудник: Все сотрудники' })).toBeInTheDocument();
    expect(screen.getByText('Описание second')).toBeInTheDocument();
    expect(screen.queryByText('Описание first')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Сотрудник:/ }));
    expect(screen.queryByRole('option', { name: 'Сидоров Д.Е.' })).not.toBeInTheDocument();
  });

  it.each<CalendarView>(['day', 'week'])('расширяет шкалу под текст и всех исполнителей в виде %s', (view) => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-calendar-content')) return { ...original.call(this), height: 220 };
      return original.call(this);
    });
    setup(view);
    const card = document.querySelector<HTMLElement>('[data-calendar-task="first"]')!;
    expect(parseFloat(card.style.height)).toBeGreaterThanOrEqual(220);
    expect(within(card).getByText('Сидоров Д.Е.')).toBeInTheDocument();
    expect(card.querySelector('[data-calendar-resize="end"]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-calendar-minute="600"]')?.style.height).toBe('20px');
    cleanup();
  });
});

describe('неравномерная временная шкала', () => {
  it('вмещает пересекающиеся и короткие задачи, сохраняя соседние свободные часы', () => {
    const requirements = [{ top: 2, duration: 0.5, pixels: 240 }, { top: 2.25, duration: 0.5, pixels: 330 }, { top: 4, duration: 1, pixels: 80 }];
    const heights = calendarSlotHeights(requirements);
    for (const item of requirements) expect(calendarOffset(heights, item.top + item.duration) - calendarOffset(heights, item.top) - 2).toBeGreaterThanOrEqual(item.pixels);
    expect(heights[0]).toBe(20);
    expect(heights.at(-1)).toBe(20);
  });
  it('переводит указатель в реальное время внутри растянутого интервала', () => {
    const zone = document.createElement('div');
    const slot = document.createElement('button');
    slot.dataset.calendarMinute = '540';
    zone.append(slot);
    vi.spyOn(slot, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300, height: 200 } as DOMRect);
    expect(calendarMinutesAt(zone, 200)).toBe(555);
    expect(calendarMinutesAt(zone, 300)).toBe(570);
  });
});

it('показывает дежурства в выходные отдельно от ручных отгулов', () => {
  const state = createSeed(NOW);
  render(<StoreProvider initial={{ ...state, user: { email: 'user@example.com', employeeId: 1, role: 'administrator' },
    absences: [{ id: 'duty', employeeId: 3, type: 'duty', dutyType: 'regular', from: '2026-10-23', to: '2026-10-25', status: 'approved', note: '', createdAt: NOW.toISOString(), decidedBy: 1 }],
    entitlements: [{ employeeId: 3, year: 2026, vacationDays: 28, carriedOver: 0, dayoffAccrued: 5 }] }}><AbsencePanel id={3} /></StoreProvider>);
  const block = screen.getByLabelText('Дежурства в выходные');
  expect(block.querySelector('.big')).toHaveTextContent('2 дня');
  expect(block).toHaveTextContent('начислено отгулов 2');
});

it('годовые показатели и график считают только исполнения текущего года по сегодня', () => {
  const state = createSeed(NOW);
  const entry = (id: string, date: Date, score: number): ReportEntry => ({ taskId: id, rowId: '1.1', rowTitle: 'Раздел',
    assigneeId: 3, title: id, deadline: date.toISOString(), doneAt: date.toISOString(), score, result: '', docName: '', docNumber: '' });
  render(<StoreProvider initial={{ ...state, user: { email: 'user@example.com', employeeId: 1, role: 'administrator' }, reports: [
    { weekStart: '2025-12-26', submittedAt: NOW.toISOString(), entries: [entry('old', new Date(2025, 11, 31), 99), entry('new', new Date(2026, 0, 1), 5)] },
    { weekStart: '2026-10-30', submittedAt: NOW.toISOString(), entries: [entry('future', new Date(2026, 10, 1), 11)] },
  ] }}><MemoryRouter initialEntries={['/kpi']}><AppRoutes /></MemoryRouter></StoreProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Год' }));
  expect(screen.getByText('01.01.2026')).toBeInTheDocument();
  expect(document.querySelector('.kpi-summary .stat .value')).toHaveTextContent('5');
  expect(screen.getByRole('img', { name: /Баллы по неделям/ })).toHaveAccessibleName(/— 5$/);
  expect(document.querySelectorAll('.week-bars .wb')).toHaveLength(1);
});
