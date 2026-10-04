// Видимость задач по иерархии: подчинённый — свои, начальник отделения — задачи подразделения, начальник отдела и администратор — все.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, DEFAULT_USERS } from '../lib/access';
import { DEFAULT_CALENDAR_VIEW, loadCalendarView, normalizeCalendarView, storeCalendarView } from '../lib/calendarView';
import { employeeById, syncStaff } from '../lib/data';
import { fromData, reducer, toData } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import { DEFAULT_UNITS } from '../lib/units';
import { inScope, scopeOf, taskVisible, visibleReports, visibleTasks } from '../lib/visibility';
import type { ManagedUser, Report, Task } from '../lib/types';

const NOW = new Date('2026-09-17T10:00:00');

const task = (id: string, assigneeIds: number[]): Task => ({
  id, title: id, rowId: '1.1', category: null, assigneeIds, start: '2026-09-17T09:00:00.000Z', end: '2026-09-17T10:00:00.000Z',
  docName: '', docNumber: '', result: '', done: false, score: null, doneAt: null,
});

// Начальник отделения разработки (101) — руководитель с подразделением s-dev; рядом — его подчинённые.
const users: ManagedUser[] = DEFAULT_USERS.map((u) => (u.employeeId === 101 ? { ...u, role: 'manager' as const } : u));
const unitOfUser = (id: number) => users.find((u) => u.employeeId === id)!.unitId;

describe('область видимости задач', () => {
  it('подчинённый видит только свои задачи', () => {
    expect([...scopeOf(3, users, DEFAULT_UNITS, DEFAULT_ROLES)!]).toEqual([3]);
  });

  it('начальник отделения видит задачи своего подразделения, но не чужих', () => {
    const scope = scopeOf(101, users, DEFAULT_UNITS, DEFAULT_ROLES);
    expect(scope).not.toBeNull();
    const mates = users.filter((u) => u.unitId === unitOfUser(101)).map((u) => u.employeeId);
    expect(mates.length).toBeGreaterThan(1);
    for (const id of mates) expect(inScope(scope, id)).toBe(true);
    // Сотрудник другого отделения и руководство отдела не входят.
    expect(inScope(scope, 111)).toBe(false);
    expect(inScope(scope, 1)).toBe(false);
  });

  it('начальник отдела и администратор видят всё: у них разрешение «Видеть задачи всего отдела»', () => {
    expect(scopeOf(1, users, DEFAULT_UNITS, DEFAULT_ROLES)).toBeNull();
    // Руководитель без этого разрешения ограничен подразделением, даже если он заместитель.
    expect(scopeOf(2, users, DEFAULT_UNITS, DEFAULT_ROLES)).not.toBeNull();
    // Разрешение можно выдать роли — тогда видимость расширяется.
    const wide = DEFAULT_ROLES.map((r) => (r.role === 'manager' ? { ...r, permissions: [...r.permissions, 'tasks.viewAll' as const] } : r));
    expect(scopeOf(101, users, DEFAULT_UNITS, wide)).toBeNull();
  });

  it('подразделение учитывается вместе с вложенными', () => {
    const deputy = users.map((u) => (u.employeeId === 2 ? { ...u, unitId: 'u-dept-dev' } : u));
    const scope = scopeOf(2, deputy, DEFAULT_UNITS, DEFAULT_ROLES)!;
    // Руководитель на уровне отдела видит все отделения отдела.
    for (const id of [3, 101, 111, 121]) expect(scope.has(id)).toBe(true);
  });

  it('задача видна, если среди исполнителей есть сотрудник из области видимости', () => {
    const scope = new Set([3, 4]);
    expect(taskVisible(task('a', [3]), scope)).toBe(true);
    expect(taskVisible(task('b', [5, 4]), scope)).toBe(true);
    expect(taskVisible(task('c', [5]), scope)).toBe(false);
    expect(visibleTasks([task('a', [3]), task('c', [5])], scope).map((t) => t.id)).toEqual(['a']);
    expect(visibleTasks([task('c', [5])], null)).toHaveLength(1);
  });

  it('в отчётах скрыты строки по сотрудникам вне области видимости', () => {
    const report: Report = {
      weekStart: '2026-09-11', submittedAt: '2026-09-18T10:00:00.000Z',
      entries: [3, 5].map((assigneeId) => ({ taskId: `t${assigneeId}`, rowId: '1.1', rowTitle: 'x', assigneeId, title: 't', deadline: '', result: '', docName: '', docNumber: '', score: 5, doneAt: '2026-09-12T10:00:00.000Z' })),
    };
    expect(visibleReports([report], new Set([3]))[0].entries.map((e) => e.assigneeId)).toEqual([3]);
    expect(visibleReports([report], null)[0].entries).toHaveLength(2);
  });
});

