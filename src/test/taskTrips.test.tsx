import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AbsenceModal } from '../components/AbsenceModal';
import { TaskEditorProvider } from '../components/TaskModal';
import { useTaskEditor } from '../components/taskEditor';
import { findClashes } from '../lib/absences';
import { DEFAULT_ROLES, DEFAULT_USERS } from '../lib/access';
import { reducer } from '../lib/reducer';
import type { TaskDraft } from '../lib/logic';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import { loadState } from '../lib/store';
import { linkedTripCoversTask, taskTripWarnings, tripLinksError } from '../lib/taskTrips';
import type { Absence, AppState, Task } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 10, 12, 12);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
const trip = (extra: Partial<Absence> = {}): Absence => ({ id: 'trip-3', employeeId: 3, type: 'trip', from: '2026-11-12', to: '2026-11-15',
  note: 'Приказ 42', status: 'approved', createdAt: NOW.toISOString(), decidedBy: 1, ...extra });
const task = (extra: Partial<Task> = {}): Task => ({ id: 'work', title: 'Работа в командировке', rowId: '1.1', category: null, assigneeIds: [3],
  start: new Date(2026, 10, 12, 9).toISOString(), end: new Date(2026, 10, 12, 11).toISOString(), docName: '', docNumber: '', result: '', done: false, score: null, doneAt: null, ...extra });
const initial = (extra: Partial<AppState> = {}): AppState => ({ ...createSeed(NOW), tasks: [task()], absences: [trip()], users: DEFAULT_USERS, roles: DEFAULT_ROLES,
  user: { email: 'user@example.com', employeeId: 1, role: 'administrator' }, ...extra });
const linked = () => task({ tripAbsenceIds: ['trip-3'] });
const newDraft = (extra: Partial<TaskDraft> = {}): TaskDraft => {
  const { id: _id, doneAt: _doneAt, ...draft } = task();
  return { ...draft, ...extra };
};

describe('командировка как конкретная связь задачи', () => {
  it('обычная задача предупреждает, связанная поездка исключается', () => {
    expect(findClashes([task()], [trip()], NOW)).toHaveLength(1);
    expect(findClashes([linked()], [trip()], NOW)).toEqual([]);
    expect(linkedTripCoversTask(linked(), trip())).toBe(true);
  });
  it('больничный и другая поездка продолжают вызывать предупреждения', () => {
    const list = [trip(), trip({ id: 'sick', type: 'sick' }), trip({ id: 'another' })];
    expect(findClashes([linked()], list, NOW).map((clash) => clash.absence.id)).toEqual(['sick', 'another']);
    expect(findClashes([linked(), task({ id: 'other' })], [trip()], NOW).map((clash) => clash.task.id)).toEqual(['other']);
  });
  it('в общей задаче связь не исключает отсутствие другого исполнителя', () => {
    const common = task({ assigneeIds: [3, 4], tripAbsenceIds: ['trip-3'] });
    const list = [trip(), trip({ id: 'trip-4', employeeId: 4 })];
    expect(findClashes([common], list, NOW).map((clash) => clash.employeeId)).toEqual([4]);
    expect(findClashes([{ ...common, tripAbsenceIds: ['trip-3', 'trip-4'] }], list, NOW)).toEqual([]);
  });
  it('проверяет конец последнего дня и сообщает о выходе задачи за пределы поездки', () => {
    expect(linkedTripCoversTask({ ...linked(), end: new Date(2026, 10, 15, 23, 59).toISOString() }, trip())).toBe(true);
    const moved = { ...linked(), start: new Date(2026, 10, 11, 9).toISOString() };
    expect(taskTripWarnings(moved, [trip()]).join()).toContain('выходит за пределы');
    expect(findClashes([moved], [trip()], NOW)).toHaveLength(1);
  });
  it('заявка сохраняет связь, отклонение, удаление и смена вида её не маскируют', () => {
    expect(findClashes([linked()], [trip({ status: 'request' })], NOW)).toEqual([]);
    expect(taskTripWarnings(linked(), [trip({ status: 'rejected' })]).join()).toContain('отклонена');
    expect(taskTripWarnings(linked(), []).join()).toContain('удалена или недоступна');
    expect(findClashes([linked()], [trip({ type: 'vacation' })], NOW)).toHaveLength(1);
    expect(taskTripWarnings(linked(), [trip({ type: 'vacation' })]).join()).toContain('больше не является');
  });
  it('смена сотрудника поездки не блокирует старую задачу и не маскирует неоднозначные связи', () => {
    const common = task({ assigneeIds: [3, 4], tripAbsenceIds: ['trip-3', 'second'] });
    // Поездку второго сотрудника переназначили первому: требуется явный выбор одной поездки.
    const list = [trip(), trip({ id: 'second', employeeId: 3 })];
    expect(tripLinksError(common, list, common.tripAbsenceIds)).toBeUndefined();
    expect(taskTripWarnings(common, list).join()).toContain('несколько командировок');
    expect(findClashes([common], list, NOW)).toHaveLength(2);
  });
  it('не принимает неизвестные, чужие, повторные и не относящиеся к поездке новые ссылки', () => {
    for (const absences of [[], [trip({ employeeId: 4 })], [trip({ type: 'vacation' })], [trip({ status: 'rejected' })]]) expect(tripLinksError(linked(), absences)).toBeTruthy();
    expect(tripLinksError({ ...linked(), tripAbsenceIds: ['trip-3', 'trip-3'] }, [trip()])).toBeTruthy();
    expect(tripLinksError({ ...linked(), tripAbsenceIds: ['trip-3', 'second'] }, [trip(), trip({ id: 'second' })])).toBeTruthy();
    expect(tripLinksError(linked(), [], ['trip-3'])).toBeUndefined();
  });
});

