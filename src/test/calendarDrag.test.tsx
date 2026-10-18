import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { StoreProvider } from '../lib/StoreProvider';
import { storeCalendarView } from '../lib/calendarView';
import { movedTaskDates } from '../lib/calendarLayout';
import { createSeed } from '../lib/seed';
import { loadState } from '../lib/store';
import type { CalendarView, Task } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 17, 12));
});
afterAll(() => vi.useRealTimers());
const originalHitTest = document.elementFromPoint;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(2026, 8, 17, 12));
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
});
const flushFrame = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(performance.now())); });
afterEach(() => { cleanup(); vi.clearAllTimers(); document.elementFromPoint = originalHitTest; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const eventTask = (): Task => ({
  id: 'drag-task', rowId: '3.1.2', title: 'Переносимая задача', category: 'reportDept', assigneeIds: [3],
  start: new Date(2026, 8, 17, 9).toISOString(), end: new Date(2026, 8, 17, 11).toISOString(),
  docName: 'Техническое задание', docNumber: '42', result: '', done: false, score: 4, doneAt: null,
});
const eventButton = () => document.querySelector<HTMLButtonElement>('[data-calendar-task="drag-task"]')!;
const savedTask = () => loadState().tasks.find((task) => task.id === 'drag-task')!;

const setup = (view: CalendarView = 'week', executor = false, task = eventTask()) => {
  storeCalendarView(view, executor ? 3 : 1);
  render(<StoreProvider initial={{ ...createSeed(), tasks: [task], user: { email: 'test@example.com', employeeId: executor ? 3 : 1, role: executor ? 'executor' : 'administrator' } }}>
    <MemoryRouter initialEntries={['/calendar']}><AppRoutes /></MemoryRouter>
  </StoreProvider>);
  const zones = [...document.querySelectorAll<HTMLElement>('[data-calendar-day]')];
  zones.forEach((zone, index) => {
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({ x: index * 100, y: 0, left: index * 100, top: 0, right: (index + 1) * 100, bottom: 840, width: 100, height: 840, toJSON: () => ({}) });
  });
  document.elementFromPoint = vi.fn((x, y) => y >= 0 && y < 840 ? zones[Math.floor(x / 100)] ?? null : null);
  eventButton().setPointerCapture = vi.fn();
  return zones;
};
const pointer = (x: number, y: number, pointerType = 'mouse') => ({ button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType, clientX: x, clientY: y });

/** Геометрия обновляется вместе с DOM при смене периода, как в настоящем календаре. */
const navigationGeometry = () => {
  const root = document.querySelector<HTMLDivElement>('.calendar-layout')!;
  const surface = root.querySelector<HTMLElement>('[data-calendar-surface]')!;
  root.setPointerCapture = vi.fn();
  const rectFor = (zone: HTMLElement) => {
    const index = [...document.querySelectorAll('[data-calendar-day]')].indexOf(zone);
    const month = zone.dataset.calendarMode === 'month';
    const left = (month ? index % 7 : index) * 100, top = month ? Math.floor(index / 7) * 140 : 0;
    const height = month ? 140 : 840;
    return { x: left, y: top, left, top, right: left + 100, bottom: top + height, width: 100, height, toJSON: () => ({}) };
  };
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 840, width: 700, height: 840, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset.calendarDay ? rectFor(this) : { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON: () => ({}) };
  });
  document.querySelectorAll<HTMLElement>('[data-calendar-day]').forEach(zone => vi.spyOn(zone, 'getBoundingClientRect').mockImplementation(() => rectFor(zone)));
  document.elementFromPoint = vi.fn((x, y) => [...document.querySelectorAll<HTMLElement>('[data-calendar-day]')].find(zone => {
    const rect = rectFor(zone);
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }) ?? null);
  return { root, rectFor };
};

