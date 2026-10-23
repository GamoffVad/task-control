import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState } from '../lib/store';
import { createSeed } from '../lib/seed';
import { loadPlanningStep, nextPlanningSlot, storePlanningStep } from '../lib/planningSlots';
import type { AppState, Task } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const date = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute);
const FROM = date(14, 0), TO = date(18, 0), NOW = date(14, 8);
const busy = (day: number, from: number, to: number, assigneeIds = [3]) => ({ assigneeIds, start: date(day, from).toISOString(), end: date(day, to).toISOString() });

describe('свободные интервалы новых задач', () => {
  it('начинает с 09:00 и последовательно занимает свободные интервалы исполнителя', () => {
    expect(nextPlanningSlot([], 3, FROM, TO, 60, NOW)).toEqual({ start: date(14, 9).toISOString(), end: date(14, 10).toISOString() });
    expect(nextPlanningSlot([busy(14, 9, 10)], 3, FROM, TO, 60, NOW)).toEqual({ start: date(14, 10).toISOString(), end: date(14, 11).toISOString() });
  });
  it('учитывает общие и внеплановые задачи, но не занятость других сотрудников', () => {
    const tasks = [busy(14, 9, 18, [4]), busy(14, 9, 10, [1, 3]), busy(14, 10, 11)];
    const before = structuredClone(tasks);
    expect(nextPlanningSlot(tasks, 3, FROM, TO, 60, NOW)?.start).toBe(date(14, 11).toISOString());
    expect(tasks).toEqual(before);
  });
  it('не пропускает свободный промежуток перед последующими задачами', () => {
    expect(nextPlanningSlot([busy(14, 14, 17)], 3, FROM, TO, 60, NOW)?.start).toBe(date(14, 9).toISOString());
  });
  it('после пересекающихся задач округляет начало к выбранному шагу', () => {
    const tasks = [busy(14, 9, 10), { ...busy(14, 9, 10), end: date(14, 10, 20).toISOString() }];
    expect(nextPlanningSlot(tasks, 3, FROM, TO, 30, NOW)).toEqual({ start: date(14, 10, 30).toISOString(), end: date(14, 11).toISOString() });
  });
  it('не предлагает прошедшее время текущего дня', () => {
    expect(nextPlanningSlot([], 3, FROM, TO, 60, date(14, 13, 5))?.start).toBe(date(14, 14).toISOString());
  });
  it('переносит остаток рабочего дня на следующий будний день и пропускает выходные', () => {
    expect(nextPlanningSlot([], 3, date(18, 0), date(22, 0), 60, date(18, 17, 40))?.start).toBe(date(21, 9).toISOString());
  });
  it('учитывает занятость через полночь и не выбирает ночные часы', () => {
    const task = { ...busy(14, 20, 23), end: date(15, 10).toISOString() };
    expect(nextPlanningSlot([task], 3, FROM, TO, 60, date(14, 20))?.start).toBe(date(15, 10).toISOString());
  });
  it('при заполненном периоде возвращает null, а не повтор или дату за его пределами', () => {
    expect(nextPlanningSlot([14, 15, 16, 17, 18].map(day => busy(day, 9, 18)), 3, FROM, TO, 60, NOW)).toBeNull();
    expect(nextPlanningSlot([], 3, FROM, TO, 60, date(18, 17, 40))).toBeNull();
    expect(nextPlanningSlot([], 3, date(19, 0), date(20, 0), 60, NOW)).toBeNull();
  });
  it('считает прошлый и будущий выбранные периоды независимо от текущего дня', () => {
    expect(nextPlanningSlot([], 3, FROM, TO, 120, date(23, 12))?.start).toBe(date(14, 9).toISOString());
    expect(nextPlanningSlot([], 3, FROM, TO, 120, date(10, 12))?.start).toBe(date(14, 9).toISOString());
  });
  it('сохраняет шаг отдельно для пользователей и проверяет старые значения', () => {
    storePlanningStep(30, 1); storePlanningStep(120, 3);
    expect(loadPlanningStep(1)).toBe(30);
    expect(loadPlanningStep(3)).toBe(120);
    expect(loadPlanningStep(4)).toBe(60);
    localStorage.setItem('task-control:planning-step:4', '-10');
    expect(loadPlanningStep(4)).toBe(60);
  });
});

const initial = (): AppState => ({ ...createSeed(NOW), tasks: [], absences: [], user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' }, periodSettings: { planning: { startDay: 1, endDay: 5 }, reporting: { startDay: 1, endDay: 5 } } });
const openPlanning = (state = initial()) => render(<StoreProvider initial={state}><MemoryRouter initialEntries={['/planning']}><AppRoutes /></MemoryRouter></StoreProvider>);
const add = () => fireEvent.click(screen.getByRole('button', { name: /^Добавить задачу — 3\.6 .*Сидоров/ }));
const dates = () => [...screen.getByRole('dialog').querySelectorAll<HTMLInputElement>('.datefield input')];
const save = (title: string) => {
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Название'), { target: { value: title } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
};

describe('подстановка интервалов из матрицы', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());

  it('новые задачи одного исполнителя идут по очереди, отмена не занимает интервал, а шаг запоминается', () => {
    openPlanning();
    add(); expect(dates().map(input => input.value)).toEqual(['14.09.2026 09:00', '14.09.2026 10:00']);
    save('Первая задача');
    add(); expect(dates().map(input => input.value)).toEqual(['14.09.2026 10:00', '14.09.2026 11:00']);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    add(); expect(dates()[0].value).toBe('14.09.2026 10:00');
    save('Вторая задача');
    fireEvent.click(screen.getByRole('button', { name: /^Шаг новых задач:/ }));
    fireEvent.click(screen.getByRole('option', { name: '30 мин' }));
    add(); expect(dates().map(input => input.value)).toEqual(['14.09.2026 11:00', '14.09.2026 11:30']);
    save('Третья задача');
    const state = loadState();
    cleanup(); openPlanning(state);
    expect(screen.getByRole('button', { name: 'Шаг новых задач: 30 мин' })).toBeInTheDocument();
    expect(loadState().tasks.map(task => task.title)).toEqual(['Первая задача', 'Вторая задача', 'Третья задача']);
  });
  it('сохраняет указанные вручную даты; редактирование старой задачи не запускает подбор заново', () => {
    const state = initial(); state.user = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
    openPlanning(state); add();
    fireEvent.change(dates()[0], { target: { value: '15.09.2026 16:15' } });
    fireEvent.change(dates()[1], { target: { value: '15.09.2026 18:00' } });
    save('Вручную');
    const before = loadState().tasks[0];
    expect(before.start).toBe(date(15, 16, 15).toISOString());
    expect(before.end).toBe(date(15, 18).toISOString());
    fireEvent.click(screen.getByRole('button', { name: /^Вручную/ }));
    expect(dates().map(input => input.value)).toEqual(['15.09.2026 16:15', '15.09.2026 18:00']);
    save('Переименована');
    expect(loadState().tasks[0]).toEqual({ ...before, title: 'Переименована' });
  });
  it('при полном периоде предлагает явной кнопкой открыть форму для ручного выбора времени', () => {
    const state = initial(); state.tasks = [14, 15, 16, 17, 18].map(day => ({ ...createSeed(NOW).tasks[0], ...busy(day, 9, 18), id: `busy-${day}` } as Task));
    openPlanning(state); add();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('нет свободного рабочего интервала');
    fireEvent.click(screen.getByRole('button', { name: 'Указать время вручную' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(loadState().tasks).toHaveLength(5);
  });
});
