import { accounts } from './data';
import { DEFAULT_ROLES, DEFAULT_USERS, sessionUser } from './access';
import type { ManagedUser, RoleDefinition } from './types';

/** Проверка логина и пароля; основной идентификатор — Windows-логин. */
export const authenticate = (login: string, password: string, users: ManagedUser[] = DEFAULT_USERS, roles: RoleDefinition[] = DEFAULT_ROLES) => {
  const key = login.trim().toLowerCase();
  const managed = users.find((item) => item.windowsLogin.toLowerCase() === key || item.email.toLowerCase() === key);
  if (!managed) return null;
  const account = accounts.find((item) => item.employeeId === managed.employeeId && item.password === password);
  if (!account) return null;
  return managed?.active ? sessionUser(managed, roles) : null;
};
