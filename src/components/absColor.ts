import type { CSSProperties } from 'react';
import type { AbsenceType, DictionaryEntry } from '../lib/types';
import { eventColorKey } from '../lib/eventTypes';
import { dictionaryColorName, eventSubtype, type EventAppearance } from '../lib/eventPresentation';

/** Цвет вида отсутствия для CSS-переменной --c. */
// Вместе с цветом передаются его каналы: rgb(var(--c-rgb) / доля) заменяет color-mix(), которого нет в Chrome 109.
export const absColor = (event: AbsenceType | EventAppearance, entries: DictionaryEntry[] = []): CSSProperties => {
  const type = typeof event === 'string' ? event : event.type;
  const base = `--abs-${eventColorKey(type)}`;
  const subtype = typeof event === 'string' ? undefined : eventSubtype(event, entries);
  const color = subtype?.color ? dictionaryColorName(subtype.dictionary, subtype.code) : undefined;
  return { '--c': color ? `var(${color}, var(${base}, var(--accent)))` : `var(${base}, var(--accent))`,
    '--c-rgb': color ? `var(${color}-rgb, var(${base}-rgb, var(--accent-rgb)))` : `var(${base}-rgb, var(--accent-rgb))` } as CSSProperties;
};
