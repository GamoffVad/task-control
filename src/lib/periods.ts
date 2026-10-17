import { addDays, startOfDay } from './dates';
import type { PeriodSettings, WeeklyPeriod } from './types';

export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = { planning: { startDay: 5, endDay: 4 }, reporting: { startDay: 5, endDay: 4 } };
export const WEEKDAYS = [
  { value: 1, label: 'Понедельник', from: 'понедельника' },
  { value: 2, label: 'Вторник', from: 'вторника' },
  { value: 3, label: 'Среда', from: 'среды' },
  { value: 4, label: 'Четверг', from: 'четверга' },
  { value: 5, label: 'Пятница', from: 'пятницы' },
  { value: 6, label: 'Суббота', from: 'субботы' },
  { value: 0, label: 'Воскресенье', from: 'воскресенья' },
];
const validWeeklyPeriod = (p: unknown): p is WeeklyPeriod => !!p && typeof p === 'object' && ['startDay', 'endDay'].every((k) => { const n = (p as Record<string, unknown>)[k]; return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6; });
export const validPeriodSettings = (p: unknown): p is PeriodSettings => !!p && typeof p === 'object' && validWeeklyPeriod((p as PeriodSettings).planning) && validWeeklyPeriod((p as PeriodSettings).reporting);
export const normalizePeriodSettings = (p?: PeriodSettings): PeriodSettings => validPeriodSettings(p) ? { planning: { ...p.planning }, reporting: { ...p.reporting } } : { planning: { ...DEFAULT_PERIOD_SETTINGS.planning }, reporting: { ...DEFAULT_PERIOD_SETTINGS.reporting } };
/** Период повторяется каждые семь дней; последний день включён. */
export const weeklyPeriodDays = (p: WeeklyPeriod): number => (p.endDay - p.startDay + 7) % 7 + 1;
export const weeklyPeriodStart = (date: Date, p: WeeklyPeriod): Date => addDays(startOfDay(date), -((date.getDay() - p.startDay + 7) % 7));
export const weeklyPeriodEnd = (from: Date, p: WeeklyPeriod): Date => addDays(startOfDay(from), weeklyPeriodDays(p) - 1);
export const weeklyPeriodLabel = (p: WeeklyPeriod): string => `${WEEKDAYS.find((d) => d.value === p.startDay)!.label} — ${WEEKDAYS.find((d) => d.value === p.endDay)!.label.toLocaleLowerCase('ru')}`;
/** Не более семи календарных дней, независимо от перевода часов. */
export const validReportRange = (from: Date, to: Date): boolean => {
  const ordinal = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const days = ordinal(to) - ordinal(from);
  return Number.isFinite(days) && days >= 0 && days <= 6;
};
