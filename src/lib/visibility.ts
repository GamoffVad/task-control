// Какие задачи видит сотрудник. Видимость следует иерархии подразделений:
//   подчинённый                      — только свои задачи;
//   начальник отделения (планирует)  — задачи своего подразделения вместе с вложенными (направления);
//   начальник отдела и администратор — все задачи отдела (разрешение «Видеть задачи всего отдела»).
// Правило применяют и сервер (отдаёт клиенту только видимое), и редьюсер (не даёт менять невидимое).
import { permissionsFor } from './access';
import { unitOf } from './data';
import { unitWithDescendants } from './units';
import type { ManagedUser, Report, RoleDefinition, Task, Unit } from './types';

/** Сотрудники, чьи задачи видны; null — все. */
export type Scope = Set<number> | null;

export const scopeOf = (employeeId: number, users: ManagedUser[], units: Unit[], roles: RoleDefinition[]): Scope => {
  const me = users.find((user) => user.employeeId === employeeId);
  const own = new Set([employeeId]);
  if (!me) return own;
  const permissions = permissionsFor(me.role, roles);
  if (permissions.includes('tasks.viewAll')) return null;
  // Тот, кто планирует задачи другим, — начальник: видит подразделение, в котором состоит, со вложенными.
  if (!permissions.includes('tasks.plan')) return own;
  const unitId = unitOf(me);
  if (!unitId) return own;
  const inside = unitWithDescendants(units, unitId);
  for (const user of users) if (inside.has(unitOf(user) ?? '')) own.add(user.employeeId);
  return own;
};

export const inScope = (scope: Scope, employeeId: number): boolean => scope === null || scope.has(employeeId);

/** Задача видна, если хотя бы один её исполнитель входит в область видимости. */
export const taskVisible = (task: Pick<Task, 'assigneeIds'>, scope: Scope): boolean =>
  scope === null || task.assigneeIds.some((id) => scope.has(id));

export const visibleTasks = (tasks: Task[], scope: Scope): Task[] => (scope === null ? tasks : tasks.filter((task) => taskVisible(task, scope)));

/** Записи отчётов — только по сотрудникам из области видимости: отчёт недели остаётся, чужие строки в нём скрыты. */
export const visibleReports = (reports: Report[], scope: Scope): Report[] =>
  scope === null ? reports : reports.map((report) => ({ ...report, entries: report.entries.filter((entry) => scope.has(entry.assigneeId)) }));
