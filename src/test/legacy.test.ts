// @vitest-environment node
// Совместимость с Chrome 109 — последним Chrome для Windows 7: в стилях нет color-mix() (Chrome 111+),
// а «двойники» --имя-rgb совпадают со своими цветами в обеих темах.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const STYLES = ['index.css', 'kit/kit.css', 'screens/info.css'];

/** Блок правил от селектора до закрывающей скобки. */
const block = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};

describe('Chrome 109 (Windows 7)', () => {
  it('стили не используют возможности новее Chrome 109', () => {
    for (const file of STYLES) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const feature of ['color-mix(', 'oklch(', 'oklab(', 'light-dark(', ' from var(', '@starting-style', '@scope', 'text-wrap:', 'field-sizing']) {
        expect(css.includes(feature), `${file}: ${feature}`).toBe(false);
      }
      // Вложенные правила CSS — Chrome 112.
      expect(/\{[^{}]*&[^{}]*\{/.test(css), `${file}: вложенные правила`).toBe(false);
    }
    expect(read('components/DictionaryColors.tsx')).not.toMatch(/color-mix\(\s*in/);
  });

  it('каждый --имя-rgb совпадает с цветом --имя в светлой и тёмной теме', () => {
    const css = read('index.css');
    for (const selector of [':root', ":root[data-theme='dark']"]) {
      const vars = new Map([...block(css, selector).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
      const twins = [...vars.keys()].filter((k) => k.endsWith('-rgb'));
      expect(twins.length).toBeGreaterThan(10);
      for (const twin of twins) {
        const hex = vars.get(twin.slice(0, -4))!;
        expect(hex, `${selector} --${twin}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        const n = parseInt(hex.slice(1), 16);
        expect(vars.get(twin), `${selector} --${twin}`).toBe(`${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`);
      }
    }
  });

  it('у каждого цвета, используемого в rgba(var(--…-rgb)), есть «двойник» в обеих темах', () => {
    const all = STYLES.map(read).join('\n');
    const css = read('index.css');
    const used = new Set([...all.matchAll(/var\(--([\w-]+)-rgb/g)].map((m) => m[1]).filter((n) => n !== 'c'));
    for (const selector of [':root', ":root[data-theme='dark']"]) {
      const body = block(css, selector);
      for (const name of used) expect(body.includes(`--${name}-rgb:`), `${selector} --${name}-rgb`).toBe(true);
    }
  });
});
