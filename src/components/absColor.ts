import type { CSSProperties } from 'react';
import type { AbsenceType } from '../lib/types';

/** Цвет вида отсутствия для CSS-переменной --c. */
// Вместе с цветом передаются его каналы: rgb(var(--c-rgb) / доля) заменяет color-mix(), которого нет в Chrome 109.
export const absColor = (type: AbsenceType) =>
  ({ '--c': `var(--abs-${type})`, '--c-rgb': `var(--abs-${type}-rgb)` }) as CSSProperties;
