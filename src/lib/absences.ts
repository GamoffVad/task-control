// Отсутствия: длительность, остатки отпуска и отгулов, пересечения со сроками задач.
import { addDays, fromDateKey, startOfDay, toDateKey } from './dates';
import type { Absence, AbsenceType, Entitlement, ManagedUser, Task, VacationSettings } from './types';
import { annualVacationDays, vacationPeriod, vacationYear } from './vacations';

/** Больничный без даты окончания считается длящимся ещё столько дней после сегодняшнего. */
export const OPEN_SICK_DAYS = 3;
export { DEFAULT_VACATION_DAYS } from './vacations';

export const isActive = (a: Absence) => a.status !== 'rejected';
export const isAbsence = (a: Pick<Absence, 'type'>) => a.type !== 'duty';

/** Последний день отсутствия; у открытого больничного — сегодня + OPEN_SICK_DAYS. */
export const absenceEnd = (a: Absence, today: Date = new Date()): Date => {
  if (a.to) return fromDateKey(a.to);
  const from = fromDateKey(a.from);
  const horizon = addDays(startOfDay(today), OPEN_SICK_DAYS);
  return horizon > from ? horizon : from;
};

export const covers = (a: Absence, day: Date, today: Date = new Date()): boolean => {
  const d = startOfDay(day);
  return d >= fromDateKey(a.from) && d <= absenceEnd(a, today);
};

const isWorkday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;

/** По одному отгулу за каждую субботу/воскресенье согласованного дежурства.
 * Только наступившие дни; совпадающие записи одного сотрудника не удваивают начисление. */
export const dutyDayoffs = (absences: Absence[], employeeId: number, year: number, today: Date = new Date()): number => {
  const dates = new Set<string>();
  const cutoff = startOfDay(today) < new Date(year, 11, 31) ? startOfDay(today) : new Date(year, 11, 31);
  for (const a of absences) {
    if (a.employeeId !== employeeId || a.type !== 'duty' || a.status !== 'approved' || !a.to) continue;
    const from = fromDateKey(a.from) > new Date(year, 0, 1) ? fromDateKey(a.from) : new Date(year, 0, 1);
    const to = fromDateKey(a.to) < cutoff ? fromDateKey(a.to) : cutoff;
    for (let d = from; d <= to; d = addDays(d, 1)) if (!isWorkday(d)) dates.add(toDateKey(d));
  }
  return dates.size;
};

export const dutyWeekendDays = (a: Pick<Absence, 'from' | 'to'>): number => {
  if (!a.to) return 0;
  let days = 0;
  for (let d = fromDateKey(a.from); d <= fromDateKey(a.to); d = addDays(d, 1)) if (!isWorkday(d)) days++;
  return days;
};

/** Дни отсутствия в интервале [from; to]: отгул — рабочие, остальное — календарные. */
export const daysBetween = (type: AbsenceType, from: Date, to: Date): number => {
  let n = 0;
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) if (type !== 'dayoff' || isWorkday(d)) n++;
  return n;
};

export const absenceDays = (a: Absence, today: Date = new Date()): number => daysBetween(a.type, fromDateKey(a.from), absenceEnd(a, today));
export const travelDays = (a: Pick<Absence, 'type' | 'travelDaysBefore' | 'travelDaysAfter'>): number => a.type === 'vacation' ? (a.travelDaysBefore ?? 0) + (a.travelDaysAfter ?? 0) : 0;
export const travelNote = (a: Absence): string => travelDays(a) ? `Дорога: туда ${a.travelDaysBefore ?? 0} дн., обратно ${a.travelDaysAfter ?? 0} дн.` : '';

/** Дни отсутствия, приходящиеся на заданный период. */
const daysInPeriod = (a: Absence, y0: Date, y1: Date, today: Date): number => {
  const from = addDays(fromDateKey(a.from), a.type === 'vacation' ? a.travelDaysBefore ?? 0 : 0);
  const to = addDays(absenceEnd(a, today), a.type === 'vacation' ? -(a.travelDaysAfter ?? 0) : 0);
  const s = from > y0 ? from : y0;
  const e = to < y1 ? to : y1;
  return s > e ? 0 : daysBetween(a.type, s, e);
};

export const entitlementFor = (list: Entitlement[], employeeId: number, year: number, users: ManagedUser[] = []): Entitlement =>
  list.find((e) => e.employeeId === employeeId && e.year === year) ?? {
    employeeId,
    year,
    vacationDays: annualVacationDays(users, list, employeeId),
    carriedOver: 0,
    dayoffAccrued: 0,
  };

export type Balance = {
  vacation: { total: number; used: number; current: number; planned: number; requested: number; left: number };
  dayoff: { accrued: number; used: number; requested: number; left: number };
  sick: { days: number; cases: number };
  trip: { days: number; cases: number };
  study: { days: number; cases: number };
};

