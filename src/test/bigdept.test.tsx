import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { employees } from '../lib/data';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import { department } from '../lib/data';
import { STAFF_USERS } from '../lib/staff';
import type { AppState } from '../lib/types';

// Большой отдел: 50 тестовых сотрудников, включая семь основных.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 17, 12, 0));
});
afterAll(() => vi.useRealTimers());

const state = (): AppState => ({ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'manager' } });
const renderAt = (path: string, initial = state()) =>
  render(
    <StoreProvider initial={initial}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </StoreProvider>,
  );

describe('большой отдел', () => {
  it('50 тестовых пользователей распределены по подразделениям, у каждого есть отсутствия', () => {
    expect(STAFF_USERS).toHaveLength(43);
    expect(employees).toHaveLength(50);
    // Дополнительные сотрудники — в отделениях основного отдела.
    const staffIds = STAFF_USERS.map((u) => u.employeeId).sort();
    const newGroups = department.groups.filter((g) => g.id.startsWith('s-'));
    expect(newGroups.map((g) => g.name)).toEqual(['Отделение разработки', 'Отделение сопровождения', 'Отделение аналитики', 'Отделение тестирования']);
    expect(newGroups.flatMap((g) => g.employeeIds).sort()).toEqual(staffIds);
    const seed = createSeed(new Date(2026, 8, 17));
    for (const u of STAFF_USERS) expect(seed.absences.some((a) => a.employeeId === u.employeeId)).toBe(true);
  });

  it('«Тетрис» показывает всех и сужается до группы', async () => {
    const user = userEvent.setup();
    renderAt('/tetris');
    expect(document.querySelectorAll('.tl-who')).toHaveLength(50);
    expect(document.querySelectorAll('.tl-who.tl-group-start')).toHaveLength(7);
    expect(document.querySelectorAll('.tl-lane.tl-group-start')).toHaveLength(7);
    expect(document.querySelector('.tl-who')).not.toHaveClass('tl-group-start');
    expect(screen.getByRole('region', { name: 'Сводка' })).toHaveTextContent(/из 50/);
    await user.click(screen.getByRole('button', { name: /^Группа: Весь отдел/ }));
    await user.click(screen.getByRole('option', { name: 'Отделение тестирования' }));
    expect(document.querySelectorAll('.tl-who')).toHaveLength(11);
    expect(document.querySelector('.tl-group-start')).toBeNull();
  });

  it('порядок в «Тетрисе» совпадает с деревом сотрудников после смены подразделений', () => {
    const initial = state();
    initial.user = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
    // Младший ID переходит в дочернее подразделение, старший — в руководство.
    initial.users = initial.users.map((u) => u.employeeId === 1 ? { ...u, unitId: 's-dev' } : u.employeeId === 107 ? { ...u, unitId: 'g-1' } : u);
    const directory = renderAt('/employees/1', initial);
    const expected = [...document.querySelectorAll('.employee-directory .tree-row')].map((el) => el.getAttribute('href'));
    expect(expected.indexOf('/employees/107')).toBeLessThan(expected.indexOf('/employees/1'));
    directory.unmount();
    renderAt('/tetris', initial);
    expect([...document.querySelectorAll('.tl-who')].map((el) => el.getAttribute('href'))).toEqual(expected);
  });
});
