// Оформление интерфейса (src/lib/appearance.ts): приведение настроек к допустимым и стили поверх дизайн-системы.
import { describe, expect, it } from 'vitest';
import {
  appearanceCss,
  BUILTIN_PRESETS,
  isPresetActive,
  MAX_PRESETS,
  presetsFor,
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

  it('готовые темы задают цвета обеих тем и не трогают чернила', () => {
    const light = BUILTIN_PRESETS.filter((p) => p.theme === 'light');
    const dark = BUILTIN_PRESETS.filter((p) => p.theme === 'dark');
    expect(light.length).toBeGreaterThan(1);
    expect(dark.length).toBeGreaterThan(1);
    const known = new Set(COLOR_TOKENS.map((t) => t.name));
    for (const preset of BUILTIN_PRESETS) {
      for (const [name, value] of Object.entries(preset.colors)) {
        expect(known.has(name), `${preset.id}: ${name}`).toBe(true);
        expect(isColor(value), `${preset.id}: ${value}`).toBe(true);
      }
      // Цвет текста темы не меняется, поэтому контраст остаётся прежним.
      for (const ink of ['ink', 'ink-2', 'ink-3', 'ink-4']) expect(preset.colors[ink]).toBeUndefined();
    }
    // Первые наборы — исходные темы без переопределений.
    expect(light[0].colors).toEqual({});
    expect(dark[0].colors).toEqual({});
  });

  it('свои темы проверяются: без имени и с чужими цветами не сохраняются', () => {
    const settings = normalizeAppearance({
      presets: [
        { id: 'a', name: 'Моя', theme: 'light', colors: { paper: '#EEEEEE', выдумка: '#000000' } },
        { id: 'b', name: '   ', theme: 'light', colors: {} },
        { id: 'a', name: 'Повтор идентификатора', theme: 'dark', colors: {} },
        { id: '', name: 'Без идентификатора', theme: 'dark', colors: {} },
      ],
    } as never);
    expect(settings.presets).toEqual([{ id: 'a', name: 'Моя', theme: 'light', colors: { paper: '#eeeeee' } }]);
  });

  it('число своих тем ограничено', () => {
    const many = Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({ id: `p${i}`, name: `Тема ${i}`, theme: 'light' as const, colors: {} }));
    expect(normalizeAppearance({ presets: many }).presets.length).toBe(MAX_PRESETS);
  });

  it('список тем показывает готовые и свои, выбранная определяется по цветам', () => {
    const mine = { id: 'mine', name: 'Моя', theme: 'light' as const, colors: { paper: '#eeeeee' } };
    const settings = normalizeAppearance({ presets: [mine], light: { paper: '#eeeeee' } });
    const list = presetsFor(settings, 'light');
    expect(list.filter((p) => p.builtin).length).toBeGreaterThan(1);
    expect(list.at(-1)).toMatchObject({ id: 'mine', builtin: false });
    expect(isPresetActive(settings, mine)).toBe(true);
    // Исходная тема без переопределений активна, только когда ничего не переопределено.
    expect(isPresetActive(settings, BUILTIN_PRESETS[0])).toBe(false);
    expect(isPresetActive(normalizeAppearance(undefined), BUILTIN_PRESETS[0])).toBe(true);
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
