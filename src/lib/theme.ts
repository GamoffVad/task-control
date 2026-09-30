import { useSyncExternalStore } from 'react';

// Тема оформления. Основная — тёмная; выбор пользователя хранится в браузере.
export type Theme = 'dark' | 'light';

/**
 * Общий ключ хранит последнюю тему на этом компьютере: по нему рисуется экран входа и первый кадр.
 * Личный — «ключ:идентификатор сотрудника» — хранит выбор конкретного сотрудника, поэтому двое
 * на одном компьютере не перебивают друг другу тему.
 */
export const THEME_KEY = 'task-control:theme';
export const personalThemeKey = (employeeId: number) => `${THEME_KEY}:${employeeId}`;

export const readTheme = (employeeId?: number | null): Theme => {
  try {
    const personal = employeeId != null ? localStorage.getItem(personalThemeKey(employeeId)) : null;
    return (personal ?? localStorage.getItem(THEME_KEY)) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const applyTheme = (theme: Theme, employeeId?: number | null) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
    if (employeeId != null) localStorage.setItem(personalThemeKey(employeeId), theme);
  } catch {
    // Хранилище недоступно — тема действует до перезагрузки.
  }
};

/** Текущая тема страницы: следит за атрибутом data-theme, который ставит переключатель. */
export const useTheme = (): Theme =>
  useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  );
