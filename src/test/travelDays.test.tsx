import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AbsenceModal } from '../components/AbsenceModal';
import { DEFAULT_USERS } from '../lib/access';
import { absenceDays, balanceFor, covers, validateAbsence } from '../lib/absences';
import { syncStaff } from '../lib/data';
import { migrate, reducer } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState } from '../lib/store';
import type { Absence, AppState } from '../lib/types';
import { DEFAULT_UNITS } from '../lib/units';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 8, 17, 12);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
afterEach(() => syncStaff(DEFAULT_USERS, DEFAULT_UNITS));
const initial = (): AppState => ({ ...createSeed(NOW), absences: [], user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const absence = (extra: Partial<Absence> = {}): Absence => ({ id: 'a', employeeId: 3, type: 'vacation', from: '2026-08-01', to: '2026-08-10', note: '', status: 'approved', decidedBy: 1, createdAt: NOW.toISOString(), ...extra });

describe('дни на дорогу каждого отпуска', () => {
  it('дорога входит в отсутствие, но не расходует ежегодную норму', () => {
    const a = absence({ travelDaysBefore: 2, travelDaysAfter: 1 });
    expect(absenceDays(a)).toBe(10);
    expect(covers(a, new Date(2026, 7, 1))).toBe(true);
    expect(covers(a, new Date(2026, 7, 10))).toBe(true);
    expect(balanceFor([a], [], 3, 2026, NOW).vacation).toMatchObject({ total: 28, used: 7, left: 21 });
    expect(balanceFor([absence()], [], 3, 2026, NOW).vacation.used).toBe(10);
  });

  it('каждый отпуск получает свои дни дороги, заявки не уменьшают остаток', () => {
    const absences = [absence({ travelDaysBefore: 1, travelDaysAfter: 1 }), absence({ id: 'b', from: '2026-10-01', to: '2026-10-05', travelDaysBefore: 2, travelDaysAfter: 0, status: 'request' })];
    expect(balanceFor(absences, [], 3, 2026, NOW).vacation).toMatchObject({ used: 8, requested: 3, left: 20 });
  });

  it('дорога и отпуск правильно распределяются на границе ежегодного сброса', () => {
    const a = absence({ from: '2026-04-12', to: '2026-04-18', travelDaysBefore: 2, travelDaysAfter: 1 });
    const settings = { resetMonth: 4, resetDay: 15 };
    expect(balanceFor([a], [], 3, 2026, NOW, { settings, referenceDate: new Date(2026, 3, 14) }).vacation.used).toBe(1);
    expect(balanceFor([a], [], 3, 2026, NOW, { settings, referenceDate: new Date(2026, 3, 15) }).vacation.used).toBe(3);
  });

  it('сохраняет дорогу с отпуском, не меняя индивидуальную ежегодную норму', () => {
    const state = initial();
    const next = reducer(state, { type: 'saveAbsence', draft: { ...absence({ travelDaysBefore: 2, travelDaysAfter: 1 }), id: undefined }, now: NOW });
    expect(migrate(next).absences[0]).toMatchObject({ travelDaysBefore: 2, travelDaysAfter: 1 });
    expect(next.users).toBe(state.users);
    expect(next.entitlements).toBe(state.entitlements);
  });

  it('проверяет целые неотрицательные дни и длительность отсутствия', () => {
    for (const n of [-1, 1.5, 367, NaN, 11]) expect(validateAbsence(absence({ travelDaysBefore: n }), [], NOW).travel).toBeTruthy();
    expect(validateAbsence(absence({ travelDaysBefore: 5, travelDaysAfter: 6 }), [], NOW).travel).toBeTruthy();
    expect(validateAbsence(absence({ travelDaysBefore: 0, travelDaysAfter: 0 }), [], NOW).travel).toBeUndefined();
    expect(validateAbsence(absence({ type: 'trip', travelDaysBefore: 99 }), [], NOW).travel).toBeUndefined();
  });

  it('в форме сохраняет дни дороги и показывает разбивку общей длительности', async () => {
    render(<StoreProvider initial={initial()}><AbsenceModal defaults={{ employeeId: 3, from: '2026-10-01', to: '2026-10-10' }} onClose={vi.fn()} /></StoreProvider>);
    const user = userEvent.setup();
    const before = screen.getByLabelText('На дорогу туда, дней');
    const after = screen.getByLabelText('На дорогу обратно, дней');
    await user.clear(before); await user.type(before, '2');
    await user.clear(after); await user.type(after, '1');
    expect(screen.getByText(/Всего отсутствия:/)).toHaveTextContent('10 дн. = отпуск 7 дн. + дорога 3 дн.');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().absences[0]).toMatchObject({ travelDaysBefore: 2, travelDaysAfter: 1 });
  });

  it('редактирование сохраняет прежние дни дороги, неверная длительность не сохраняется', async () => {
    const state = initial();
    state.absences = [absence({ travelDaysBefore: 2, travelDaysAfter: 1 })];
    const close = vi.fn();
    render(<StoreProvider initial={state}><AbsenceModal absence={state.absences[0]} onClose={close} /></StoreProvider>);
    const user = userEvent.setup();
    const before = screen.getByLabelText('На дорогу туда, дней');
    expect(before).toHaveValue('2');
    await user.clear(before); await user.type(before, '11');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('не могут превышать');
    expect(close).not.toHaveBeenCalled();
    await user.clear(before); await user.type(before, '2');
    await user.type(screen.getByLabelText('Комментарий'), 'Приказ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().absences[0]).toMatchObject({ travelDaysBefore: 2, travelDaysAfter: 1, note: 'Приказ' });
  });
});