describe('редьюсер учитывает видимость', () => {
  const stateFor = (employeeId: number) => {
    const seed = createSeed(NOW);
    const data = { ...toData(seed), users };
    syncStaff(users, DEFAULT_UNITS);
    const account = users.find((u) => u.employeeId === employeeId)!;
    return fromData({ ...data, tasks: [task('own', [102]), task('other', [112])] }, { email: account.email, employeeId, role: account.role });
  };

  it('начальник отделения правит задачи подразделения и не трогает чужие', () => {
    const s = stateFor(101);
    const draft = (t: Task) => ({ ...t, title: 'Изменено' });
    const ok = reducer(s, { type: 'saveTask', draft: draft(s.tasks.find((t) => t.id === 'own')!), now: NOW });
    expect(ok.tasks.find((t) => t.id === 'own')!.title).toBe('Изменено');
    // Чужая задача (исполнитель из другого отделения) — без изменений.
    const denied = reducer(s, { type: 'saveTask', draft: draft(s.tasks.find((t) => t.id === 'other')!), now: NOW });
    expect(denied).toBe(s);
    expect(reducer(s, { type: 'deleteTask', id: 'other' })).toBe(s);
  });

  it('нельзя назначить исполнителя вне своего подразделения', () => {
    const s = stateFor(101);
    const { id: _id, doneAt: _doneAt, ...base } = task('new', [102]);
    expect(reducer(s, { type: 'saveTask', draft: { ...base, assigneeIds: [102, 103] }, now: NOW }).tasks).toHaveLength(3);
    const outside = reducer(s, { type: 'saveTask', draft: { ...base, assigneeIds: [112] }, now: NOW });
    expect(outside).toBe(s);
  });

  it('у сотрудников есть карточки в составе, из которого строится область видимости', () => {
    expect(employeeById.has(101)).toBe(true);
  });
});

describe('вид календаря', () => {
  beforeEach(() => localStorage.clear());

  it('допустимы «День», «Неделя» и «Месяц»; прежняя «Рабочая неделя» превращается в «Неделю»', () => {
    expect(normalizeCalendarView('day')).toBe('day');
    expect(normalizeCalendarView('month')).toBe('month');
    expect(normalizeCalendarView('workWeek')).toBe(DEFAULT_CALENDAR_VIEW);
    expect(normalizeCalendarView('что-то')).toBe('week');
    expect(DEFAULT_CALENDAR_VIEW).toBe('week');
  });

  it('вид запоминается отдельно для каждого сотрудника', () => {
    storeCalendarView('month', 1);
    storeCalendarView('day', 2);
    expect(loadCalendarView(1)).toBe('month');
    expect(loadCalendarView(2)).toBe('day');
    expect(loadCalendarView(3)).toBe('week');
  });

  it('прежнее значение из хранилища не ломает календарь', () => {
    localStorage.setItem('task-control:calendar-view:5', 'workWeek');
    expect(loadCalendarView(5)).toBe('week');
  });
});
