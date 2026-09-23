/**
 * Нижняя граница видимой области страницы: верх закреплённого подвала, если он есть,
 * иначе низ окна. Таблицы «на высоту экрана» считают от неё, чтобы подвал их не перекрывал.
 */
export const visibleBottom = (): number => {
  const footer = document.querySelector<HTMLElement>('.app-footer');
  if (footer && getComputedStyle(footer).position === 'fixed') return footer.getBoundingClientRect().top;
  return window.innerHeight;
};
