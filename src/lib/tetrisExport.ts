// Выгрузка «Тетриса» в Excel: та же матрица месяца — сотрудники по строкам, дни по колонкам.
// Цвет заливки ячейки берётся из справочника «Виды отсутствий», поэтому совпадает с цветом полосы на графике.

import { absenceDays, covers, fmtSpan } from './absences';
import { employees, shortName } from './data';
import { fmtDate, fmtMonthYear } from './dates';
import { buildXlsx, columnName, type Cell, type Sheet } from './xlsx';
import type { Absence, AbsenceType, DictionaryEntry, Employee, Task } from './types';

/** Цвета видов по умолчанию — те же, что в стилях приложения (светлая тема). */
const DEFAULT_COLORS: Record<string, string> = {
  vacation: '#9A6B12',
  trip: '#2F5480',
  dayoff: '#6A4C93',
  sick: '#983A6E',
  study: '#1E7268',
};

/** Осветление к белому: заливка ячейки должна оставаться читаемой под чёрным текстом. */
const lighten = (hex: string, share: number) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const mixed = [0, 2, 4].map((i) => Math.round(parseInt(full.slice(i, i + 2), 16) * share + 255 * (1 - share)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

export type TetrisExportInput = {
  month: Date;
  days: Date[];
  people: Employee[];
  absences: Absence[];
  tasks: Task[];
  dictionaries: DictionaryEntry[];
  /** Виды отсутствий с названиями — как в приложении. */
  types: { key: AbsenceType; label: string; full: string }[];
  /** Остаток отпуска и отгулов сотрудника; null — не показывать. */
  balance: (employeeId: number) => { vacation: number; dayoff: number } | null;
  /** Пересечения: задача со сроком во время согласованного отсутствия. */
  clashTaskIds: Set<string>;
  today: Date;
};

const HEAD = '#EFEBE3';
const WEEKEND = '#F3F1EC';
const INK = '#1F2B3A';

export const typeColor = (dictionaries: DictionaryEntry[], type: string) =>
  dictionaries.find((d) => d.dictionary === 'absenceType' && d.code === type)?.color ?? DEFAULT_COLORS[type] ?? '#8C816C';

/** Лист «Тетриса»: шапка, строки сотрудников, строка «Отсутствуют, %» и легенда. */
export const tetrisSheet = (input: TetrisExportInput): Sheet => {
  const { month, days, people, absences, tasks, dictionaries, types, balance, clashTaskIds, today } = input;
  const approved = (a: Absence) => a.status === 'approved';
  const rows: Sheet['rows'] = [];
  const merges: string[] = [];
  const lastColumn = columnName(days.length + 2);

  rows.push({ cells: [{ value: `График событий отдела — ${fmtMonthYear(month)}`, style: { bold: true } }] });
  merges.push(`A1:${lastColumn}1`);
  rows.push({ cells: [{ value: `Выгружено ${fmtDate(today)}. Цвет ячейки — вид события, светлый тон — заявка на согласовании.`, style: { color: '#5D6575' } }] });
  merges.push(`A2:${lastColumn}2`);
  rows.push({ cells: [] });

  // Шапка: дни месяца.
  const header: Cell[] = [
    { value: 'Сотрудник', style: { bold: true, fill: HEAD, border: true } },
    { value: 'Отпуск / отгулы', style: { bold: true, fill: HEAD, border: true, center: true, wrap: true } },
    ...days.map((d) => ({ value: d.getDate(), style: { bold: true, fill: [0, 6].includes(d.getDay()) ? WEEKEND : HEAD, border: true, center: true } })),
  ];
  rows.push({ height: 20, cells: header });

  for (const person of people) {
    const bal = balance(person.id);
    const mine = absences.filter((a) => a.employeeId === person.id && a.status !== 'rejected');
    const deadlines = tasks.filter((t) => t.assigneeIds.includes(person.id));
    const cells: (Cell | null)[] = [
      { value: shortName(person.id), style: { border: true } },
      { value: bal ? `${bal.vacation} / ${bal.dayoff}` : person.position, style: { border: true, center: !!bal, color: '#5D6575' } },
    ];
    for (const day of days) {
      const absence = mine.find((a) => covers(a, day, today));
      const marks = deadlines.filter((t) => new Date(t.end).toDateString() === day.toDateString());
      const done = marks.length > 0 && marks.every((t) => t.done);
      const clash = marks.some((t) => clashTaskIds.has(t.id));
      const text = marks.length === 0 ? '' : clash ? '!' : done ? '✓' : '•';
      const color = absence ? typeColor(dictionaries, absence.type) : null;
      cells.push({
        value: text,
        style: {
          border: true,
          center: true,
          // Согласованное — насыщенный тон, заявка — светлее: как штриховка на графике.
          fill: color ? lighten(color, approved(absence!) ? 0.55 : 0.25) : [0, 6].includes(day.getDay()) ? WEEKEND : undefined,
          color: clash ? '#A32D22' : INK,
          bold: !!text,
        },
      });
    }
    rows.push({ cells });
  }

  // Итоговая строка: доля отсутствующих по каждому дню.
  const share = days.map((day) => {
    const count = people.filter((p) => absences.some((a) => a.employeeId === p.id && approved(a) && covers(a, day, today))).length;
    return people.length ? Math.round((count / people.length) * 100) : 0;
  });
  rows.push({
    cells: [
      { value: 'Отсутствуют, %', style: { bold: true, fill: HEAD, border: true } },
      { value: '', style: { fill: HEAD, border: true } },
      ...share.map((value) => ({ value: value ? `${value}%` : '—', style: { border: true, center: true, fill: value > 30 ? '#F6D7D3' : HEAD, color: value > 30 ? '#A32D22' : INK } })),
    ],
  });

  rows.push({ cells: [] });
  rows.push({ cells: [{ value: 'Виды событий', style: { bold: true } }] });
  // Колонки дней узкие, поэтому подписи легенды и списка событий занимают по нескольку колонок.
  const span = (row: number, from: number, to: number) => {
    if (to > from) merges.push(`${columnName(from)}${row}:${columnName(Math.min(to, days.length + 2))}${row}`);
  };
  for (const type of types) {
    const color = typeColor(dictionaries, type.key);
    rows.push({
      cells: [
        { value: type.full, style: {} },
        { value: 'согласовано', style: { fill: lighten(color, 0.55), border: true, center: true } },
        { value: 'заявка', style: { fill: lighten(color, 0.25), border: true, center: true } },
      ],
    });
    span(rows.length, 3, 5);
  }
  rows.push({ cells: [{ value: 'Сроки задач: • назначен, ✓ исполнено, ! срок во время события', style: { color: '#5D6575' } }] });

  rows.push({ cells: [] });
  rows.push({ cells: [{ value: 'События месяца', style: { bold: true } }] });
  // Границы колонок списка событий: сотрудник, вид, период, дней, состояние, основание.
  const EVENT_SPANS: [number, number][] = [[1, 1], [2, 3], [4, 9], [10, 12], [13, 16], [17, days.length + 2]];
  const eventRow = (cells: Cell[]) => {
    const line: (Cell | null)[] = [];
    cells.forEach((cell, i) => {
      const [from, to] = EVENT_SPANS[i];
      line[from - 1] = cell;
      // Объединённой ячейке нужны соседи с тем же оформлением, иначе рамка обрывается.
      for (let c = from + 1; c <= to; c++) line[c - 1] = { value: '', style: cell.style };
    });
    rows.push({ cells: line });
    for (const [from, to] of EVENT_SPANS) span(rows.length, from, to);
  };
  eventRow(['Сотрудник', 'Вид', 'Период', 'Дней', 'Состояние', 'Основание'].map((value) => ({ value, style: { bold: true, fill: HEAD, border: true } })));
  const inMonth = absences
    .filter((a) => a.status !== 'rejected' && days.some((d) => covers(a, d, today)))
    .sort((a, b) => a.from.localeCompare(b.from) || a.employeeId - b.employeeId);
  for (const a of inMonth) {
    const type = types.find((t) => t.key === a.type);
    eventRow([
      { value: shortName(a.employeeId), style: { border: true } },
      { value: type?.full ?? a.type, style: { border: true, fill: lighten(typeColor(dictionaries, a.type), approved(a) ? 0.55 : 0.25) } },
      { value: fmtSpan(a), style: { border: true } },
      { value: absenceDays(a), style: { border: true, center: true } },
      { value: approved(a) ? 'согласовано' : 'заявка', style: { border: true } },
      { value: a.note, style: { border: true } },
    ]);
  }

  return {
    name: fmtMonthYear(month),
    columns: [22, 14, ...days.map(() => 4.2)],
    rows,
    merges,
    freeze: { rows: 4, columns: 2 },
  };
};

/** Готовый файл книги. */
export const tetrisXlsx = (input: TetrisExportInput): Blob => buildXlsx(tetrisSheet(input));

/** Сотрудники для выгрузки: те же, что показаны на графике. */
export const exportPeople = (ids: number[]): Employee[] => employees.filter((e) => ids.includes(e.id));
