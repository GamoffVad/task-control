import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { AbsenceModal } from '../components/AbsenceModal';
import { DictionaryColors } from '../components/DictionaryColors';
import { absColor } from '../components/absColor';
import { DEFAULT_USERS } from '../lib/access';
import { absenceInPeriod, balanceFor, dutyDayoffs, dutyWeekendDays, findClashes } from '../lib/absences';
import { ABSENCE_TYPES, syncCategories, syncStaff } from '../lib/data';
import { dutyTypeTitle, eventTypes } from '../lib/eventTypes';
import { fromData, migrate, reducer, toData } from '../lib/reducer';
import { createSeed, DEFAULT_DICTIONARIES } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState, useStore } from '../lib/store';
import type { Absence, AppState } from '../lib/types';
import { DEFAULT_UNITS } from '../lib/units';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 8, 20, 12); // воскресенье
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
afterEach(() => { syncStaff(DEFAULT_USERS, DEFAULT_UNITS); syncCategories(DEFAULT_DICTIONARIES); });
const initial = (): AppState => ({ ...createSeed(NOW), absences: [], entitlements: [], user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const duty = (extra: Partial<Absence> = {}): Absence => ({ id: 'duty-1', employeeId: 3, type: 'duty', dutyType: 'regular', from: '2026-09-18', to: '2026-09-20', status: 'approved', createdAt: NOW.toISOString(), note: '', decidedBy: 1, ...extra });

describe('дежурства и накопленные отгулы', () => {
  it('начисляет по одному за субботу и воскресенье, складывая с ручным остатком', () => {
    const b = balanceFor([duty()], [{ employeeId: 3, year: 2026, vacationDays: 28, carriedOver: 0, dayoffAccrued: 4 }], 3, 2026, NOW);
    expect(dutyWeekendDays(duty())).toBe(2);
    expect(b.dayoff).toMatchObject({ accrued: 6, left: 6 });
    expect(b.vacation.left).toBe(28);
  });
  it('учитывает только согласованные наступившие выходные нужного сотрудника', () => {
    const list = [duty(), duty({ id: 'future', from: '2026-09-25', to: '2026-09-27' }), duty({ id: 'request', status: 'request' }), duty({ id: 'rejected', status: 'rejected' }), duty({ id: 'other', employeeId: 4 })];
    expect(dutyDayoffs(list, 3, 2026, new Date(2026, 8, 18))).toBe(0);
    expect(dutyDayoffs(list, 3, 2026, new Date(2026, 8, 19))).toBe(1);
    expect(dutyDayoffs(list, 3, 2026, NOW)).toBe(2);
    expect(dutyDayoffs(list, 3, 2026, new Date(2026, 8, 27))).toBe(4);
    expect(dutyDayoffs([duty({ status: 'request' }), duty({ status: 'rejected' })], 3, 2026, NOW)).toBe(0);
  });
  it('не удваивает совпадающие дни и разделяет начисление по календарным годам', () => {
    expect(dutyDayoffs([duty(), duty({ id: 'duplicate' })], 3, 2026, NOW)).toBe(2);
    const a = duty({ from: '2022-12-30', to: '2023-01-02' });
    expect(dutyDayoffs([a], 3, 2022, NOW)).toBe(1);
    expect(dutyDayoffs([a], 3, 2023, NOW)).toBe(1);
  });
  it('согласование, изменение, отмена и удаление пересчитывают баланс без изменения ручной нормы', () => {
    let state = initial();
    state = reducer(state, { type: 'saveAbsence', draft: { ...duty({ status: 'request' }), id: undefined }, now: NOW });
    const id = state.absences[0].id;
    const accrued = () => balanceFor(state.absences, state.entitlements, 3, 2026, NOW).dayoff.accrued;
    expect(accrued()).toBe(0);
    state = reducer(state, { type: 'decideAbsence', id, status: 'approved' });
    expect(accrued()).toBe(2);
    state = reducer(state, { type: 'saveAbsence', draft: { ...state.absences[0], to: '2026-09-19' }, now: NOW });
    expect(accrued()).toBe(1);
    state = reducer(state, { type: 'saveAbsence', draft: { ...state.absences[0], from: '2026-09-14', to: '2026-09-18' }, now: NOW });
    expect(accrued()).toBe(0);
    state = reducer(state, { type: 'saveAbsence', draft: { ...state.absences[0], from: '2026-09-19', to: '2026-09-20' }, now: NOW });
    expect(accrued()).toBe(2);
    state = reducer(state, { type: 'decideAbsence', id, status: 'rejected' });
    expect(accrued()).toBe(0);
    state = reducer(state, { type: 'decideAbsence', id, status: 'approved' });
    state = reducer(state, { type: 'deleteAbsence', id });
    expect(accrued()).toBe(0);
    expect(state.entitlements).toEqual([]);
  });
  it('дежурство не является отсутствием или пересечением срока задачи', () => {
    const task = { ...initial().tasks[0], done: false, assigneeIds: [3], end: '2026-09-19T12:00:00' };
    expect(findClashes([task], [duty()], NOW)).toEqual([]);
    expect(absenceInPeriod([duty()], 3, new Date(2026, 8, 18), new Date(2026, 8, 20), NOW)).toBeNull();
    expect(findClashes([task], [duty({ type: 'custom' })], NOW)).toHaveLength(1);
  });
  it('мигрирует старое хранилище, сохраняя дежурства и подтипы при загрузке', () => {
    const state = initial();
    state.dictionaries = state.dictionaries.filter((e) => e.dictionary !== 'dutyType' && e.code !== 'duty');
    const next = migrate(state);
    expect(eventTypes(next.dictionaries).some((t) => t.key === 'duty')).toBe(true);
    expect(next.dictionaries.some((e) => e.dictionary === 'dutyType')).toBe(true);
    next.absences = [duty()];
    expect(fromData(toData(next), next.user).absences).toEqual(next.absences);
  });
});

describe('новые виды из словарей', () => {
  it('сразу обновляет виды событий и безопасно считает баланс произвольного отсутствия', () => {
    const state = reducer(initial(), { type: 'saveDictionary', draft: { dictionary: 'absenceType', code: 'осмотр', title: 'Медицинский осмотр', color: '#446B46' } });
    syncCategories(state.dictionaries);
    expect(ABSENCE_TYPES.find((t) => t.key === 'осмотр')?.full).toBe('Медицинский осмотр');
    expect(balanceFor([duty({ type: 'осмотр' })], [], 3, 2026, NOW).dayoff.accrued).toBe(0);
    expect(balanceFor([duty({ type: 'осмотр' })], [], 3, 2026, NOW).vacation.left).toBe(28);
    render(<StoreProvider initial={state}><DictionaryColors /></StoreProvider>);
    expect(document.querySelector('style')?.textContent).toContain('--abs-_43e__441__43c__43e__442__440_: #446B46');
    expect(absColor('осмотр')).toHaveProperty('--c', 'var(--abs-_43e__441__43c__43e__442__440_, var(--accent))');
  });
  it('смена кода переносит ссылки, используемые и системные значения защищены от удаления', () => {
    let state = initial();
    state.dictionaries.push({ id: 'custom', dictionary: 'absenceType', code: 'custom', title: 'Особое отсутствие' });
    state.absences = [duty({ type: 'custom' })];
    expect(reducer(state, { type: 'deleteDictionary', id: 'custom' })).toBe(state);
    state = reducer(state, { type: 'saveDictionary', draft: { id: 'custom', dictionary: 'absenceType', code: 'renamed', title: 'Особое отсутствие' } });
    expect(state.absences[0].type).toBe('renamed');
    const entry = state.dictionaries.find((e) => e.code === 'vacation')!;
    expect(reducer(state, { type: 'deleteDictionary', id: entry.id })).toBe(state);
    expect(reducer(state, { type: 'saveDictionary', draft: { ...entry, code: 'renamedVacation' } })).toBe(state);
    expect(reducer(state, { type: 'saveDictionary', draft: { id: 'custom', dictionary: 'absenceType', code: 'dayoff', title: 'Обход' } })).toBe(state);
  });
  it('смена кода вида дежурства обновляет ссылки и сохраняет начисление', () => {
    let state = initial();
    state.absences = [duty({ dutyType: undefined })];
    const entry = state.dictionaries.find((e) => e.dictionary === 'dutyType')!;
    state = reducer(state, { type: 'saveDictionary', draft: { ...entry, code: 'daily', title: 'Суточное дежурство' } });
    expect(state.absences[0].dutyType).toBe('daily');
    expect(dutyTypeTitle(state.absences[0], state.dictionaries)).toBe('Суточное дежурство');
    expect(reducer(state, { type: 'deleteDictionary', id: entry.id })).toBe(state);
    expect(dutyDayoffs(state.absences, 3, 2026, NOW)).toBe(2);
  });
  it('новый вид сразу доступен в фильтре, форме и полосе Тетриса', async () => {
    const AddType = () => { const { dispatch } = useStore(); return <button onClick={() => dispatch({ type: 'saveDictionary', draft: { dictionary: 'absenceType', code: 'custom', title: 'Особое отсутствие', color: '#446B46' } })}>Тест: добавить вид</button>; };
    const state = initial();
    state.absences = [duty({ type: 'custom' })];
    render(<StoreProvider initial={state}><MemoryRouter initialEntries={['/tetris']}><AddType /><AppRoutes /></MemoryRouter></StoreProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Тест: добавить вид' }));
    expect(document.getElementById('abs-duty-1')).toHaveTextContent('Особое отсутствие');
    await user.click(screen.getByRole('button', { name: /^Виды событий/ }));
    expect(screen.getByRole('option', { name: 'Особое отсутствие' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(document.getElementById('abs-duty-1')!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Вид события/ }));
    expect(screen.getByRole('option', { name: 'Особое отсутствие' })).toHaveAttribute('aria-selected', 'true');
  });
  it('форма ищет виды дежурств, сохраняет выбранный и показывает начисление за выходные', async () => {
    const state = initial();
    state.dictionaries.push({ id: 'duty-daily', dictionary: 'dutyType', code: 'daily', title: 'Суточное дежурство' });
    render(<StoreProvider initial={state}><AbsenceModal defaults={{ employeeId: 3, type: 'duty', from: '2026-09-18', to: '2026-09-20' }} onClose={vi.fn()} /></StoreProvider>);
    const user = userEvent.setup();
    expect(screen.getByText('+2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Вид дежурства/ }));
    await user.type(screen.getByRole('combobox', { name: 'Поиск: Вид дежурства' }), 'суточное');
    expect(screen.queryByRole('option', { name: 'Плановое дежурство' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Суточное дежурство' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().absences[0]).toMatchObject({ type: 'duty', dutyType: 'daily', from: '2026-09-18', to: '2026-09-20' });
    expect(dutyDayoffs(loadState().absences, 3, 2026, NOW)).toBe(2);
  });
});
