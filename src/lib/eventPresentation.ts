import type { Absence, DictionaryEntry, DictionaryKind } from './types';
import { dutyTypeCode, dutyTypeTitle, eventColorKey, eventTypes } from './eventTypes';
import { vacationTypeCode, vacationTypeTitle } from './vacations';

const COLOR_NAMES = { absenceType: 'abs', taskCategory: 'cat', dutyType: 'duty', vacationType: 'vacation' } as const;
export const hasDictionaryColor = (kind: DictionaryKind): kind is keyof typeof COLOR_NAMES => Object.hasOwn(COLOR_NAMES, kind);
export const dictionaryColorName = (kind: DictionaryKind, code: string) => hasDictionaryColor(kind) ? `--${COLOR_NAMES[kind]}-${kind === 'taskCategory' ? code : eventColorKey(code)}` : undefined;
export type EventAppearance = Pick<Absence, 'type' | 'vacationType' | 'dutyType'>;
export const eventSubtype = (a: EventAppearance, entries: DictionaryEntry[]) => {
  const kind = a.type === 'vacation' ? 'vacationType' : a.type === 'duty' ? 'dutyType' : null;
  const code = a.type === 'vacation' ? vacationTypeCode(a, entries) : a.type === 'duty' ? dutyTypeCode(a, entries) : null;
  return kind ? entries.find((entry) => entry.dictionary === kind && entry.code === code) : undefined;
};
export const eventLabel = (a: EventAppearance, entries: DictionaryEntry[]) => a.type === 'vacation' ? vacationTypeTitle(a, entries)
  : a.type === 'duty' ? dutyTypeTitle(a, entries) : eventTypes(entries).find((entry) => entry.key === a.type)?.label ?? a.type;
