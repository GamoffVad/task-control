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
    expect(document.querySelectorAll('.tl-who.tl-group-start').length).toBe(document.querySelectorAll('.tl-lane.tl-group-start').length);
    expect(document.querySelector('.tl-who')).not.toHaveClass('tl-group-start');
    expect(screen.getByRole('region', { name: 'Сводка' })).toHaveTextContent(/из 50/);
    await user.click(screen.getByRole('button', { name: /^Группа: Весь отдел/ }));
    await user.click(screen.getByRole('option', { name: 'Отделение тестирования' }));
    expect(document.querySelectorAll('.tl-who')).toHaveLength(11);
    expect(document.querySelector('.tl-group-start')).toBeNull();
  });

  it('учитывает заданный порядок подразделений в Тетрисе', () => {
    const initial = state();
    initial.user = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
    initial.users = initial.users.filter((u) => u.employeeId <= 4).map((u) => ({ ...u, unitId: u.employeeId <= 2 ? 'g-1' : 'g-2' }));
    initial.units = initial.units.map((u) => u.id === 'g-1' ? { ...u, order: 2 } : u.id === 'g-2' ? { ...u, order: 1 } : u);
    renderAt('/tetris', initial);
    const names = [...document.querySelectorAll('.tl-who')].map((el) => el.getAttribute('href'));
    expect(names.slice(0, 2)).toEqual(expect.arrayContaining(['/employees/3', '/employees/4']));
    expect(names.slice(2)).toEqual(expect.arrayContaining(['/employees/1', '/employees/2']));
  });

  it('держит подразделения вместе и сортирует сотрудников по должности внутри каждой группы', async () => {
    const initial = state();
    initial.user = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
    initial.users = initial.users.filter((u) => u.employeeId <= 4).map((u) => {
      const positions: Record<number, string> = { 1: 'Заместитель', 2: 'Специалист', 3: 'Начальник', 4: 'Младший' };
      return { ...u, position: positions[u.employeeId], unitId: u.employeeId <= 2 ? 'g-1' : 'g-2' };
    });
    initial.dictionaries = [...initial.dictionaries, ...['Начальник', 'Заместитель', 'Специалист', 'Младший'].map((title, i) => ({ id: `p-${i}`, dictionary: 'position' as const, code: `p-${i}`, title, order: i + 1 }))];
    renderAt('/tetris', initial);
    const names = () => [...document.querySelectorAll('.tl-who')].map((el) => el.getAttribute('href'));
    expect(names()).toEqual(['/employees/3', '/employees/4', '/employees/1', '/employees/2']);
    expect([...document.querySelectorAll('.tl-who.tl-group-start')].map((el) => el.getAttribute('href'))).toEqual(['/employees/1']);
    expect(document.querySelectorAll('.tl-lane.tl-group-start')).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Группа: Весь отдел/ }));
    await user.click(screen.getByRole('option', { name: 'Руководство' }));
    expect(names()).toEqual(['/employees/1', '/employees/2']);
    expect(document.querySelectorAll('.tl-group-start')).toHaveLength(0);
  });
});
