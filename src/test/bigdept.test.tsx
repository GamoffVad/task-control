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

// Большой отдел: 7 демосотрудников и 40 тестовых.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 17, 12, 0));
});
afterAll(() => vi.useRealTimers());

const state = (): AppState => ({ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'manager' } });
const renderAt = (path: string) =>
  render(
    <StoreProvider initial={state()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </StoreProvider>,
  );

describe('большой отдел', () => {
  it('40 сотрудников отдела — пользователи в четырёх отделениях, у каждого есть отсутствия', () => {
    expect(STAFF_USERS).toHaveLength(40);
    expect(employees).toHaveLength(47);
    // Все 40 — в отделениях основного отдела, группы строятся из подразделений.
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
    expect(document.querySelectorAll('.tl-who')).toHaveLength(47);
    expect(screen.getByRole('region', { name: 'Сводка' })).toHaveTextContent(/из 47/);
    await user.click(screen.getByRole('button', { name: /^Группа: Весь отдел/ }));
    await user.click(screen.getByRole('option', { name: 'Отделение тестирования' }));
    expect(document.querySelectorAll('.tl-who')).toHaveLength(10);
  });
});
