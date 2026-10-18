import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { applyAbsenceStroke, type AbsenceStroke } from '../lib/absenceBrush';
import { balanceFor } from '../lib/absences';
import { DEFAULT_USERS } from '../lib/access';
import { syncStaff } from '../lib/data';
import { reducer } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState } from '../lib/store';
import type { Absence, AppState } from '../lib/types';
import { DEFAULT_UNITS } from '../lib/units';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 9, 18, 12);
const initial = (): AppState => ({ ...createSeed(NOW), absences: [], tasks: [], user: { employeeId: 1, email: 'user@example.com', role: 'administrator' } });
const stroke = (extra: Partial<AbsenceStroke> = {}): AbsenceStroke => ({ employeeId: 3, type: 'vacation', vacationType: 'annual', from: '2026-10-04', to: '2026-10-06', mode: 'paint', ...extra });
const period = (extra: Partial<Absence> = {}): Absence => ({ id: 'original', employeeId: 3, type: 'vacation', vacationType: 'annual', from: '2026-10-02', to: '2026-10-10', travelDaysBefore: 2, travelDaysAfter: 2, status: 'approved', note: 'Приказ №42', decidedBy: 1, createdAt: NOW.toISOString(), ...extra });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); syncStaff(DEFAULT_USERS, DEFAULT_UNITS); });

describe('транзакция кисти Тетриса', () => {
  it('создаёт один период через границу месяца и года', () => {
    const state = reducer(initial(), { type: 'paintAbsences', stroke: stroke({ from: '2026-12-30', to: '2027-01-03' }), now: NOW });
    expect(state.absences).toHaveLength(1);
    expect(state.absences[0]).toMatchObject({ from: '2026-12-30', to: '2027-01-03', status: 'approved', decidedBy: 1 });
  });
  it('стирает только выбранные дни, сохраняя оба фрагмента и дорогу на исходных датах', () => {
    const state = { ...initial(), absences: [period()] };
    const next = reducer(state, { type: 'paintAbsences', stroke: stroke({ mode: 'erase' }), now: NOW });
    expect(next.absences).toHaveLength(2);
    expect(new Set(next.absences.map((a) => a.id)).size).toBe(2);
    expect(next.absences[0]).toMatchObject({ id: 'original', from: '2026-10-02', to: '2026-10-03', travelDaysBefore: 2, travelDaysAfter: 0, note: 'Приказ №42' });
    expect(next.absences[1]).toMatchObject({ from: '2026-10-07', to: '2026-10-10', travelDaysBefore: 0, travelDaysAfter: 2, createdAt: NOW.toISOString() });
  });
  it.each([
    ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', 1, 2],
    ['2026-10-10', '2026-10-11', '2026-10-02', '2026-10-09', 2, 1],
  ])('обрезает край %s–%s без потери оставшейся дороги', (from, to, remainingFrom, remainingTo, before, after) => {
    const next = applyAbsenceStroke({ ...initial(), absences: [period()] }, stroke({ from: String(from), to: String(to), mode: 'erase' }), NOW);
    expect(next.absences).toHaveLength(1);
    expect(next.absences[0]).toMatchObject({ from: remainingFrom, to: remainingTo, travelDaysBefore: before, travelDaysAfter: after });
  });
  it('разрезает открытый больничный, сохраняя неизвестную дату окончания', () => {
    const state = { ...initial(), absences: [period({ type: 'sick', to: null })] };
    const next = applyAbsenceStroke(state, stroke({ type: 'sick', mode: 'erase' }), NOW);
    expect(next.absences.map((a) => [a.from, a.to])).toEqual([['2026-10-02', '2026-10-03'], ['2026-10-07', null]]);
    expect(applyAbsenceStroke(state, stroke({ from: '2027-01-01', to: '2027-01-02', type: 'trip' }), NOW).error).toBeTruthy();
  });
  it('полное стирание и повторная кисть не создают лишних записей', () => {
    const state = { ...initial(), absences: [period()] };
    expect(applyAbsenceStroke(state, stroke({ from: '2026-10-01', to: '2026-10-12', mode: 'erase' }), NOW).absences).toEqual([]);
    expect(applyAbsenceStroke(state, stroke(), NOW).absences).toEqual(state.absences);
  });
  it('заполняет пробелы того же вида, сохраняя исходный комментарий и дорогу', () => {
    const state = { ...initial(), absences: [period()] };
    const next = applyAbsenceStroke(state, stroke({ from: '2026-10-01', to: '2026-10-12' }), NOW);
    expect(next.absences[0]).toBe(state.absences[0]);
    expect(next.absences.slice(1).map((a) => [a.from, a.to])).toEqual([['2026-10-01', '2026-10-01'], ['2026-10-11', '2026-10-12']]);
  });
  it('не стирает чужой вид и целиком отклоняет закрашивание другого вида', () => {
    const state = { ...initial(), absences: [period({ type: 'trip' })] };
    expect(applyAbsenceStroke(state, stroke({ mode: 'erase' }), NOW).absences).toEqual(state.absences);
    expect(reducer(state, { type: 'paintAbsences', stroke: stroke({ from: '2026-10-01', to: '2026-10-12' }), now: NOW })).toBe(state);
  });
  it('учитывает словарные подвиды отпуска и дежурств', () => {
    const state = initial();
    state.dictionaries = [...state.dictionaries, { id: 'extra', dictionary: 'vacationType', code: 'extra', title: 'Дополнительный' }];
    state.absences = [period({ vacationType: 'extra' })];
    expect(applyAbsenceStroke(state, stroke(), NOW).error).toBeTruthy();
    expect(applyAbsenceStroke(state, stroke({ mode: 'erase' }), NOW).absences).toEqual(state.absences);
    expect(applyAbsenceStroke(state, stroke({ vacationType: 'extra', mode: 'erase' }), NOW).absences).toHaveLength(2);
  });
  it('пересчитывает отгулы за дежурства после рисования и частичной очистки', () => {
    const state = initial();
    const painted = applyAbsenceStroke(state, stroke({ type: 'duty', dutyType: 'regular', from: '2026-10-17', to: '2026-10-18' }), NOW);
    expect(balanceFor(painted.absences, [], 3, 2026, NOW).dayoff.accrued).toBe(2);
    const erased = applyAbsenceStroke({ ...state, absences: painted.absences }, stroke({ type: 'duty', dutyType: 'regular', from: '2026-10-18', to: '2026-10-18', mode: 'erase' }), NOW);
    expect(balanceFor(erased.absences, [], 3, 2026, NOW).dayoff.accrued).toBe(1);
  });
  it('исполнитель рисует заявки только себе и не меняет согласованные периоды', () => {
    const state = initial(); state.user = { employeeId: 3, email: 'sidorov@example.com', role: 'executor' };
    expect(applyAbsenceStroke(state, stroke(), NOW).absences[0]).toMatchObject({ employeeId: 3, status: 'request', decidedBy: null });
    expect(applyAbsenceStroke(state, stroke({ employeeId: 4 }), NOW).forbidden).toBe(true);
    state.absences = [period()];
    expect(applyAbsenceStroke(state, stroke({ mode: 'erase' }), NOW).forbidden).toBe(true);
    state.absences = [period({ status: 'request' })];
    expect(applyAbsenceStroke(state, stroke({ mode: 'erase' }), NOW).absences).toHaveLength(2);
  });
  it.each([{ to: '2026-02-30' }, { from: '2027-01-01' }, { type: 'unknown' }, { dutyType: 'unknown', type: 'duty' }, { vacationType: 'unknown' }, { mode: 'unknown' }])('отклоняет повреждённое движение %j', (extra) => {
    const state = initial();
    expect(reducer(state, { type: 'paintAbsences', stroke: stroke(extra as Partial<AbsenceStroke>), now: NOW })).toBe(state);
  });
});

