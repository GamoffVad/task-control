// Полосы прокрутки: во всём приложении только свои, системных быть не должно.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['src/kit/kit.css', 'src/index.css', 'src/screens/info.css'];

/** Стили без запасного блока для движков без ::-webkit-scrollbar. */
const withoutFallback = (css: string) => css.replace(/@supports\s+not\s+selector\(::-webkit-scrollbar\)\s*\{[^{}]*\{[^{}]*\}\s*\}/g, '');

describe('полосы прокрутки', () => {
  const css = FILES.map((file) => readFileSync(file, 'utf8')).join('\n');

  it('свои полосы заданы для всех элементов, включая страницу', () => {
    expect(css).toMatch(/\*::-webkit-scrollbar\s*\{[^}]*width:\s*10px/);
    expect(css).toMatch(/\*::-webkit-scrollbar-thumb\s*\{/);
    // Кнопки-стрелки системной полосы скрыты.
    expect(css).toMatch(/\*::-webkit-scrollbar-button\s*\{\s*display:\s*none/);
  });

  it('системные scrollbar-width и scrollbar-color не заданы: в Chrome 121+ они отключают свои полосы', () => {
    // Исключение — скрытая полоса меню (none) и запасной блок для Firefox.
    const active = withoutFallback(css).replace(/scrollbar-width:\s*none/g, '');
    expect(active).not.toMatch(/scrollbar-width\s*:/);
    expect(active).not.toMatch(/scrollbar-color\s*:/);
  });

  it('запасной вариант для Firefox есть и не касается Chromium', () => {
    expect(css).toMatch(/@supports\s+not\s+selector\(::-webkit-scrollbar\)/);
  });
});
