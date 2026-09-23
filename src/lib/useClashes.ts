import { useMemo } from 'react';
import { findClashes, type Clash } from './absences';
import { useStore } from './store';

/** Пересечения сроков задач с отсутствиями исполнителей — общие для всех разделов. */
export const useClashes = (): Clash[] => {
  const { state } = useStore();
  return useMemo(() => findClashes(state.tasks, state.absences), [state.tasks, state.absences]);
};
