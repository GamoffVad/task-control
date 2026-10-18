import { addDays, fromDateKey, toDateKey } from './dates';
import { dutyTypeCode, dutyTypes, eventTypeExists } from './eventTypes';
import { vacationTypeCode, vacationTypes } from './vacations';
import { absenceAccess } from './permissions';
import { hasPermission } from './access';
import type { Absence, AppState, DictionaryEntry } from './types';

export type AbsenceBrush = { type: string; vacationType?: string; dutyType?: string };
export type AbsenceStroke = AbsenceBrush & { employeeId: number; from: string; to: string; mode: 'paint' | 'erase' };
export type BrushResult = { absences: Absence[]; error?: string; forbidden?: boolean };
const shift = (day: string, by: number) => toDateKey(addDays(fromDateKey(day), by));
const endOf = (a: Absence) => a.to ?? '9999-12-31';
const intersects = (a: Absence, from: string, to: string) => a.from <= to && endOf(a) >= from;
const dateKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '1900-01-01' && s <= '3000-12-31' && toDateKey(fromDateKey(s)) === s;

export const brushMatches = (a: Absence, brush: AbsenceBrush, entries: DictionaryEntry[]) => a.type === brush.type
  && (a.type !== 'vacation' || vacationTypeCode(a, entries) === vacationTypeCode(brush, entries))
  && (a.type !== 'duty' || dutyTypeCode(a, entries) === dutyTypeCode(brush, entries));

export const strokeError = (s: AbsenceStroke, entries: DictionaryEntry[]): string | undefined => {
  if (!s || !Number.isInteger(s.employeeId) || !['paint', 'erase'].includes(s.mode)) return 'Некорректное движение кисти.';
  if (!dateKey(s.from) || !dateKey(s.to) || s.from > s.to) return 'Некорректные даты периода.';
  if ((fromDateKey(s.to).getTime() - fromDateKey(s.from).getTime()) / 86_400_000 > 3660) return 'За одно движение можно выбрать не больше десяти лет.';
  if (!eventTypeExists(s.type, entries)) return 'Выбранный вид события больше не существует.';
  if (s.type === 'vacation' && !vacationTypes(entries).some((e) => e.code === vacationTypeCode(s, entries))) return 'Выберите существующий тип отпуска.';
  if (s.type === 'duty' && !dutyTypes(entries).some((e) => e.code === dutyTypeCode(s, entries))) return 'Выберите существующий вид дежурства.';
};

/** При разрезании отпуска дорога остаётся только на тех датах, на которых была задана. */
const fragment = (a: Absence, from: string, to: string | null, id: string): Absence => {
  if (a.type !== 'vacation' || !a.to || !to) return { ...a, id, from, to };
  const daysIn = (start: string, end: string) => {
    const left = from > start ? from : start, right = to < end ? to : end;
    return left > right ? 0 : Math.round((fromDateKey(right).getTime() - fromDateKey(left).getTime()) / 86_400_000) + 1;
  };
  return { ...a, id, from, to,
    travelDaysBefore: a.travelDaysBefore ? daysIn(a.from, shift(a.from, a.travelDaysBefore - 1)) : 0,
    travelDaysAfter: a.travelDaysAfter ? daysIn(shift(a.to, 1 - a.travelDaysAfter), a.to) : 0,
  };
};

/** Один жест — одна транзакция. Существующие записи и их дополнительные поля сохраняются. */
export const applyAbsenceStroke = (
  state: Pick<AppState, 'absences' | 'users' | 'user' | 'dictionaries'>,
  stroke: AbsenceStroke,
  now = new Date(),
  id: () => string = (() => { let n = 0; return () => `brush-preview-${++n}`; })(),
): BrushResult => {
  const fail = (error: string, forbidden = false): BrushResult => ({ absences: state.absences, error, forbidden });
  const invalid = strokeError(stroke, state.dictionaries);
  if (invalid) return fail(invalid);
  const { employeeId, from, to } = stroke;
  const manager = hasPermission(state.user, 'absences.manage');
  if (!absenceAccess(state.user, null).edit || (!manager && employeeId !== state.user?.employeeId)) return fail('Рисовать можно только доступные вам события.', true);
  if (!state.users.some((u) => u.employeeId === employeeId && !u.hidden)) return fail('Сотрудник недоступен в рабочих разделах.');
  const overlapping = state.absences.filter((a) => a.employeeId === employeeId && a.status !== 'rejected' && intersects(a, from, to));
  const matching = overlapping.filter((a) => brushMatches(a, stroke, state.dictionaries));
  if (stroke.mode === 'erase') {
    if (matching.some((a) => !absenceAccess(state.user, a).delete)) return fail('Согласованные события может стирать только руководитель.', true);
    const selected = new Set(matching.map((a) => a.id));
    const absences = state.absences.flatMap((a) => {
      if (!selected.has(a.id)) return [a];
      const pieces: Absence[] = [];
      if (a.from < from) pieces.push(fragment(a, a.from, shift(from, -1), a.id));
      if (endOf(a) > to) pieces.push(fragment(a, shift(to, 1), a.to, pieces.length ? id() : a.id));
      return pieces;
    });
    return { absences };
  }
  if (overlapping.some((a) => !brushMatches(a, stroke, state.dictionaries))) return fail('В диапазоне есть событие другого вида. Сначала сотрите его соответствующей кистью или измените через форму.');
  // Не переписываем существующие периоды того же вида: заполняем только свободные дни.
  const gaps: [string, string][] = [];
  let cursor = from;
  for (const a of matching.sort((a, b) => a.from.localeCompare(b.from))) {
    if (a.from > cursor) gaps.push([cursor, shift(a.from, -1)]);
    if (endOf(a) >= to) { cursor = shift(to, 1); break; }
    if (endOf(a) >= cursor) cursor = shift(endOf(a), 1);
  }
  if (cursor <= to) gaps.push([cursor, to]);
  const added: Absence[] = gaps.map(([start, end]) => ({
    id: id(), employeeId, type: stroke.type, from: start, to: end, note: '',
    ...(stroke.type === 'vacation' ? { vacationType: vacationTypeCode(stroke, state.dictionaries), travelDaysBefore: 0, travelDaysAfter: 0 } : {}),
    ...(stroke.type === 'duty' ? { dutyType: dutyTypeCode(stroke, state.dictionaries) } : {}),
    status: manager ? 'approved' : 'request', decidedBy: manager ? state.user!.employeeId : null, createdAt: now.toISOString(),
  }));
  return { absences: [...state.absences, ...added] };
};
