import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState } from '../lib/store';
import { createSeed } from '../lib/seed';
import { displayState } from '../lib/displayState';
import { authenticate } from '../lib/auth';
import { DEFAULT_USERS } from '../lib/access';
import { DEFAULT_UNITS } from '../lib/units';
import { employees, department, syncStaff } from '../lib/data';
import type { AppState } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 8, 17, 12);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
afterEach(() => syncStaff(DEFAULT_USERS, DEFAULT_UNITS));

const initial = (hidden = true): AppState => ({ ...createSeed(NOW), users: DEFAULT_USERS.map((user) => user.employeeId === 3 ? { ...user, hidden } : user), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const at = (path: string, state = initial()) => render(<StoreProvider initial={state}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></StoreProvider>);

describe('скрытый сотрудник', () => {
  it.each(['/calendar', '/planning', '/control', '/tetris', '/reports', '/kpi', '/employees/1', '/chat'])('не отображается в рабочем разделе %s', (path) => {
    at(path);
    expect(document.querySelector('main')!.textContent).not.toContain('Сидоров');
    expect(employees.some((employee) => employee.id === 3)).toBe(false);
    expect(department.groups.flatMap((group) => group.employeeIds)).not.toContain(3);
  });

  it('исключён из фильтров и выбора исполнителей', async () => {
    at('/calendar');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Сотрудник:/ }));
    expect(screen.queryByRole('option', { name: 'Сидоров Д.Е.' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Новая задача' }));
    expect(within(screen.getByRole('dialog')).queryByRole('checkbox', { name: 'Сидоров Д.Е.' })).toBeNull();
  });

  it('не имеет открываемой карточки даже по прямой ссылке', () => {
    at('/employees/3');
    expect(screen.getByRole('heading', { name: 'Сотрудник не найден' })).toBeInTheDocument();
    expect(document.querySelector('main')!.textContent).not.toContain('Сидоров');
  });

  it('флажок сохраняется; вход разрешён; администратор может вернуть сотрудника', async () => {
    at('/admin', initial(false));
    const user = userEvent.setup();
    const edit = () => screen.getByRole('button', { name: 'Редактировать пользователя Сидоров Дмитрий Евгеньевич' });
    await user.click(edit());
    await user.click(screen.getByRole('checkbox', { name: 'Скрыть сотрудника во всех рабочих разделах' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().users.find((account) => account.employeeId === 3)).toMatchObject({ hidden: true, active: true });
    expect(authenticate('sidorov', '123456', loadState().users)).toMatchObject({ employeeId: 3 });
    expect(edit()).toBeInTheDocument();
    await user.click(edit());
    expect(screen.getByRole('checkbox', { name: 'Скрыть сотрудника во всех рабочих разделах' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Скрыть сотрудника во всех рабочих разделах' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().users.find((account) => account.employeeId === 3)?.hidden).toBe(false);
    expect(employees.some((employee) => employee.id === 3)).toBe(true);
  });

  it('скрытый администратор сохраняет сеанс, права и просмотр остальных сотрудников', () => {
    const state = initial(false);
    state.users = state.users.map((account) => account.employeeId === 1 ? { ...account, hidden: true } : account);
    at('/planning', state);
    expect(screen.getByRole('heading', { name: 'Планирование' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7); // Разделы + шесть видимых сотрудников.
    expect(document.querySelector('main')!.textContent).not.toContain('Иванов А.Б.');
    expect(screen.queryByRole('link', { name: /^Моя карточка:/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Администрирование' })).toBeInTheDocument();
  });

  it('правка общей задачи не удаляет скрытого исполнителя из исходных данных', async () => {
    const state = initial();
    const task = { ...state.tasks[0], id: 'shared-hidden', title: 'Общая задача', assigneeIds: [3, 4], start: new Date(2026, 8, 17, 9).toISOString(), end: new Date(2026, 8, 17, 11).toISOString(), done: false, doneAt: null, result: '' };
    state.tasks = [task];
    at('/calendar', state);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Общая задача/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('Сидоров');
    await user.clear(within(dialog).getByLabelText('Название'));
    await user.type(within(dialog).getByLabelText('Название'), 'Изменённая общая задача');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(loadState().tasks[0].title).toBe('Изменённая общая задача');
    expect([...loadState().tasks[0].assigneeIds].sort()).toEqual([3, 4]);
  });

  it('скрытый исполнитель не появляется в собственном плане', () => {
    const state = initial();
    state.user = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' };
    at('/planning', state);
    expect(document.querySelector('main')!.textContent).not.toContain('Сидоров');
    expect(screen.getAllByRole('columnheader')).toHaveLength(1);
  });

  it('проекция скрывает связанные записи, не изменяя хранилище', () => {
    const state = initial();
    const before = JSON.stringify(state);
    const shown = displayState(state);
    expect(shown.tasks.every((task) => !task.assigneeIds.includes(3))).toBe(true);
    expect(shown.reports.flatMap((report) => report.entries).some((entry) => entry.assigneeId === 3)).toBe(false);
    expect(shown.absences.some((absence) => absence.employeeId === 3)).toBe(false);
    expect(shown.entitlements.some((entry) => entry.employeeId === 3)).toBe(false);
    expect(shown.messages.some((message) => message.authorId === 3)).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
    expect(displayState({ ...state, users: state.users.map((user) => ({ ...user, hidden: false })) }).tasks).toEqual(state.tasks);
  });
});
