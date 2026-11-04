import { describe, expect, it } from 'vitest';
import { createSeed } from '../lib/seed';
import { reducer } from '../lib/reducer';
import { employees, groupMembers, syncStaff } from '../lib/data';
import { DEFAULT_USERS } from '../lib/access';
import { DEFAULT_UNITS } from '../lib/units';

describe('должности и звания', () => {
  it('упорядочивает сотрудников по справочнику и пересчитывает порядок после изменения', () => {
    const users = [
      { ...DEFAULT_USERS[0], employeeId: 20, position: 'Начальник' },
      { ...DEFAULT_USERS[2], employeeId: 2, position: 'Специалист' },
      { ...DEFAULT_USERS[1], employeeId: 1, position: 'Неизвестная' },
    ];
    const dictionaries = [
      { id: 'p1', dictionary: 'position' as const, code: 'chief', title: 'Начальник', order: 1 },
      { id: 'p2', dictionary: 'position' as const, code: 'specialist', title: 'Специалист', order: 2 },
    ];
    try {
      syncStaff(users, DEFAULT_UNITS, dictionaries);
      expect(employees.map((e) => e.id)).toEqual([20, 2, 1]);
      expect(groupMembers('all').map((e) => e.id)).toEqual([20, 2, 1]);
      syncStaff(users, DEFAULT_UNITS, [{ ...dictionaries[0], order: 3 }, dictionaries[1]]);
      expect(employees.map((e) => e.id)).toEqual([2, 20, 1]);
    } finally { syncStaff(DEFAULT_USERS, DEFAULT_UNITS); }
  });
  it('сохраняет порядок, назначает значения, обновляет переименованные и защищает используемые', () => {
    let state = createSeed(new Date(2026, 0, 1));
    state = { ...state, user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } };
    state = reducer(state, { type: 'saveDictionary', draft: { dictionary: 'position', code: 'chief', title: 'Начальник' } });
    state = reducer(state, { type: 'saveDictionary', draft: { dictionary: 'position', code: 'specialist', title: 'Специалист' } });
    state = reducer(state, { type: 'saveDictionary', draft: { dictionary: 'rank', code: 'colonel', title: 'Полковник' } });
    const chief = state.dictionaries.find((d) => d.code === 'chief')!;
    const specialist = state.dictionaries.find((d) => d.code === 'specialist')!;
    expect([chief.order, specialist.order]).toEqual([1, 2]);
    state = reducer(state, { type: 'saveManagedUser', employeeId: 3, role: 'executor', active: true, position: 'Начальник', rank: 'Полковник' });
    expect(state.users.find((u) => u.employeeId === 3)).toMatchObject({ position: 'Начальник', rank: 'Полковник' });
    expect(reducer(state, { type: 'deleteDictionary', id: chief.id })).toBe(state);
    expect(reducer(state, { type: 'saveManagedUser', employeeId: 3, role: 'executor', active: true, rank: 'Несуществующее' })).toBe(state);
    state = reducer(state, { type: 'saveDictionary', draft: { ...chief, title: 'Руководитель', order: 3 } });
    expect(state.users.find((u) => u.employeeId === 3)?.position).toBe('Руководитель');
    expect(state.dictionaries.find((d) => d.id === chief.id)?.order).toBe(3);
  });
});
