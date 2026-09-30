// Права по типу учётной записи. Интерфейс их показывает, хранилище — проверяет повторно.
import { ADMIN_TAB_PERMISSIONS, hasPermission } from './access';
import type { Absence, Task, User } from './types';

export const isManager = (u: User | null): boolean => hasPermission(u, 'tasks.plan');
export const isAdministrator = (u: User | null): boolean => hasPermission(u, 'admin.access');

/** Что пользователь может менять в задаче. */
export type TaskAccess = {
  /** Название, сроки, позиция, категория, исполнители. */
  plan: boolean;
  /** Документ, результат, отметка об исполнении. */
  execution: boolean;
  /** Баллы за исполнение. */
  score: boolean;
  delete: boolean;
};

const NONE: TaskAccess = { plan: false, execution: false, score: false, delete: false };

export const taskAccess = (u: User | null, task: Task | null): TaskAccess => {
  if (!u) return NONE;
  if (hasPermission(u, 'tasks.plan')) return {
    plan: true,
    execution: hasPermission(u, 'tasks.execute'),
    score: hasPermission(u, 'tasks.score'),
    delete: hasPermission(u, 'tasks.delete'),
  };
  // Исполнитель заводит собственные задачи и ведёт исполнение назначенных ему.
  if (!task) return { plan: true, execution: true, score: false, delete: false };
  const mine = task.assigneeIds.includes(u.employeeId);
  return { plan: false, execution: mine, score: false, delete: false };
};

/** Разделы, недоступные исполнителю. */
/**
 * Раздел администрирования открывается, если доступна хоть одна его вкладка. По умолчанию у каждой роли
 * есть «Редактирование UI», поэтому раздел виден всем, но администратор может это отозвать.
 */
export const canOpenAdmin = (u: User | null): boolean => hasPermission(u, 'admin.access') || ADMIN_TAB_PERMISSIONS.some((permission) => hasPermission(u, permission));

export const canOpenPath = (u: User | null, path: string): boolean => {
  if (path.startsWith('/admin')) return canOpenAdmin(u);
  if (path.startsWith('/reports') || path.startsWith('/kpi')) return hasPermission(u, 'reports.view');
  return !!u;
};

/** Что пользователь может делать с отсутствием. */
export type AbsenceAccess = { edit: boolean; decide: boolean; delete: boolean };

/**
 * Руководитель ведёт отсутствия всех и согласует заявки.
 * Исполнитель подаёт заявки только на себя и может менять или отзывать их, пока они не согласованы.
 */
export const absenceAccess = (u: User | null, a: Absence | null): AbsenceAccess => {
  if (!u) return { edit: false, decide: false, delete: false };
  if (hasPermission(u, 'absences.manage')) return { edit: true, decide: true, delete: true };
  if (!hasPermission(u, 'absences.request')) return { edit: false, decide: false, delete: false };
  if (!a) return { edit: true, decide: false, delete: false };
  const ownRequest = a.employeeId === u.employeeId && a.status === 'request';
  return { edit: ownRequest, decide: false, delete: ownRequest };
};
