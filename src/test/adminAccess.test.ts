// Доступ к вкладкам администрирования: у каждой своё разрешение, «Редактирование UI» — у всех ролей по умолчанию.
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_TAB_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, permissionsFor, withAddedPermissions } from '../lib/access';
import { canOpenAdmin } from '../lib/permissions';
import { reducer } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { AppState, RoleDefinition, User } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

const NOW = new Date(2026, 8, 17, 12, 0);
const admin: User = { email: 'user@example.com', employeeId: 1, role: 'administrator', permissions: permissionsFor('administrator', DEFAULT_ROLES) };
const executor: User = { email: 'sidorov@example.com', employeeId: 3, role: 'executor', permissions: permissionsFor('executor', DEFAULT_ROLES) };
const stateFor = (user: User): AppState => ({ ...createSeed(NOW), user });

describe('разрешения вкладок администрирования', () => {
  it('у каждой вкладки есть разрешение в справочнике, и все они показываются в «Ролях»', () => {
    const catalogue = new Set(PERMISSIONS.map((item) => item.key));
    for (const permission of ADMIN_TAB_PERMISSIONS) expect(catalogue.has(permission), permission).toBe(true);
    // Девять вкладок — девять разрешений, «Редактирование UI» среди них.
    expect(new Set(ADMIN_TAB_PERMISSIONS).size).toBe(9);
    expect(PERMISSIONS.find((item) => item.key === 'appearance.manage')!.label).toContain('Редактирование UI');
  });

  it('«Редактирование UI» по умолчанию есть у всех ролей', () => {
    for (const role of DEFAULT_ROLES) expect(role.permissions, role.role).toContain('appearance.manage');
    // Остальные вкладки исполнителю не выдаются.
    expect(permissionsFor('executor', DEFAULT_ROLES).filter((p) => ADMIN_TAB_PERMISSIONS.includes(p))).toEqual(['appearance.manage']);
  });

  it('раздел открыт, пока доступна хоть одна вкладка, и закрывается, когда права отозваны', () => {
    expect(canOpenAdmin(admin)).toBe(true);
    expect(canOpenAdmin(executor)).toBe(true);
    expect(canOpenAdmin({ ...executor, permissions: ['tasks.execute'] })).toBe(false);
    expect(canOpenAdmin(null)).toBe(false);
  });

  it('базы прежних версий получают новые права при обновлении', () => {
    const old: RoleDefinition[] = [
      { role: 'administrator', name: 'Администратор', permissions: ['admin.access', 'users.manage', 'roles.manage'] },
      { role: 'executor', name: 'Исполнитель', permissions: ['tasks.execute'] },
    ];
    const migrated = withAddedPermissions(old);
    // Администратор получает вкладки, остальным достаётся только личное оформление.
    expect(migrated[0].permissions).toEqual(expect.arrayContaining(['units.manage', 'scoring.manage', 'planRows.manage', 'templates.manage', 'appearance.manage']));
    expect(migrated[1].permissions).toEqual(['tasks.execute', 'appearance.manage']);
    // Повторный запуск ничего не дублирует.
    expect(withAddedPermissions(migrated)).toEqual(migrated);
  });
});

describe('сохранение разрешений роли', () => {
  it('не теряет новые права: ручной список в редьюсере раньше их молча отбрасывал', () => {
    const state = stateFor(admin);
    const all = PERMISSIONS.map((item) => item.key);
    const next = reducer(state, { type: 'saveRolePermissions', role: 'administrator', permissions: all });
    expect(next.roles.find((r) => r.role === 'administrator')!.permissions).toEqual(all);
    // Права вкладок, добавленные позже остальных, на месте.
    for (const permission of ['scoring.manage', 'units.manage', 'planRows.manage', 'templates.manage', 'appearance.manage'] as const) {
      expect(next.roles.find((r) => r.role === 'administrator')!.permissions, permission).toContain(permission);
    }
  });

  it('право на «Редактирование UI» можно отозвать у роли — тогда вкладка исчезает', () => {
    const state = stateFor(admin);
    const next = reducer(state, { type: 'saveRolePermissions', role: 'executor', permissions: ['tasks.execute', 'absences.request'] });
    expect(next.roles.find((r) => r.role === 'executor')!.permissions).not.toContain('appearance.manage');
  });

  it('неизвестные разрешения по-прежнему отбрасываются', () => {
    const state = stateFor(admin);
    const next = reducer(state, { type: 'saveRolePermissions', role: 'executor', permissions: ['tasks.execute', 'выдумка' as never] });
    expect(next.roles.find((r) => r.role === 'executor')!.permissions).toEqual(['tasks.execute']);
  });
});
