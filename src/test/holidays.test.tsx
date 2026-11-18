import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { createSeed } from '../lib/seed';
import { reducer, fromData, toData, migrate } from '../lib/reducer';
import { StoreProvider } from '../lib/StoreProvider';
import { validHoliday } from '../lib/holidays';
import type { AppState } from '../lib/types';

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 17, 12)); });
afterAll(() => vi.useRealTimers());
const state = (): AppState => ({ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const renderAt = (path: string, initial: AppState) => render(<StoreProvider initial={initial}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></StoreProvider>);

describe('производственный календарь', () => {
  it('проверяет даты и сохраняет праздники при загрузке и удалении', () => {
    const initial = state(), holiday = { date: '2026-09-18', description: 'Праздничный день' };
    expect(validHoliday({ date: '2026-02-30', description: 'Ошибка' })).toBe(false);
    const saved = reducer(initial, { type: 'saveHoliday', holiday });
    expect(saved.holidays).toEqual([holiday]);
    expect(fromData(toData(saved), saved.user).holidays).toEqual([holiday]);
    expect(migrate(saved).holidays).toEqual([holiday]);
    expect(reducer(saved, { type: 'deleteHoliday', date: holiday.date }).holidays).toEqual([]);
    const denied = { ...initial, user: { ...initial.user!, permissions: [] } };
    expect(reducer(denied, { type: 'saveHoliday', holiday })).toBe(denied);
  });
  it('показывает праздник в календаре и Тетрисе с описанием', () => {
    const initial = state(); initial.holidays = [{ date: '2026-09-18', description: 'Праздничный день' }];
    const view = renderAt('/calendar', initial);
    const calendarDay = document.querySelector('.cal-head.holiday[data-tip="Праздничный день"]');
    expect(calendarDay).toHaveTextContent('18');
    view.unmount();
    renderAt('/tetris', initial);
    const tetrisDay = document.querySelector('.tl-dh.holiday[data-tip="Праздничный день"]');
    expect(tetrisDay).toHaveTextContent('18');
  });
  it('позволяет добавить и удалить праздник в администрировании', async () => {
    renderAt('/admin', state());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Производственный календарь' }));
    const input = screen.getByLabelText('Дата');
    await user.type(input, '18.09.2026');
    await user.type(screen.getByLabelText('Описание'), 'День отдела');
    await user.click(screen.getByRole('button', { name: 'Добавить или обновить' }));
    const table = screen.getByRole('table', { name: 'Праздничные дни' });
    expect(within(table).getByText('День отдела')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Удалить праздник День отдела' }));
    expect(within(table).queryByText('День отдела')).not.toBeInTheDocument();
  });
});
