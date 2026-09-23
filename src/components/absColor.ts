import type { CSSProperties } from 'react';
import type { AbsenceType } from '../lib/types';

/** Цвет вида отсутствия для CSS-переменной --c. */
export const absColor = (type: AbsenceType) => ({ '--c': `var(--abs-${type})` }) as CSSProperties;
