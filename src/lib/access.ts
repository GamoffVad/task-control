import { STAFF_USERS } from './staff';
import type { ManagedUser, Permission, Role, RoleDefinition, User } from './types';

export const PERMISSIONS: { key: Permission; label: string; group: string }[] = [
  { key: 'admin.access', label: 'Открывать администрирование', group: 'Администрирование' },
  { key: 'authentication.manage', label: 'Настраивать способ входа', group: 'Администрирование' },
  { key: 'users.manage', label: 'Назначать роли пользователям', group: 'Администрирование' },
  { key: 'roles.manage', label: 'Настраивать роли и разрешения', group: 'Администрирование' },
  { key: 'dictionaries.manage', label: 'Редактировать словари', group: 'Администрирование' },
  { key: 'reports.view', label: 'Просматривать отчётность и показатели', group: 'Работа отдела' },
  { key: 'tasks.plan', label: 'Планировать задачи для сотрудников', group: 'Задачи' },
  { key: 'tasks.execute', label: 'Вести исполнение назначенных задач', group: 'Задачи' },
  { key: 'tasks.score', label: 'Назначать баллы', group: 'Задачи' },
  { key: 'tasks.delete', label: 'Удалять задачи', group: 'Задачи' },
  { key: 'absences.manage', label: 'Вести отсутствия и согласовывать заявки', group: 'Отсутствия' },
  { key: 'absences.request', label: 'Подавать заявки на отсутствие', group: 'Отсутствия' },
  { key: 'entitlements.manage', label: 'Изменять нормы отпусков и отгулов', group: 'Отсутствия' },
  { key: 'data.reset', label: 'Восстанавливать демонстрационные данные', group: 'Система' },
];

const ALL = PERMISSIONS.map((item) => item.key);

export const DEFAULT_ROLES: RoleDefinition[] = [
  { role: 'administrator', name: 'Администратор', permissions: [...ALL] },
  {
    role: 'manager',
    name: 'Руководитель',
    permissions: ['reports.view', 'tasks.plan', 'tasks.execute', 'tasks.score', 'tasks.delete', 'absences.manage', 'absences.request', 'entitlements.manage'],
  },
  { role: 'executor', name: 'Исполнитель', permissions: ['tasks.execute', 'absences.request'] },
];

export const DEFAULT_USERS: ManagedUser[] = [
  { email: 'user@example.com', fullName: 'Иванов Алексей Борисович', position: 'Начальник отдела', windowsLogin: 'user', employeeId: 1, role: 'administrator', active: true, unitId: 'g-1' },
  { email: 'petrov@example.com', fullName: 'Петров Василий Сергеевич', position: 'Заместитель начальника', windowsLogin: 'petrov', employeeId: 2, role: 'manager', active: true, unitId: 'g-1' },
  { email: 'sidorov@example.com', fullName: 'Сидоров Дмитрий Евгеньевич', position: 'Ведущий специалист', windowsLogin: 'sidorov', employeeId: 3, role: 'executor', active: true, unitId: 'g-2' },
  { email: 'kuznetsov@example.com', fullName: 'Кузнецов Михаил Петрович', position: 'Специалист', windowsLogin: 'kuznetsov', employeeId: 4, role: 'executor', active: true, unitId: 'g-2' },
  { email: 'petrenko@example.com', fullName: 'Петренко Павел Андреевич', position: 'Специалист', windowsLogin: 'petrenko', employeeId: 5, role: 'executor', active: true, unitId: 'g-3' },
  { email: 'serdyuk@example.com', fullName: 'Сердюк Сергей Олегович', position: 'Младший специалист', windowsLogin: 'serdyuk', employeeId: 6, role: 'executor', active: true, unitId: 'g-3' },
  { email: 'smirnova@example.com', fullName: 'Смирнова Ольга Леонидовна', position: 'Документовед', windowsLogin: 'smirnova', employeeId: 7, role: 'executor', active: true, unitId: 'g-4' },
  ...STAFF_USERS,
];

export const DEFAULT_AUTHENTICATION = { mode: 'form', allowEmergencyForm: true } as const;

export const permissionsFor = (role: Role, roles: RoleDefinition[] = DEFAULT_ROLES): Permission[] =>
  roles.find((item) => item.role === role)?.permissions ?? DEFAULT_ROLES.find((item) => item.role === role)!.permissions;

export const sessionUser = (account: ManagedUser, roles: RoleDefinition[]): User => ({
  email: account.email,
  employeeId: account.employeeId,
  role: account.role,
  permissions: permissionsFor(account.role, roles),
});

export const effectiveUser = (user: User | null, users: ManagedUser[], roles: RoleDefinition[]): User | null => {
  if (!user) return null;
  const account = users.find((item) => item.employeeId === user.employeeId && item.email.toLowerCase() === user.email.toLowerCase());
  return account?.active ? sessionUser(account, roles) : null;
};

export const hasPermission = (user: User | null, permission: Permission): boolean =>
  !!user && (user.permissions ?? permissionsFor(user.role)).includes(permission);

export const roleLabel = (role: Role, roles: RoleDefinition[] = DEFAULT_ROLES): string =>
  roles.find((item) => item.role === role)?.name ?? role;
