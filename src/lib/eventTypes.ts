import type { Absence, DictionaryEntry } from './types';

export const SYSTEM_EVENT_TYPES = [
  { key: 'vacation', label: 'Отпуск', full: 'Ежегодный отпуск' },
  { key: 'trip', label: 'Командировка', full: 'Командировка' },
  { key: 'dayoff', label: 'Отгул', full: 'Отгул' },
  { key: 'sick', label: 'Больничный', full: 'Больничный' },
  { key: 'study', label: 'Учёба', full: 'Обучение, курсы' },
  { key: 'duty', label: 'Дежурство', full: 'Дежурство' },
];
export const DEFAULT_DUTY_TYPE: DictionaryEntry = { id: 'dict-duty-regular', dictionary: 'dutyType', code: 'regular', title: 'Плановое дежурство' };
export const withDutyTypes = (entries: DictionaryEntry[]): DictionaryEntry[] => [
  ...entries,
  ...entries.some((e) => e.dictionary === 'absenceType' && e.code === 'duty') ? [] : [{ id: 'dict-absence-duty', dictionary: 'absenceType' as const, code: 'duty', title: 'Дежурство', color: '#446B46' }],
  ...entries.some((e) => e.dictionary === 'dutyType') ? [] : [{ ...DEFAULT_DUTY_TYPE }],
];
export const dutyTypes = (entries: DictionaryEntry[]) => withDutyTypes(entries).filter((e) => e.dictionary === 'dutyType');
export const dutyTypeCode = (a: Pick<Absence, 'dutyType'>, entries: DictionaryEntry[]) => a.dutyType ?? dutyTypes(entries).find((e) => e.code === 'regular')?.code ?? dutyTypes(entries)[0]!.code;
export const dutyTypeTitle = (a: Pick<Absence, 'dutyType'>, entries: DictionaryEntry[]) => dutyTypes(entries).find((e) => e.code === dutyTypeCode(a, entries))?.title ?? a.dutyType ?? 'Дежурство';
export const eventTypes = (entries: DictionaryEntry[]) => {
  const values = entries.filter((e) => e.dictionary === 'absenceType');
  return [
    ...SYSTEM_EVENT_TYPES.map((t) => { const entry = values.find((e) => e.code === t.key); return entry && entry.title !== t.label ? { key: t.key, label: entry.title, full: entry.title } : { ...t }; }),
    ...values.filter((e) => !SYSTEM_EVENT_TYPES.some((t) => t.key === e.code)).map((e) => ({ key: e.code, label: e.title, full: e.title })),
  ];
};
export const eventTypeExists = (code: unknown, entries: DictionaryEntry[]): code is string => typeof code === 'string' && eventTypes(entries).some((e) => e.key === code);

export const systemEvent = (code: string) => SYSTEM_EVENT_TYPES.some((t) => t.key === code);
/** Одинаковое безопасное имя CSS-переменной для любых кодов, включая кириллицу. */
export const eventColorKey = (code: string) => code.replace(/[^a-zA-Z0-9-]/gu, (c) => `_${c.codePointAt(0)!.toString(16)}_`);
export const dutyDictionaryInUse = (entry: DictionaryEntry, entries: DictionaryEntry[], absences: Absence[]) =>
  entry.dictionary === 'absenceType' ? systemEvent(entry.code) || absences.some((a) => a.type === entry.code)
    : entry.dictionary === 'dutyType' && (dutyTypes(entries).length <= 1 || absences.some((a) => a.type === 'duty' && dutyTypeCode(a, entries) === entry.code));