/**
 * Остатки за год. Отпуск: использовано (прошедшие дни), текущий (идёт сейчас), запланировано (впереди),
 * заявки — отдельно и в остаток не входят, пока руководитель их не согласует.
 */
export const balanceFor = (absences: Absence[], entitlements: Entitlement[], employeeId: number, year: number, today: Date = new Date(), options: { users?: ManagedUser[]; settings?: VacationSettings; referenceDate?: Date } = {}): Balance => {
  const periodYear = vacationYear(options.referenceDate ?? new Date(year, today.getMonth(), today.getDate()), options.settings);
  const period = vacationPeriod(periodYear, options.settings);
  const ent = entitlementFor(entitlements, employeeId, periodYear, options.users);
  const calendarEnt = entitlementFor(entitlements, employeeId, year, options.users);
  const mine = absences.filter((a) => a.employeeId === employeeId && isActive(a));
  const t = startOfDay(today);
  const b: Balance = {
    vacation: { total: ent.vacationDays + ent.carriedOver, used: 0, current: 0, planned: 0, requested: 0, left: 0 },
    dayoff: { accrued: calendarEnt.dayoffAccrued + dutyDayoffs(absences, employeeId, year, today), used: 0, requested: 0, left: 0 },
    sick: { days: 0, cases: 0 },
    trip: { days: 0, cases: 0 },
    study: { days: 0, cases: 0 },
  };
  for (const a of mine) {
    const days = a.type === 'vacation' ? daysInPeriod(a, period.from, period.to, today) : daysInPeriod(a, new Date(year, 0, 1), new Date(year, 11, 31), today);
    if (!days) continue;
    if (a.type === 'vacation') {
      const vacationFrom = addDays(fromDateKey(a.from), a.travelDaysBefore ?? 0);
      const vacationTo = addDays(absenceEnd(a, today), -(a.travelDaysAfter ?? 0));
      if (a.status === 'request') b.vacation.requested += days;
      else if (vacationTo < t || period.to < t) b.vacation.used += days;
      else if (vacationFrom > t) b.vacation.planned += days;
      else b.vacation.current += days;
    } else if (a.type === 'dayoff') {
      if (a.status === 'request') b.dayoff.requested += days;
      else b.dayoff.used += days;
    } else if (a.type === 'sick' || a.type === 'trip' || a.type === 'study') {
      b[a.type].days += days;
      b[a.type].cases += 1;
    }
  }
  b.vacation.left = b.vacation.total - b.vacation.used - b.vacation.current - b.vacation.planned;
  b.dayoff.left = b.dayoff.accrued - b.dayoff.used;
  return b;
};

export type ClashSeverity = 'overdue' | 'risk' | 'request';

export type Clash = { task: Task; employeeId: number; absence: Absence; severity: ClashSeverity };

/**
 * Пересечение: срок неисполненной задачи приходится на отсутствие её исполнителя.
 * Прошедший срок — «просрочено», будущий — «под угрозой», отсутствие по заявке — «по заявке».
 */
export const findClashes = (tasks: Task[], absences: Absence[], today: Date = new Date()): Clash[] => {
  const active = absences.filter((a) => isActive(a) && isAbsence(a));
  const t = startOfDay(today);
  const out: Clash[] = [];
  for (const task of tasks) {
    if (task.done) continue;
    const end = new Date(task.end);
    for (const employeeId of task.assigneeIds) {
      const absence = active.find((a) => a.employeeId === employeeId && covers(a, end, today));
      if (!absence) continue;
      const severity: ClashSeverity = absence.status === 'request' ? 'request' : startOfDay(end) < t ? 'overdue' : 'risk';
      out.push({ task, employeeId, absence, severity });
    }
  }
  return out.sort((a, b) => a.task.end.localeCompare(b.task.end));
};

/** Отсутствие исполнителя в день срока задачи — для пометок в Календаре, Планировании и Контроле. */
export const clashFor = (clashes: Clash[], taskId: string): Clash | undefined => clashes.find((c) => c.task.id === taskId);

export type AbsenceDraft = Omit<Absence, 'id' | 'createdAt' | 'decidedBy'> & { id?: string };

export type AbsenceErrors = Partial<Record<'from' | 'to' | 'overlap' | 'travel', string>>;

export const validateAbsence = (d: AbsenceDraft, all: Absence[], today: Date = new Date()): AbsenceErrors => {
  const errors: AbsenceErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.from)) errors.from = 'Укажите первый день.';
  if (d.to === null && d.type !== 'sick') errors.to = 'Укажите последний день. Без даты окончания можно оформить только больничный.';
  if (d.to !== null && d.to < d.from) errors.to = 'Последний день раньше первого: исправьте даты.';
  if (d.type === 'vacation') {
    const values = [d.travelDaysBefore ?? 0, d.travelDaysAfter ?? 0];
    if (values.some((n) => !Number.isInteger(n) || n < 0 || n > 366)) errors.travel = 'Дни на дорогу: укажите целые числа от 0 до 366.';
    else if (!errors.from && !errors.to && d.to && travelDays(d) > daysBetween('vacation', fromDateKey(d.from), fromDateKey(d.to))) errors.travel = 'Дни на дорогу не могут превышать весь период отсутствия.';
  }
  if (!errors.from && !errors.to) {
    const probe: Absence = { ...d, id: d.id ?? 'new', createdAt: '', decidedBy: null };
    const s = fromDateKey(probe.from);
    const e = absenceEnd(probe, today);
    const other = all.find(
      (a) => a.id !== d.id && a.employeeId === d.employeeId && isActive(a) && fromDateKey(a.from) <= e && absenceEnd(a, today) >= s,
    );
    if (other) errors.overlap = `Даты пересекаются с другим событием: ${fmtSpan(other, today)}.`;
  }
  return errors;
};

