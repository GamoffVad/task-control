import { useLayoutEffect, type RefObject } from 'react';
import { visibleBottom } from './viewport';

/**
 * Таблица «на высоту окна»: записывает в CSS-переменную высоту от верха элемента до закреплённого подвала
 * (за вычетом того, что стоит под элементом). Пересчитывается при каждой отрисовке и изменении размера окна.
 */
export const useFitHeight = (ref: RefObject<HTMLElement | null>, cssVar: string, min = 320) => {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const below = (el.nextElementSibling as HTMLElement | null)?.offsetHeight ?? 0;
      el.style.setProperty(cssVar, `${Math.max(min, Math.floor(visibleBottom() - top - below - (below ? 26 : 16)))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
};
