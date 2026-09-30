import { useEffect } from 'react';
import { appearanceCss } from '../lib/appearance';
import { useStore } from '../lib/store';
import { applyTheme, readTheme } from '../lib/theme';

/**
 * Личное оформление сотрудника поверх дизайн-системы: цвета, шрифты, размеры и тема.
 * Ставится до цветов справочников, чтобы цвет отдельного вида или категории оставался главнее.
 */
export const AppearanceStyles = () => {
  const { state } = useStore();
  const employeeId = state.user?.employeeId;

  // Как только известен сотрудник, включаем его тему. Нет личной — берём последнюю на этом компьютере
  // и запоминаем за ним, дальше выбор у каждого свой.
  useEffect(() => {
    if (employeeId != null) applyTheme(readTheme(employeeId), employeeId);
  }, [employeeId]);

  const css = appearanceCss(state.appearance);
  return css ? <style>{css}</style> : null;
};
