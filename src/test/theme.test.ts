// Тема оформления (src/lib/theme.ts): выбор запоминается за каждым сотрудником отдельно.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, personalThemeKey, readTheme, THEME_KEY } from '../lib/theme';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('тема оформления', () => {
  it('по умолчанию тёмная', () => {
    expect(readTheme()).toBe('dark');
    expect(readTheme(1)).toBe('dark');
  });

  it('выбор сохраняется за сотрудником и в общем ключе «последняя на этом компьютере»', () => {
    applyTheme('light', 1);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(personalThemeKey(1))).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('двое на одном компьютере не перебивают друг другу тему', () => {
    applyTheme('light', 1);
    applyTheme('dark', 2);
    // Общий ключ помнит последнего, но личные выборы не тронуты.
    expect(readTheme(1)).toBe('light');
    expect(readTheme(2)).toBe('dark');
  });

  it('у нового сотрудника берётся последняя тема на этом компьютере', () => {
    applyTheme('light', 1);
    expect(readTheme(7)).toBe('light');
    // После собственного выбора он от неё независим.
    applyTheme('dark', 7);
    expect(readTheme(7)).toBe('dark');
    expect(readTheme(1)).toBe('light');
  });

  it('без сотрудника (экран входа) тема пишется только в общий ключ', () => {
    applyTheme('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(Object.keys(localStorage).filter((k) => k.startsWith(`${THEME_KEY}:`))).toEqual([]);
  });
});
