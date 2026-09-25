import type { CSSProperties } from 'react';
import type { AbsenceType } from '../lib/types';

/** Цвет вида отсутствия для CSS-переменной --c; --c-rgb — тот же цвет тройкой r, g, b для полупрозрачных оттенков. */
export const absColor = (type: AbsenceType) => ({ '--c': `var(--abs-${type})`, '--c-rgb': `var(--abs-${type}-rgb)` }) as CSSProperties;
