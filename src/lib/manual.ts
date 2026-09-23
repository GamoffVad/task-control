// Разбор документации docs/manual.html для раздела «Информация».
// Источник один и тот же для PDF и для приложения: главы берутся как есть,
// подставляются версия и число тестов, рисунки нумеруются, пути к скриншотам заменяются на адреса сборки.

export type ManualChapter = { no: string; title: string; html: string };

export type ManualOptions = {
  version: string;
  tests: number | null;
  /** Адрес скриншота по имени файла; null — картинку убрать. */
  shotUrl: (file: string) => string | null;
};

/** Скриншот светлой темы лежит рядом с тёмным: 07-control.png → 07-control.light.png. */
export const lightShot = (file: string) => file.replace(/\.png$/, '.light.png');

export const prepareManualHtml = (raw: string, { version, tests }: Pick<ManualOptions, 'version' | 'tests'>): string => {
  let figure = 0;
  return raw
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{TESTS}}', tests == null ? '—' : String(tests))
    .replace(/<span class="num">Рис\.[^<]*<\/span>/g, () => `<span class="num">Рис. ${++figure}</span>`);
};

export const parseManual = (raw: string, options: ManualOptions): ManualChapter[] => {
  const doc = new DOMParser().parseFromString(prepareManualHtml(raw, options), 'text/html');
  return [...doc.querySelectorAll<HTMLElement>('section.chapter')].map((section) => {
    const head = section.querySelector('.chapter-head');
    const no = head?.querySelector('.no')?.textContent?.trim() ?? '';
    const title = head?.querySelector('h2')?.textContent?.trim() ?? '';
    head?.remove();
    section.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      const url = src.startsWith('shots/') ? options.shotUrl(src.slice('shots/'.length)) : null;
      if (!url) {
        img.closest('figure')?.remove();
        img.remove();
        return;
      }
      img.setAttribute('src', url);
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      // Рисунок открывается в окне просмотра: кликом, Enter или пробелом.
      const caption = img.closest('figure')?.querySelector('figcaption');
      const no = caption?.querySelector('.num')?.textContent?.trim() ?? '';
      const text = (caption?.textContent ?? '').replace(no, '').trim();
      img.setAttribute('data-zoom', '');
      img.setAttribute('data-no', no);
      img.setAttribute('data-caption', text);
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.setAttribute('alt', text);
      img.setAttribute('aria-label', `Открыть рисунок${no ? ` ${no.replace('Рис. ', '')}` : ''}: ${text}`);
    });
    // Широкие таблицы прокручиваются в своей рамке, а не всей страницей.
    section.querySelectorAll('table').forEach((table) => {
      const wrap = doc.createElement('div');
      wrap.className = 'table-scroll';
      table.replaceWith(wrap);
      wrap.append(table);
    });
    return { no, title, html: section.innerHTML };
  });
};
