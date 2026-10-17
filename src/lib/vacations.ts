import { addDays, fmtDate, startOfDay } from './dates';
import type { Absence, DictionaryEntry, Entitlement, ManagedUser, VacationSettings } from './types';

export const DEFAULT_VACATION_SETTINGS: VacationSettings = { resetMonth: 1, resetDay: 1 };
export const DEFAULT_VACATION_DAYS = 28;
export const DEFAULT_VACATION_TYPE: DictionaryEntry = { id: 'dict-vacation-annual', dictionary: 'vacationType', code: 'annual', title: 'Ежегодный отпуск' };
export const validVacationSettings = (s: VacationSettings) => Number.isInteger(s.resetMonth) && s.resetMonth >= 1 && s.resetMonth <= 12 && Number.isInteger(s.resetDay) && s.resetDay >= 1 && s.resetDay <= new Date(2000, s.resetMonth, 0).getDate();
export const validVacationDays = (n: number) => Number.isInteger(n) && n >= 0 && n <= 366;
export const normalizeVacationSettings = (s?: VacationSettings): VacationSettings => s && validVacationSettings(s) ? s : DEFAULT_VACATION_SETTINGS;

const resetAt = (year: number, settings?: VacationSettings) => {
  const s = normalizeVacationSettings(settings);
  // 29 февраля в невисокосном году приходится на последний день февраля.
  return new Date(year, s.resetMonth - 1, Math.min(s.resetDay, new Date(year, s.resetMonth, 0).getDate()));
};
export const vacationYear = (date: Date, settings?: VacationSettings): number => date.getFullYear() - (startOfDay(date) < resetAt(date.getFullYear(), settings) ? 1 : 0);
export const vacationPeriod = (year: number, settings?: VacationSettings) => ({ from: resetAt(year, settings), to: addDays(resetAt(year + 1, settings), -1) });
export const vacationPeriodLabel = (year: number, settings?: VacationSettings) => {
  const p = vacationPeriod(year, settings);
  return `${fmtDate(p.from)} — ${fmtDate(p.to)}`;
};
export const annualVacationDays = (users: ManagedUser[], list: Entitlement[], employeeId: number): number => users.find((u) => u.employeeId === employeeId)?.annualVacationDays ?? list.filter((e) => e.employeeId === employeeId).sort((a, b) => b.year - a.year)[0]?.vacationDays ?? DEFAULT_VACATION_DAYS;
export const withVacationTypes = (entries: DictionaryEntry[]): DictionaryEntry[] => entries.some((e) => e.dictionary === 'vacationType') ? entries : [...entries, { ...DEFAULT_VACATION_TYPE }];
export const vacationTypes = (entries: DictionaryEntry[]) => withVacationTypes(entries).filter((e) => e.dictionary === 'vacationType');
export const vacationTypeCode = (a: Pick<Absence, 'vacationType'>, entries: DictionaryEntry[]) => a.vacationType ?? vacationTypes(entries).find((e) => e.code === 'annual')?.code ?? vacationTypes(entries)[0]!.code;
export const vacationTypeTitle = (a: Pick<Absence, 'vacationType'>, entries: DictionaryEntry[]) => vacationTypes(entries).find((e) => e.code === vacationTypeCode(a, entries))?.title ?? a.vacationType ?? 'Отпуск';
