import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { AbsenceModal } from '../components/AbsenceModal';
import { DEFAULT_USERS } from '../lib/access';
import { balanceFor, entitlementFor } from '../lib/absences';
import { syncStaff } from '../lib/data';
import { toDateKey } from '../lib/dates';
import { fromData, migrate, reducer, toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState } from '../lib/store';
import type { Absence, AppState } from '../lib/types';
import { DEFAULT_UNITS } from '../lib/units';
import { annualVacationDays, vacationPeriod, vacationTypeTitle, vacationYear } from '../lib/vacations';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 8, 17, 12);
const APRIL = { resetMonth: 4, resetDay: 15 };
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
afterEach(() => syncStaff(DEFAULT_USERS, DEFAULT_UNITS));
const initial = (): AppState => ({ ...createSeed(NOW), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const absence = (from: string, to: string, extra: Partial<Absence> = {}): Absence => ({ id: from, employeeId: 3, type: 'vacation', from, to, status: 'approved', createdAt: NOW.toISOString(), note: '', decidedBy: 1, ...extra });

describe('отпускной период и индивидуальная норма', () => {
  it('сбрасывает остаток точно в выбранную дату и сохраняет историю', () => {
    const absences = [absence('2026-04-10', '2026-04-20')];
    const state = initial();
    state.users[2].annualVacationDays = 40;
    const options = { users: state.users, settings: APRIL };
    const before = new Date(2026, 3, 14, 23, 59);
    const after = new Date(2026, 3, 15);
    expect(vacationYear(before, APRIL)).toBe(2025);
    expect(vacationYear(after, APRIL)).toBe(2026);
    expect(balanceFor(absences, [], 3, 2026, before, options).vacation.left).toBe(35);
    expect(balanceFor(absences, [], 3, 2026, after, options).vacation.left).toBe(34);
    expect(absences[0].from).toBe('2026-04-10');
  });

  it('учитывает декабрь и январь в одном отпускном периоде', () => {
    const absences = [absence('2025-12-30', '2026-01-03'), absence('2026-04-14', '2026-04-16')];
    const b = balanceFor(absences, [], 3, 2026, NOW, { settings: APRIL, referenceDate: new Date(2026, 2, 1) });
    expect(b.vacation.used).toBe(6);
    expect(b.vacation.left).toBe(22);
  });

  it('оставляет больничные, поездки и отгулы в календарном году', () => {
    const b = balanceFor([absence('2025-12-30', '2026-01-03', { type: 'sick' })], [], 3, 2026, NOW, { settings: APRIL });
    expect(b.sick).toEqual({ days: 3, cases: 1 });
  });

  it('поддерживает 29 февраля и не создаёт разрыва между периодами', () => {
    const settings = { resetMonth: 2, resetDay: 29 };
    expect(toDateKey(vacationPeriod(2027, settings).from)).toBe('2027-02-28');
    expect(toDateKey(vacationPeriod(2027, settings).to)).toBe('2028-02-28');
    expect(toDateKey(vacationPeriod(2028, settings).from)).toBe('2028-02-29');
  });

  it('сохраняет индивидуальную норму для новых периодов, включая нулевую', () => {
    const state = initial();
    state.users[2].annualVacationDays = 45;
    expect(entitlementFor([], 3, 2030, state.users).vacationDays).toBe(45);
    state.users[2].annualVacationDays = 0;
    expect(entitlementFor([], 3, 2030, state.users).vacationDays).toBe(0);
    const legacy = [{ employeeId: 3, year: 2025, vacationDays: 36, carriedOver: 7, dayoffAccrued: 3 }];
    expect(annualVacationDays([], legacy, 3)).toBe(36);
    expect(entitlementFor(legacy, 3, 2026)).toMatchObject({ vacationDays: 36, carriedOver: 0, dayoffAccrued: 0 });
  });

  it('правка карточки меняет текущую норму, сохраняя перенос, отгулы и прошлые годы', () => {
    const state = initial();
    state.entitlements = [2025, 2026].map((year) => ({ employeeId: 3, year, vacationDays: 28, carriedOver: 4, dayoffAccrued: 6 }));
    const next = reducer(state, { type: 'saveManagedUser', employeeId: 3, role: 'executor', active: true, annualVacationDays: 42, now: NOW });
    expect(next.users[2].annualVacationDays).toBe(42);
    expect(next.entitlements[0].vacationDays).toBe(28);
    expect(next.entitlements[1]).toMatchObject({ vacationDays: 42, carriedOver: 4, dayoffAccrued: 6 });
    expect(next.absences).toBe(state.absences);
    expect(entitlementFor(next.entitlements, 3, 2027, next.users).vacationDays).toBe(42);
  });

  it('единым сохранением обновляет отпускной и календарный периоды без смешивания норм', () => {
    const state = initial();
    state.vacationSettings = { resetMonth: 11, resetDay: 1 };
    state.entitlements = [{ employeeId: 3, year: 2025, vacationDays: 28, carriedOver: 4, dayoffAccrued: 2 }];
    const next = reducer(state, { type: 'saveEntitlement', entitlement: { employeeId: 3, year: 2025, vacationDays: 40, carriedOver: 5, dayoffAccrued: 9 }, dayoffYear: 2026, now: NOW });
    expect(next.entitlements.find((e) => e.year === 2025)).toMatchObject({ vacationDays: 40, carriedOver: 5, dayoffAccrued: 2 });
    expect(next.entitlements.find((e) => e.year === 2026)?.dayoffAccrued).toBe(9);
    expect(next.users[2].annualVacationDays).toBe(40);
  });

  it('мигрирует старое хранилище и сохраняет настройки при повторной загрузке', () => {
    const state = initial();
    state.dictionaries = state.dictionaries.filter((d) => d.dictionary !== 'vacationType');
    expect(migrate(state).dictionaries.some((d) => d.dictionary === 'vacationType')).toBe(true);
    const next = reducer(state, { type: 'saveVacationSettings', settings: APRIL });
    expect(migrate(next).vacationSettings).toEqual(APRIL);
    expect(fromData(toData(next), next.user).vacationSettings).toEqual(APRIL);
  });

  it('отклоняет невалидные нормы и дату, а исполнитель не меняет настройки', () => {
    const state = initial();
    expect(reducer(state, { type: 'saveVacationSettings', settings: { resetMonth: 4, resetDay: 31 } })).toBe(state);
    expect(reducer(state, { type: 'saveManagedUser', employeeId: 3, role: 'executor', active: true, annualVacationDays: -1 })).toBe(state);
    state.user = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' };
    expect(reducer(state, { type: 'saveVacationSettings', settings: APRIL })).toBe(state);
  });
});

describe('справочник типов отпусков', () => {
  it('переименование кода переносит связи, в том числе у старых отпусков', () => {
    const state = initial();
    state.absences = [absence('2026-09-01', '2026-09-05')];
    const next = reducer(state, { type: 'saveDictionary', draft: { id: 'dict-vacation-annual', dictionary: 'vacationType', code: 'main', title: 'Основной отпуск' } });
    expect(next.absences[0].vacationType).toBe('main');
    expect(vacationTypeTitle(next.absences[0], next.dictionaries)).toBe('Основной отпуск');
    expect(reducer(next, { type: 'deleteDictionary', id: 'dict-vacation-annual' })).toBe(next);
  });

  it('нельзя удалить используемый тип, неиспользуемый удаляется', () => {
    const state = reducer(initial(), { type: 'saveDictionary', draft: { dictionary: 'vacationType', code: 'extra', title: 'Дополнительный отпуск' } });
    const entry = state.dictionaries.find((d) => d.code === 'extra')!;
    const used = { ...state, absences: [absence('2026-09-01', '2026-09-05', { vacationType: 'extra' })] };
    expect(reducer(used, { type: 'deleteDictionary', id: entry.id })).toBe(used);
    expect(reducer(state, { type: 'deleteDictionary', id: entry.id }).dictionaries).not.toContain(entry);
  });
});

describe('настройки отпусков в интерфейсе', () => {
  it('сохраняет норму в редактировании сотрудника и проверяет ввод', async () => {
    render(<StoreProvider initial={initial()}><MemoryRouter initialEntries={['/admin']}><AppRoutes /></MemoryRouter></StoreProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Редактировать пользователя Сидоров/ }));
    const input = screen.getByLabelText(/Дней отпуска в год/);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ежегодную норму отпуска');
    await user.type(input, '42');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().users.find((u) => u.employeeId === 3)?.annualVacationDays).toBe(42);
  });

  it('сохраняет день и месяц сброса через списки с поиском', async () => {
    render(<StoreProvider initial={initial()}><MemoryRouter initialEntries={['/admin']}><AppRoutes /></MemoryRouter></StoreProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Отпуска' }));
    await user.click(screen.getByRole('button', { name: /^Месяц сброса отпусков:/ }));
    await user.type(screen.getByRole('combobox', { name: /^Поиск:/ }), 'апр');
    await user.click(screen.getByRole('option', { name: 'Апрель' }));
    await user.click(screen.getByRole('button', { name: /^День сброса отпусков:/ }));
    await user.click(screen.getByRole('option', { name: '15' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить дату сброса' }));
    expect(loadState().vacationSettings).toEqual(APRIL);
    expect(screen.getByRole('status')).toHaveTextContent('Настройка сохранена');
  });

  it('выбирает словарный тип при оформлении и сохраняет его после редактирования', async () => {
    const state = initial();
    state.absences = [];
    state.dictionaries.push({ id: 'extra', dictionary: 'vacationType', code: 'extra', title: 'Дополнительный отпуск' });
    const close = vi.fn();
    const view = render(<StoreProvider initial={state}><AbsenceModal defaults={{ employeeId: 3, from: '2026-10-01', to: '2026-10-03' }} onClose={close} /></StoreProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Тип отпуска:/ }));
    await user.type(screen.getByRole('combobox', { name: /^Поиск:/ }), 'допол');
    await user.click(screen.getByRole('option', { name: 'Дополнительный отпуск' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    expect(close).toHaveBeenCalled();
    expect(loadState().absences[0]).toMatchObject({ type: 'vacation', vacationType: 'extra', employeeId: 3 });
    expect(balanceFor(loadState().absences, [], 3, 2026, NOW).vacation.left).toBe(25);
    const saved = loadState();
    view.unmount();
    render(<StoreProvider initial={saved}><AbsenceModal absence={saved.absences[0]} onClose={close} /></StoreProvider>);
    expect(screen.getByRole('button', { name: 'Тип отпуска: Дополнительный отпуск' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Комментарий'), 'Приказ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().absences[0]).toMatchObject({ vacationType: 'extra', note: 'Приказ' });
  });
});
