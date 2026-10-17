import { useMemo } from 'react';
import { employees } from './data';
import { useStore } from './store';
import { scopeOf, type Scope } from './visibility';
import type { Employee } from './types';

/** Область видимости задач вошедшего сотрудника (null — весь отдел). */
export const useScope = (): Scope => {
  // Скрытие сотрудника не меняет его права просмотра и область доступа.
  const { state } = useStore({ includeHidden: true });
  const id = state.user?.employeeId;
  return useMemo(() => (id == null ? new Set<number>() : scopeOf(id, state.users, state.units, state.roles)), [id, state.users, state.units, state.roles]);
};

/** Сотрудники, которых можно выбирать в фильтрах и назначать исполнителями. */
export const useScopeEmployees = (): Employee[] => {
  const scope = useScope();
  // Состав сотрудников живой (data.ts) и обновляется на месте, поэтому список не запоминается, а берётся заново.
  return scope === null ? [...employees] : employees.filter((e) => scope.has(e.id));
};
