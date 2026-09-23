import { useSyncExternalStore } from 'react';

// Тема оформления. Основная — тёмная; выбор пользователя хранится в браузере.
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'task-control:theme';

export const readTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
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
