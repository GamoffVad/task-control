// Оформление интерфейса (src/lib/appearance.ts): приведение настроек к допустимым и стили поверх дизайн-системы.
import { describe, expect, it } from 'vitest';
import {
  appearanceCss,
  COLOR_TOKENS,
  DEFAULT_APPEARANCE,
  FONT_STACKS,
  isColor,
  MONO_STACKS,
  normalizeAppearance,
  rgbChannels,
  RGB_TOKENS,
  SIZE_TOKENS,
  tokenValue,
} from '../lib/appearance';

describe('оформление интерфейса', () => {
  it('без настроек ничего не переопределяет', () => {
    const settings = normalizeAppearance(undefined);
    expect(settings).toEqual(DEFAULT_APPEARANCE);
    expect(appearanceCss(settings)).toBe('');
  });

  it('принимает известные цвета и отбрасывает чужие', () => {
    const settings = normalizeAppearance({ light: { accent: '#7A1F3D', выдумка: '#000000', paper: 'не цвет' } } as never);
    expect(settings.light).toEqual({ accent: '#7a1f3d' });
  });

  it('цвет пересчитывается в каналы для rgb(var(--…-rgb) / доля)', () => {
    expect(rgbChannels('#2F5480')).toBe('47 84 128');
    // Короткая запись тоже допустима.
    expect(rgbChannels('#fff')).toBe('255 255 255');
    expect(isColor('#2F5480')).toBe(true);
    expect(isColor('2F5480')).toBe(false);
  });

  it('у токенов со спутником «-rgb» он пишется рядом', () => {
    const css = appearanceCss(normalizeAppearance({ light: { accent: '#7a1f3d', sheet: '#ffffff' } }));
    expect(css).toContain('--accent: #7a1f3d;');
    expect(css).toContain('--accent-rgb: 122 31 61;');
    // У «sheet» спутника нет — лишней переменной быть не должно.
    expect(css).toContain('--sheet: #ffffff;');
    expect(css).not.toContain('--sheet-rgb');
  });

  it('тёмная тема получает своё правило', () => {
    const css = appearanceCss(normalizeAppearance({ dark: { paper: '#101010' } }));
    expect(css).toContain(":root[data-theme='dark'] {");
    expect(css).toContain('--paper: #101010;');
    expect(css).toContain('--paper-rgb: 16 16 16;');
  });

  it('размеры ограничиваются, чтобы интерфейс не сломался', () => {
    const big = normalizeAppearance({ sizes: { base: 99, heading: 0, caps: 11, subtitle: 14 } });
    expect(big.sizes.base).toBe(SIZE_TOKENS.find((s) => s.name === 'base')!.max);
    expect(big.sizes.heading).toBe(SIZE_TOKENS.find((s) => s.name === 'heading')!.min);
    // Не заданный размер остаётся исходным.
    expect(big.sizes.caps).toBe(11);
    expect(appearanceCss(big)).toContain('--size-base: 20px;');
  });

  it('шрифт принимается только из списка: приложение ничего не загружает из интернета', () => {
    expect(normalizeAppearance({ fontBody: 'url(http://example.com/font.woff2)' }).fontBody).toBe(DEFAULT_APPEARANCE.fontBody);
    expect(normalizeAppearance({ fontBody: FONT_STACKS[2].value }).fontBody).toBe(FONT_STACKS[2].value);
    expect(normalizeAppearance({ fontMono: MONO_STACKS[1].value }).fontMono).toBe(MONO_STACKS[1].value);
  });

  it('значение токена берётся из настроек, иначе из дизайн-системы', () => {
    const accent = COLOR_TOKENS.find((t) => t.name === 'accent')!;
    const settings = normalizeAppearance({ light: { accent: '#7a1f3d' } });
    expect(tokenValue(settings, accent, 'light')).toBe('#7a1f3d');
    expect(tokenValue(settings, accent, 'dark')).toBe(accent.dark);
  });

  it('все токены со спутником «-rgb» есть в списке цветов', () => {
    const known = new Set(COLOR_TOKENS.map((t) => t.name));
    for (const name of RGB_TOKENS) expect(known.has(name), name).toBe(true);
    // И у каждого цвета значения обеих тем — настоящие цвета.
    for (const token of COLOR_TOKENS) {
      expect(isColor(token.light), token.name).toBe(true);
      expect(isColor(token.dark), token.name).toBe(true);
    }
  });
});
