import { toDateKey } from './dates';

export type Holiday = { date: string; description: string };
export const validHoliday = (h: Holiday): boolean => {
  if (!h || typeof h.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || typeof h.description !== 'string' || !h.description.trim() || h.description.length > 200) return false;
  const d = new Date(`${h.date}T00:00:00`);
  return !Number.isNaN(d.getTime()) && toDateKey(d) === h.date;
};
export const holidayFor = (day: Date, holidays: Holiday[] = []) => holidays.find((h) => h.date === toDateKey(day));