const p = (x: number, y = 20) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y });
let frames: FrameRequestCallback[] = [];
const flush = () => act(() => { const pending = frames; frames = []; pending.forEach((f) => f(0)); });
const lane = () => document.querySelector<HTMLElement>('[data-brush-employee="3"]')!;
const board = () => document.querySelector<HTMLElement>('.tl-board')!;
const x = (day: number) => 220 + (day - .5) / Number(document.querySelector<HTMLElement>('.tl')!.style.getPropertyValue('--days')) * 930;
const setup = (absences: Absence[] = []) => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const left = this.dataset.brushEmployee ? 220 : 0, width = this.classList.contains('tl-who') ? 220 : this.dataset.brushEmployee ? 930 : 1150;
    return { x: left, y: 0, left, top: 0, right: left + width, bottom: 500, width, height: 500, toJSON: () => ({}) };
  });
  const view = render(<StoreProvider initial={{ ...initial(), absences }}><MemoryRouter initialEntries={['/tetris']}><AppRoutes /></MemoryRouter></StoreProvider>);
  board().setPointerCapture = vi.fn(); board().hasPointerCapture = vi.fn(() => false);
  Object.defineProperties(board(), { scrollWidth: { configurable: true, value: 1150 }, clientWidth: { configurable: true, value: 1150 } });
  return view;
};
const enable = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Рисование периодов' }));
const begin = (day: number) => fireEvent.pointerDown(lane().querySelectorAll('.tl-cell')[day - 1], p(x(day)));
const drag = (day: number) => { fireEvent.pointerMove(board(), p(x(day))); flush(); };
const finish = (day: number) => fireEvent.pointerUp(board(), p(x(day)));