describe('перенос задач в календаре', () => {
  it.each([
    ['week', 1], ['week', -1], ['month', 1], ['month', -1],
  ] as const)('продолжает перенос в виде %s после переключения у края %s', (view, direction) => {
    setup(view);
    const { root, rectFor } = navigationGeometry();
    const before = savedTask(), source = eventButton();
    const originalDay = document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay;
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(direction > 0 ? 695 : 5, 135));
    fireEvent.lostPointerCapture(source, pointer(350, 135)); // Передача захвата корню не отменяет перенос.
    flushFrame();
    expect(root.setPointerCapture).toHaveBeenCalledWith(1);
    act(() => vi.advanceTimersByTime(700));
    expect(document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay).not.toBe(originalDay);
    expect(source.isConnected).toBe(false);
    expect(root).toHaveFocus();
    expect(document.querySelector('.calendar-drag-ghost')).not.toBeNull();
    expect(savedTask()).toEqual(before);
    const destination = view === 'week' ? new Date(2026, 8, direction > 0 ? 23 : 9) : new Date(2026, direction > 0 ? 9 : 7, 1);
    const zone = [...document.querySelectorAll<HTMLElement>('[data-calendar-day]')].find(el => el.dataset.calendarDay === destination.toISOString())!;
    const rect = rectFor(zone), x = rect.left + 50, y = view === 'week' ? 375 : rect.top + 70;
    fireEvent.pointerMove(root, pointer(x, y));
    flushFrame();
    fireEvent.pointerUp(root, pointer(x, y));
    destination.setHours(view === 'week' ? 13 : 9);
    expect(savedTask()).toEqual({ ...before, ...movedTaskDates(before, destination) });
    expect(document.querySelector('.calendar-drag-ghost')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('уход от края отменяет ожидание переключения', () => {
    setup();
    const { root } = navigationGeometry(), source = eventButton();
    const firstDay = document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay;
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(695, 135));
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerMove(root, pointer(450, 135));
    act(() => vi.advanceTimersByTime(1000));
    expect(document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay).toBe(firstDay);
    expect(document.querySelector('.calendar-edge-hint')).toBeNull();
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(savedTask()).toEqual(eventTask());
  });

  it('удержание у края переключает несколько недель; Escape останавливает таймер после исчезновения исходной карточки', () => {
    setup();
    const { root } = navigationGeometry(), source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(695, 135));
    act(() => vi.advanceTimersByTime(700));
    act(() => vi.advanceTimersByTime(1100));
    expect(new Date(document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay!).getDate()).toBe(28);
    fireEvent.keyDown(root, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(2000));
    expect(new Date(document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay!).getDate()).toBe(28);
    expect(savedTask()).toEqual(eventTask());
    expect(document.querySelector('.calendar-drag-ghost')).toBeNull();
    expect(document.querySelector('.calendar-edge-hint')).toBeNull();
  });

  it.each(['cancel', 'release', 'unmount'])('останавливает переключение у края при %s', reason => {
    setup();
    const { root } = navigationGeometry(), source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(695, 135));
    if (reason === 'unmount') cleanup();
    else if (reason === 'cancel') fireEvent.pointerCancel(root, pointer(695, 135));
    else fireEvent.pointerUp(root, pointer(-100, -100));
    act(() => vi.advanceTimersByTime(2000));
    expect(document.querySelector('.calendar-drag-ghost')).toBeNull();
    if (reason !== 'unmount') {
      expect(new Date(document.querySelector<HTMLElement>('[data-calendar-day]')!.dataset.calendarDay!).getDate()).toBe(14);
      expect(savedTask()).toEqual(eventTask());
    }
  });

  it('переносит в другой день и время с шагом 30 минут, сохраняя длительность и остальные поля', () => {
    setup();
    const before = savedTask();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135)); // Четверг, захват в 09:15.
    fireEvent.pointerMove(source, pointer(450, 435)); // Пятница, указатель в 14:15.
    flushFrame();
    expect(document.querySelector('.cal-drop-preview')).toHaveTextContent('14:00–16:00');
    expect(savedTask()).toEqual(before); // До отпускания ничего не сохраняется.
    fireEvent.pointerUp(source, pointer(450, 435));
    expect(savedTask()).toEqual({ ...before, start: new Date(2026, 8, 18, 14).toISOString(), end: new Date(2026, 8, 18, 16).toISOString() });
    expect(screen.getByRole('status')).toHaveTextContent('Перенесено: Переносимая задача');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('поддерживает касание и перенос времени в виде «День»', () => {
    setup('day');
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(50, 135, 'touch'));
    fireEvent.pointerMove(source, pointer(50, 345, 'touch'));
    fireEvent.pointerUp(source, pointer(50, 345, 'touch'));
    expect(new Date(savedTask().start).getHours()).toBe(12);
    expect(new Date(savedTask().start).getMinutes()).toBe(30);
    expect(new Date(savedTask().end).getHours()).toBe(14);
  });

  it('в месяце меняет день, сохраняя время и длительность', () => {
    const task = { ...eventTask(), start: new Date(2026, 8, 17, 9, 15).toISOString(), end: new Date(2026, 8, 17, 11, 45).toISOString() };
    const zones = setup('month', false, task);
    const from = zones.findIndex((zone) => new Date(zone.dataset.calendarDay!).getDate() === 17);
    const to = zones.findIndex((zone) => new Date(zone.dataset.calendarDay!).getDate() === 19);
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(from * 100 + 50, 20));
    fireEvent.pointerMove(source, pointer(to * 100 + 50, 20));
    flushFrame();
    expect(zones[to]).toHaveClass('calendar-drop-day');
    fireEvent.pointerUp(source, pointer(to * 100 + 50, 20));
    expect(savedTask().start).toBe(new Date(2026, 8, 19, 9, 15).toISOString());
    expect(savedTask().end).toBe(new Date(2026, 8, 19, 11, 45).toISOString());
  });

  it('Escape отменяет перенос и подавляет клик после перетаскивания', () => {
    setup();
    const before = savedTask();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(450, 435));
    fireEvent.keyDown(source, { key: 'Escape' });
    fireEvent.pointerUp(source, pointer(450, 435));
    fireEvent.click(source);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedTask()).toEqual(before);
    expect(document.querySelector('.cal-drop-preview')).toBeNull();
    fireEvent.click(source);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each(['outside', 'cancel'])('отменяет перенос при %s', (reason) => {
    setup();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(450, 435));
    if (reason === 'outside') fireEvent.pointerUp(source, pointer(-100, -100));
    else fireEvent.pointerCancel(source, pointer(450, 435));
    expect(savedTask()).toEqual(eventTask());
    expect(document.querySelector('.calendar-moving')).toBeNull();
  });

  it('обычный клик без движения открывает карточку', () => {
    setup();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerUp(source, pointer(350, 135));
    fireEvent.click(source);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(savedTask()).toEqual(eventTask());
  });

  it('исполнитель без права планирования не может переносить задачу мышью или клавиатурой', () => {
    setup('week', true);
    const source = eventButton();
    expect(source).not.toHaveClass('calendar-movable');
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(450, 435));
    fireEvent.pointerUp(source, pointer(450, 435));
    fireEvent.keyDown(source, { key: 'ArrowRight', altKey: true });
    expect(savedTask()).toEqual(eventTask());
  });

  it('Alt+стрелки меняют день и время, не открывая карточку', () => {
    setup();
    eventButton().focus();
    fireEvent.keyDown(eventButton(), { key: 'ArrowRight', altKey: true });
    expect(eventButton()).toHaveFocus();
    fireEvent.keyDown(eventButton(), { key: 'ArrowDown', altKey: true });
    expect(savedTask().start).toBe(new Date(2026, 8, 18, 9, 30).toISOString());
    expect(savedTask().end).toBe(new Date(2026, 8, 18, 11, 30).toISOString());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('сохраняет длительность задачи, переходящей через полночь', () => {
    const task = { start: new Date(2026, 8, 17, 20).toISOString(), end: new Date(2026, 8, 19, 8).toISOString() };
    expect(movedTaskDates(task, new Date(2026, 8, 30, 18))).toEqual({ start: new Date(2026, 8, 30, 18).toISOString(), end: new Date(2026, 9, 2, 6).toISOString() });
  });

  it('объединяет движения в один кадр и плавно ведёт карточку внутри одного интервала', () => {
    setup();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(355, 145));
    fireEvent.pointerMove(source, pointer(356, 146));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(document.elementFromPoint).not.toHaveBeenCalled();
    flushFrame();
    const ghost = document.querySelector<HTMLElement>('.calendar-drag-ghost')!;
    expect(ghost.style.transform).toBe('translate3d(6px, 11px, 0)');
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('[data-calendar-task="drag-task"]')).toHaveLength(1);
    const preview = document.querySelector('.cal-drop-preview');
    expect(preview).toHaveTextContent('09:00–11:00');
    fireEvent.pointerMove(source, pointer(357, 147));
    flushFrame();
    expect(ghost.style.transform).toBe('translate3d(7px, 12px, 0)');
    expect(document.querySelector('.cal-drop-preview')).toBe(preview);
    fireEvent.keyDown(source, { key: 'Escape' });
    expect(document.querySelector('.calendar-drag-ghost')).toBeNull();
    expect(savedTask()).toEqual(eventTask());
  });

  it('отпускание до следующего кадра сохраняет окончательную позицию и убирает ожидающий кадр', () => {
    setup();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(450, 435));
    expect(frames.size).toBe(1);
    fireEvent.pointerUp(source, pointer(450, 495));
    expect(new Date(savedTask().start).getHours()).toBe(15);
    expect(frames.size).toBe(0);
    expect(document.querySelector('.calendar-drag-ghost')).toBeNull();
    expect(document.querySelector('.cal-drop-preview')).toBeNull();
  });

  it('при уходе из календаря удаляет плавающую карточку и отменяет ожидающий кадр', () => {
    setup();
    const source = eventButton();
    fireEvent.pointerDown(source, pointer(350, 135));
    fireEvent.pointerMove(source, pointer(450, 435));
    expect(document.querySelector('.calendar-drag-ghost')).not.toBeNull();
    cleanup();
    expect(frames.size).toBe(0);
    expect(document.querySelector('.calendar-drag-ghost')).toBeNull();
  });
});
