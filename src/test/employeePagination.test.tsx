import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { StoreProvider } from '../lib/StoreProvider';
import { createSeed } from '../lib/seed';
import type { Absence, AppState, ReportEntry } from '../lib/types';

const NOW = new Date(2026, 8, 17, 12);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
const fixture = (count: number): AppState => {
  const state = createSeed(NOW);
  const template = state.tasks[0];
  const tasks = Array.from({ length: count }, (_, i) => ({ ...template, id: `planned-${i}`, title: `План ${i + 1}`, assigneeIds: [3], done: false, doneAt: null }));
  const entries: ReportEntry[] = Array.from({ length: count }, (_, i) => ({ taskId: `done-${i}`, rowId: '1.1', rowTitle: 'План', assigneeId: 3, title: `Исполнено ${i + 1}`, deadline: NOW.toISOString(), doneAt: NOW.toISOString(), result: '', docName: '', docNumber: '', score: 1 }));
  const absences: Absence[] = Array.from({ length: count }, (_, i) => ({ id: `event-${i}`, employeeId: 3, type: 'study', from: '2026-09-01', to: '2026-09-01', status: 'approved', note: `Событие ${i + 1}`, decidedBy: 1, createdAt: NOW.toISOString() }));
  return { ...state, tasks, reports: [{ weekStart: '2026-09-11', submittedAt: NOW.toISOString(), entries }], absences, user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' } };
};
const show = (count: number) => render(<StoreProvider initial={fixture(count)}><MemoryRouter initialEntries={['/employees/3']}><AppRoutes /></MemoryRouter></StoreProvider>);

describe('страницы карточки сотрудника', () => {
  it('не показывает управление при 30 записях', () => {
    show(30);
    expect(screen.queryByRole('navigation', { name: /Страницы/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'События' }));
    expect(screen.queryByRole('navigation', { name: /Страницы/ })).not.toBeInTheDocument();
  });
  it('листаем каждый список отдельно и видим записи за пределами прежних 50', () => {
    show(61);
    const planned = screen.getByRole('navigation', { name: 'Страницы запланированных задач' });
    const done = screen.getByRole('navigation', { name: 'Страницы исполненных задач' });
    expect(planned).toHaveTextContent('Страница 1 из 3');
    expect(done).toHaveTextContent('Страница 1 из 3');
    expect(screen.getByRole('button', { name: 'План 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'План 31' })).not.toBeInTheDocument();
    fireEvent.click(within(planned).getByRole('button', { name: 'Вперёд' }));
    expect(screen.getByRole('button', { name: 'План 31' })).toBeInTheDocument();
    expect(done).toHaveTextContent('Страница 1 из 3');
    fireEvent.click(within(done).getByRole('button', { name: 'Вперёд' }));
    fireEvent.click(within(done).getByRole('button', { name: 'Вперёд' }));
    expect(screen.getByText('Исполнено 61')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'События' }));
    const events = screen.getByRole('navigation', { name: 'Страницы событий' });
    expect(screen.getByText('Событие 1')).toBeInTheDocument();
    expect(screen.queryByText('Событие 31')).not.toBeInTheDocument();
    fireEvent.click(within(events).getByRole('button', { name: 'Вперёд' }));
    expect(screen.getByText('Событие 31')).toBeInTheDocument();
  });
});