describe('два режима Тетриса', () => {
  it('уход на вкладку заявок отменяет незавершённое рисование и перелистывание', () => {
    setup(); enable(); begin(30); fireEvent.pointerMove(board(), p(1149)); flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Пересечения и заявки' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(loadState().absences).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'График' }));
    expect(screen.getByRole('grid')).toHaveAccessibleName('График событий: Октябрь 2026');
    expect(document.querySelector('.tl-brush-preview')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Рисование периодов' })).toBeChecked();
  });
  it('по умолчанию открывает прежнюю форму, чекбокс переключает и запоминает режим', () => {
    const view = setup();
    expect(screen.getByRole('checkbox', { name: 'Рисование периодов' })).not.toBeChecked();
    fireEvent.click(lane().querySelector('.tl-cell')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    enable(); expect(localStorage.getItem('task-control:tetris-drawing:1')).toBe('1');
    view.unmount(); setup();
    expect(screen.getByRole('checkbox', { name: 'Рисование периодов' })).toBeChecked();
    enable(); fireEvent.click(lane().querySelector('.tl-cell')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('показывает предварительный диапазон и сохраняет только при отпускании', () => {
    setup(); enable(); begin(3); drag(6);
    expect(loadState().absences).toEqual([]);
    expect(document.querySelector('.tl-brush-preview')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    finish(6);
    expect(loadState().absences).toHaveLength(1);
    expect(loadState().absences[0]).toMatchObject({ from: '2026-10-03', to: '2026-10-06', employeeId: 3 });
  });
  it('поддерживает движение справа налево и стирание той же кистью', () => {
    setup([period()]); enable(); begin(6); drag(4); finish(4);
    expect(loadState().absences.map((a) => [a.from, a.to])).toEqual([['2026-10-02', '2026-10-03'], ['2026-10-07', '2026-10-10']]);
  });
  it.each([1, -1])('продолжает один период через границу месяца в направлении %s', (direction) => {
    setup(); enable(); begin(direction > 0 ? 30 : 2);
    fireEvent.pointerMove(board(), p(direction > 0 ? 1149 : 221)); flush();
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain(direction > 0 ? 'Ноябрь' : 'Сентябрь');
    drag(direction > 0 ? 3 : 27); finish(direction > 0 ? 3 : 27);
    expect(loadState().absences[0]).toMatchObject(direction > 0 ? { from: '2026-10-30', to: '2026-11-03' } : { from: '2026-09-27', to: '2026-10-02' });
  });
  it('удержание перелистывает последовательно, Escape отменяет весь жест и возвращает месяц', () => {
    setup(); enable(); begin(30); fireEvent.pointerMove(board(), p(1149)); flush();
    act(() => vi.advanceTimersByTime(1550));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('Декабрь');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('Октябрь');
    act(() => vi.advanceTimersByTime(2000));
    expect(loadState().absences).toEqual([]);
  });
  it('отпускание у края после перелистывания сохраняет первый день нового месяца', () => {
    setup(); enable(); begin(30); fireEvent.pointerMove(board(), p(1149)); flush();
    act(() => vi.advanceTimersByTime(650));
    fireEvent.pointerUp(board(), p(1149));
    expect(loadState().absences[0]).toMatchObject({ from: '2026-10-30', to: '2026-11-01' });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('Ноябрь');
  });
  it('сначала прокручивает скрытые дни на узком экране, затем перелистывает месяц', () => {
    setup(); enable();
    Object.defineProperty(board(), 'scrollWidth', { configurable: true, value: 1500 });
    begin(20); fireEvent.pointerMove(board(), p(1149)); flush();
    act(() => vi.advanceTimersByTime(650));
    expect(board().scrollLeft).toBe(120);
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('Октябрь');
    act(() => vi.advanceTimersByTime(360));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('Ноябрь');
  });
  it('уход от края отменяет перелистывание, потеря захвата отменяет рисунок', () => {
    setup(); enable(); begin(30); fireEvent.pointerMove(board(), p(1149)); flush();
    drag(25); act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('Октябрь');
    fireEvent.lostPointerCapture(board(), p(x(25)));
    expect(loadState().absences).toEqual([]);
  });
  it('правое меню ищет виды из словаря и выбирает кисть', () => {
    setup(); enable(); fireEvent.contextMenu(lane(), { clientX: 500, clientY: 50 });
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск кисти' }), { target: { value: 'дежур' } });
    expect(screen.queryByRole('menuitemradio', { name: 'Командировка' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Дежурство/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    begin(17); finish(17);
    expect(loadState().absences[0]).toMatchObject({ type: 'duty', dutyType: 'regular' });
  });
  it('событие другого вида блокирует весь диапазон, отмена указателя ничего не пишет', () => {
    setup([period({ type: 'trip' })]); enable(); begin(1); drag(5); finish(5);
    expect(loadState().absences).toEqual([period({ type: 'trip' })]);
    expect(screen.getByRole('status')).toHaveTextContent('другого вида');
    begin(15); fireEvent.pointerCancel(board(), p(x(15)));
    expect(loadState().absences).toHaveLength(1);
  });
});
