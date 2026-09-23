import type { DeadlineBucket, Period } from './types';

const DAY = 24 * 60 * 60 * 1000;

export const startOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

export const addMonths = (d: Date, n: number): Date => {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
};

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Понедельник недели, в которую попадает дата. */
export const startOfWeek = (d: Date): Date => {
  const r = startOfDay(d);
  const shift = (r.getDay() + 6) % 7;
  return addDays(r, -shift);
};

/** Пятница, с которой начинается плановая неделя (пятница — четверг). */
export const planWeekStart = (d: Date): Date => {
  const r = startOfDay(d);
  const shift = (r.getDay() + 2) % 7;
  return addDays(r, -shift);
};

/** Плановая неделя: [пятница, следующая пятница). */
export const planWeekRange = (weekStart: Date): { from: Date; to: Date } => ({
  from: startOfDay(weekStart),
  to: addDays(startOfDay(weekStart), 7),
});

export const inRange = (d: Date, from: Date, to: Date): boolean => d >= from && d < to;

export const toDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Значение для <input type="datetime-local">. */
export const toInputDateTime = (d: Date): string => {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${toDateKey(d)}T${hh}:${mm}`;
};

export const fromInputDateTime = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
};

const RU = 'ru-RU';

export const fmtDate = (d: Date): string => d.toLocaleDateString(RU, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtDayMonth = (d: Date): string => d.toLocaleDateString(RU, { day: 'numeric', month: 'long' });
export const fmtTime = (d: Date): string => d.toLocaleTimeString(RU, { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (d: Date): string => `${fmtDate(d)} ${fmtTime(d)}`;
export const fmtMonthYear = (d: Date): string => {
  const s = d.toLocaleDateString(RU, { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const fmtWeekday = (d: Date): string => d.toLocaleDateString(RU, { weekday: 'short' }).replace('.', '');

/** «11 – 17 сентября» / «28 августа – 3 сентября». */
export const fmtRange = (from: Date, toInclusive: Date): string => {
  if (from.getMonth() === toInclusive.getMonth()) {
    return `${from.getDate()} – ${fmtDayMonth(toInclusive)}`;
  }
  return `${fmtDayMonth(from)} – ${fmtDayMonth(toInclusive)}`;
};

/** Распределение срока по колонкам «Контроля исполнения». */
export const deadlineBucket = (deadline: Date, now: Date = new Date()): DeadlineBucket => {
  const today = startOfDay(now);
  const day = startOfDay(deadline);
  if (day < today) return 'overdue';
  if (day.getTime() === today.getTime()) return 'today';
  const nextMonday = addDays(startOfWeek(today), 7);
  if (day < nextMonday) return 'week';
  if (day < addDays(nextMonday, 7)) return 'nextWeek';
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const horizon = new Date(Math.max(monthEnd.getTime(), today.getTime() + 30 * DAY));
  if (day < horizon) return 'month';
  // Квартал: до конца текущего квартала, но не меньше трёх месяцев вперёд — как с месяцем.
  const quarterEnd = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 1);
  const quarterHorizon = new Date(Math.max(quarterEnd.getTime(), addMonths(today, 3).getTime()));
  if (day < quarterHorizon) return 'quarter';
  return 'later';
};

/** Срок по умолчанию для новой задачи из колонки «Контроля». */
export const defaultDeadlineFor = (bucket: DeadlineBucket, now: Date = new Date()): Date => {
  const today = startOfDay(now);
  const at18 = (d: Date) => {
    const r = new Date(d);
    r.setHours(18, 0, 0, 0);
    return r;
  };
  const friday = addDays(startOfWeek(today), 4);
  switch (bucket) {
    case 'today':
    case 'overdue':
      return at18(today);
    case 'week': {
      // Ближайшая пятница; если она уже сегодня или прошла — следующий день этой же недели.
      const candidate = friday > today ? friday : addDays(today, 1);
      return at18(candidate < addDays(startOfWeek(today), 7) ? candidate : today);
    }
    case 'nextWeek':
      return at18(addDays(friday, 7));
    case 'month':
      return at18(addDays(friday, 14));
    case 'quarter':
    case 'later':
      return at18(addDays(friday, 49));
  }
};

export const periodStart = (period: Period, now: Date = new Date()): Date | null => {
  switch (period) {
    case 'all':
      return null;
    case 'month':
      return addMonths(now, -1);
    case 'quarter':
      return addMonths(now, -3);
    case 'half':
      return addMonths(now, -6);
    case 'year':
      return addMonths(now, -12);
  }
};

export const PERIOD_LABELS: Record<Period, string> = {
  all: 'Всё время',
  month: 'Месяц',
  quarter: 'Квартал',
  half: 'Полугодие',
  year: 'Год',
};

/** Согласование: 1 балл, 2 балла, 5 баллов, 1.5 балла. */
export const plural = (n: number, one: string, few: string, many: string): string => {
  if (!Number.isInteger(n)) return few;
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export const points = (n: number): string => `${fmtNum(n)} ${plural(n, 'балл', 'балла', 'баллов')}`;

export const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