const short = (key: string) => key.slice(8, 10) + '.' + key.slice(5, 7);

export const fmtSpan = (a: Pick<Absence, 'from' | 'to'>, _today?: Date): string => (a.to ? `${short(a.from)}–${short(a.to)}` : `с ${short(a.from)}, дата окончания не известна`);

export const todayKey = (today: Date = new Date()) => toDateKey(today);

/** Порог одновременных отпусков: при большей доле отдела в отпуске — предупреждение. */
export const VACATION_LIMIT = 0.3;

const onVacation = (absences: Absence[], ids: number[], day: Date, withRequests: boolean, today: Date) =>
  new Set(
    absences
      .filter((a) => a.type === 'vacation' && (a.status === 'approved' || (withRequests && a.status === 'request')) && ids.includes(a.employeeId) && covers(a, day, today))
      .map((a) => a.employeeId),
  ).size;

export type VacationLoad = {
  size: number;
  /** Больше всего сотрудников в отпуске одновременно (согласованные отпуска) и их доля. */
  peak: number;
  share: number;
  peakDays: Date[];
  /** То же, если согласовать все заявки. */
  peakWithRequests: number;
  shareWithRequests: number;
  /** Дни, когда порог превышен уже сейчас, и дни, когда его превысят заявки. */
  over: Date[];
  overWithRequests: Date[];
};

/** Загрузка отпусками по дням месяца для выбранных сотрудников. */
export const vacationLoad = (absences: Absence[], ids: number[], days: Date[], today: Date = new Date()): VacationLoad => {
  const size = ids.length;
  const load = days.map((day) => ({ day, approved: onVacation(absences, ids, day, false, today), all: onVacation(absences, ids, day, true, today) }));
  const peak = Math.max(0, ...load.map((l) => l.approved));
  const peakWithRequests = Math.max(0, ...load.map((l) => l.all));
  const over = (n: number) => size > 0 && n / size > VACATION_LIMIT;
  return {
    size,
    peak,
    share: size ? peak / size : 0,
    peakDays: peak > 0 ? load.filter((l) => l.approved === peak).map((l) => l.day) : [],
    peakWithRequests,
    shareWithRequests: size ? peakWithRequests / size : 0,
    over: load.filter((l) => over(l.approved)).map((l) => l.day),
    overWithRequests: load.filter((l) => !over(l.approved) && over(l.all)).map((l) => l.day),
  };
};

/** Доля сотрудников в отпуске в самый загруженный день заявки, если её согласовать. */
export const shareIfApproved = (absences: Absence[], request: Absence, ids: number[], today: Date = new Date()): number => {
  if (request.type !== 'vacation' || ids.length === 0) return 0;
  const others = absences.filter((a) => a.id !== request.id);
  const approved = [...others, { ...request, status: 'approved' as const }];
  let max = 0;
  for (let d = fromDateKey(request.from); d <= absenceEnd(request, today); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    max = Math.max(max, onVacation(approved, ids, d, false, today));
  }
  return max / ids.length;
};

export const fmtShare = (share: number): string => `${Math.round(share * 100)}%`;

/** Дни одного месяца диапазонами: «14–18.09, 21.09». */
export const fmtDayRanges = (days: Date[]): string => {
  const parts: string[] = [];
  const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j + 1 < days.length && days[j + 1].getTime() - days[j].getTime() <= 86_400_000 * 1.5) j++;
    parts.push(i === j ? dm(days[i]) : `${String(days[i].getDate()).padStart(2, '0')}–${dm(days[j])}`);
    i = j + 1;
  }
  return parts.join(', ');
};

/** Согласованное отсутствие сотрудника, пересекающее период [from, to] (по дням); первое по дате начала. */
export const absenceInPeriod = (absences: Absence[], employeeId: number, from: Date, to: Date, today: Date = new Date()): Absence | null => {
  const f = startOfDay(from);
  const t = startOfDay(to);
  return (
    absences
      .filter((a) => isAbsence(a) && a.employeeId === employeeId && a.status === 'approved' && fromDateKey(a.from) <= t && absenceEnd(a, today) >= f)
      .sort((a, b) => a.from.localeCompare(b.from))[0] ?? null
  );
};
