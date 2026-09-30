import { useEffect } from 'react';
import { faviconHref } from '../lib/favicon';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

/**
 * Значок вкладки в цветах логотипа. Цвета берутся уже вычисленными со страницы,
 * поэтому значок повторяет и тему, и настройки оформления, и выбранную цветовую тему.
 */
export const Favicon = () => {
  const { state } = useStore();
  const theme = useTheme();

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const href = faviconHref({
      dark: read('--logo-dark', '#1F2B3A'),
      accent: read('--logo-1', '#1F3A5F'),
      paper: read('--paper', '#F1EDE6'),
      darkAlpha: Number(read('--logo-dark-alpha', '1')) || 1,
    });
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
    link.type = 'image/svg+xml';
    link.href = href;
  }, [state.appearance, theme]);

  return null;
};