describe('атомарное сохранение и права', () => {
  it('сохраняет и снимает связь, а старый клиент не стирает её', () => {
    const s = initial();
    const next = reducer(s, { type: 'saveTask', draft: linked(), now: NOW });
    expect(next.tasks[0].tripAbsenceIds).toEqual(['trip-3']);
    const { tripAbsenceIds: _ids, ...oldClient } = next.tasks[0];
    expect(reducer(next, { type: 'saveTask', draft: { ...oldClient, title: 'Правка' } }).tasks[0].tripAbsenceIds).toEqual(['trip-3']);
    expect(reducer(next, { type: 'saveTask', draft: { ...next.tasks[0], tripAbsenceIds: [] } }).tasks[0].tripAbsenceIds).toBeUndefined();
  });
  it('исполнитель сохраняет результат со старой связью, но не меняет связи существующей задачи', () => {
    const s = initial({ tasks: [linked()], user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' } });
    const next = reducer(s, { type: 'saveTask', draft: { ...linked(), tripAbsenceIds: [], result: 'Готово' } });
    expect(next.tasks[0]).toMatchObject({ tripAbsenceIds: ['trip-3'], result: 'Готово' });
    const deleted = reducer(s, { type: 'deleteAbsence', id: 'trip-3' });
    expect(deleted).toBe(s);
  });
  it('создаёт поездку и задачу вместе, заменяя временный идентификатор', () => {
    const s = initial({ tasks: [], absences: [] });
    const next = reducer(s, { type: 'saveTask', draft: newDraft({ tripAbsenceIds: ['pending'] }),
      newTrips: [trip({ id: 'pending' })], now: NOW });
    expect(next.tasks).toHaveLength(1); expect(next.absences).toHaveLength(1);
    expect(next.absences[0].id).not.toBe('pending');
    expect(next.tasks[0].tripAbsenceIds).toEqual([next.absences[0].id]);
    expect(findClashes(next.tasks, next.absences, NOW)).toEqual([]);
  });
  it('ошибка второй поездки или отсутствие прав откатывает весь пакет', () => {
    const s = initial({ tasks: [], absences: [] });
    const action = { type: 'saveTask' as const, draft: newDraft({ assigneeIds: [3, 4], tripAbsenceIds: ['pending', 'invalid'] }),
      newTrips: [trip({ id: 'pending' }), trip({ id: 'invalid', employeeId: 4, to: '2026-11-01' })], now: NOW };
    expect(reducer(s, action)).toBe(s);
    const noAbsenceRights = { ...s, user: { ...s.user!, permissions: ['tasks.plan' as const] } };
    expect(reducer(noAbsenceRights, { ...action, newTrips: [trip({ id: 'pending' })], draft: newDraft({ tripAbsenceIds: ['pending'] }) })).toBe(noAbsenceRights);
  });
  it('из формы поездки меняет только запрошенные связи и сохраняет остальные задачи', () => {
    const s = initial({ tasks: [task(), task({ id: 'unrelated', title: 'Другая задача' })] });
    const next = reducer(s, { type: 'saveAbsence', draft: trip(), taskLinks: [{ taskId: 'work', linked: true }] });
    expect(next.tasks[0].tripAbsenceIds).toEqual(['trip-3']);
    expect(next.tasks[1]).toBe(s.tasks[1]);
    expect(reducer(next, { type: 'saveAbsence', draft: trip(), taskLinks: [{ taskId: 'work', linked: false }] }).tasks[0].tripAbsenceIds).toBeUndefined();
  });
  it('поездку нельзя использовать для правки невидимой задачи или без права планирования', () => {
    const s = initial({ user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' }, absences: [trip({ status: 'request', decidedBy: null })] });
    expect(reducer(s, { type: 'saveAbsence', draft: trip({ status: 'request' }), taskLinks: [{ taskId: 'work', linked: true }] })).toBe(s);
    const smallManager = initial({ user: { email: 'petrov@example.com', employeeId: 2, role: 'manager' },
      users: DEFAULT_USERS.map((u) => u.employeeId === 2 ? { ...u, unitId: 'g-3' } : u) });
    expect(reducer(smallManager, { type: 'saveAbsence', draft: trip(), taskLinks: [{ taskId: 'work', linked: true }] })).toBe(smallManager);
  });
  it('после удаления или перерисовки поездки задача сохраняется и предупреждение возвращается', () => {
    const s = initial({ tasks: [linked()] });
    const removed = reducer(s, { type: 'deleteAbsence', id: 'trip-3' });
    expect(taskTripWarnings(removed.tasks[0], removed.absences).join()).toContain('удалена');
    expect(reducer(removed, { type: 'saveTask', draft: { ...removed.tasks[0], result: 'Результат' } }).tasks[0].result).toBe('Результат');
    const shortened = reducer(s, { type: 'paintAbsences', stroke: { employeeId: 3, type: 'trip', from: '2026-11-12', to: '2026-11-12', mode: 'erase' }, now: NOW });
    expect(taskTripWarnings(shortened.tasks[0], shortened.absences).join()).toContain('выходит за пределы');
  });
});

const OpenEditor = ({ value }: { value?: Task }) => {
  const { openTask } = useTaskEditor();
  return <button onClick={() => openTask(value ? { task: value } : { defaults: newDraft() })}>Открыть редактор</button>;
};
const open = (s: AppState, value: Task | undefined = s.tasks[0]) => {
  render(<StoreProvider initial={s}><TaskEditorProvider><OpenEditor value={value} /></TaskEditorProvider></StoreProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть редактор' }));
};
const chooseTrip = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Командировка Сидоров Д.Е.:/ }));
  fireEvent.click(screen.getByRole('option', { name: /Приказ 42/ }));
};

describe('формы задачи и командировки', () => {
  it('флажок требует выбрать поездку; выбор убирает только её предупреждение', () => {
    open(initial());
    expect(screen.getByText('Срок приходится на отсутствие исполнителя.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Задача выполняется в командировке' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите командировку');
    chooseTrip();
    expect(screen.queryByText('Срок приходится на отсутствие исполнителя.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().tasks[0].tripAbsenceIds).toEqual(['trip-3']);
  });
  it('связанная поездка не скрывает больничный и ошибку дат', () => {
    open(initial({ tasks: [linked()], absences: [trip(), trip({ id: 'sick', type: 'sick' })] }));
    expect(screen.getByText('Срок приходится на отсутствие исполнителя.')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Связь с командировками' });
    expect(within(region).getByRole('checkbox')).toBeChecked();
    fireEvent.change(screen.getByLabelText(/^Окончание/), { target: { value: '16.11.2026 11:00' } });
    fireEvent.blur(screen.getByLabelText(/^Окончание/));
    expect(screen.getByText(/Период задачи выходит за пределы/)).toBeInTheDocument();
  });
  it('создание поездки остаётся черновиком до сохранения задачи и отменяется вместе с ней', () => {
    open(initial({ tasks: [], absences: [] }), undefined);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Задача выполняется в командировке' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать командировку для Сидоров Д.Е.' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Связать с задачей' }));
    expect(loadState().absences).toEqual([]);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(loadState().absences).toEqual([]);
    expect(loadState().tasks).toEqual([]);
  });
  it('сохраняет новый период и задачу одним действием из формы', () => {
    open(initial({ tasks: [], absences: [] }), undefined);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Задача выполняется в командировке' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать командировку для Сидоров Д.Е.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Связать с задачей' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const saved = loadState();
    expect(saved.absences).toHaveLength(1); expect(saved.tasks).toHaveLength(1);
    expect(saved.tasks[0].tripAbsenceIds).toEqual([saved.absences[0].id]);
  });
  it('можно связать задачу из формы поездки, предупреждение сразу исчезает', () => {
    render(<StoreProvider initial={initial()}><AbsenceModal absence={trip()} onClose={vi.fn()} /></StoreProvider>);
    expect(screen.getByText(/Пересекается со сроками/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Работа в командировке/ }));
    expect(screen.queryByText(/Пересекается со сроками/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().tasks[0].tripAbsenceIds).toEqual(['trip-3']);
  });
  it('поиск задач не снимает выбранные связи за пределами результатов', () => {
    render(<StoreProvider initial={initial({ tasks: [linked()] })}><AbsenceModal absence={trip()} onClose={vi.fn()} /></StoreProvider>);
    fireEvent.change(screen.getByLabelText('Поиск задач командировки'), { target: { value: 'Нет такой задачи' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(loadState().tasks[0].tripAbsenceIds).toEqual(['trip-3']);
  });
});
