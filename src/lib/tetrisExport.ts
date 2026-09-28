// Выгрузка «Тетриса» в Excel: книга из нескольких листов — график месяца, события,
// пересечения со сроками задач и остатки. Цвет заливки берётся из справочника «Виды отсутствий»,
// поэтому совпадает с цветом полосы на графике.

import { absenceDays, covers, fmtSpan, type Clash } from './absences';
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
  /** Пересечения: срок неисполненной задачи приходится на событие её исполнителя. */
  clashes: Clash[];
  today: Date;
};

const HEAD = '#EFEBE3';
const WEEKEND = '#F3F1EC';
const INK = '#1F2B3A';
const DANGER = '#A32D22';
const MUTED = '#5D6575';

export const typeColor = (dictionaries: DictionaryEntry[], type: string) =>
  dictionaries.find((d) => d.dictionary === 'absenceType' && d.code === type)?.color ?? DEFAULT_COLORS[type] ?? '#8C816C';

const SEVERITY: Record<Clash['severity'], string> = { overdue: 'Просрочено', risk: 'Под угрозой', request: 'По заявке' };

const approved = (a: Absence) => a.status === 'approved';

/** Заголовок листа: название и пояснение над таблицей. Шапка таблицы — четвёртая строка. */
const titleRows = (title: string, note: string, lastColumn: string, merges: string[]): Sheet['rows'] => {
  merges.push(`A1:${lastColumn}1`, `A2:${lastColumn}2`);
  return [{ cells: [{ value: title, style: { bold: true } }] }, { cells: [{ value: note, style: { color: MUTED } }] }, { cells: [] }];
};

const headerRow = (titles: string[]): Sheet['rows'][number] => ({
  cells: titles.map((value) => ({ value, style: { bold: true, fill: HEAD, border: true } })),
});

/** Лист «График»: дни по колонкам, сотрудники по строкам, «Отсутствуют, %» и легенда. */
const chartSheet = (input: TetrisExportInput): Sheet => {
  const { month, days, people, absences, tasks, dictionaries, types, balance, clashes, today } = input;
  const clashTaskIds = new Set(clashes.map((c) => c.task.id));
  const merges: string[] = [];
  const lastColumn = columnName(days.length + 2);
  const rows = titleRows(
    `График событий отдела — ${fmtMonthYear(month)}`,
    `Выгружено ${fmtDate(today)}. Цвет ячейки — вид события, светлый тон — заявка на согласовании.`,
    lastColumn,
    merges,
  );

  rows.push({
    height: 20,
    cells: [
      { value: 'Сотрудник', style: { bold: true, fill: HEAD, border: true } },
      { value: 'Отпуск / отгулы', style: { bold: true, fill: HEAD, border: true, center: true, wrap: true } },
      ...days.map((d) => ({ value: d.getDate(), style: { bold: true, fill: [0, 6].includes(d.getDay()) ? WEEKEND : HEAD, border: true, center: true } })),
    ],
  });

  for (const person of people) {
    const bal = balance(person.id);
    const mine = absences.filter((a) => a.employeeId === person.id && a.status !== 'rejected');
    const deadlines = tasks.filter((t) => t.assigneeIds.includes(person.id));
    const cells: (Cell | null)[] = [
      { value: shortName(person.id), style: { border: true } },
      { value: bal ? `${bal.vacation} / ${bal.dayoff}` : person.position, style: { border: true, center: !!bal, color: MUTED } },
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
          color: clash ? DANGER : INK,
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
      ...share.map((value) => ({ value: value ? `${value}%` : '—', style: { border: true, center: true, fill: value > 30 ? '#F6D7D3' : HEAD, color: value > 30 ? DANGER : INK } })),
    ],
  });

  // Легенда под графиком — там же, где она на экране.
  rows.push({ cells: [] });
  rows.push({ cells: [{ value: 'Виды событий', style: { bold: true } }] });
  for (const type of types) {
    const color = typeColor(dictionaries, type.key);
    rows.push({
      cells: [
        { value: type.full, style: {} },
        { value: 'согласовано', style: { fill: lighten(color, 0.55), border: true, center: true } },
        { value: 'заявка', style: { fill: lighten(color, 0.25), border: true, center: true } },
      ],
    });
    // Колонки дней узкие, поэтому подпись «заявка» занимает несколько колонок.
    merges.push(`C${rows.length}:${columnName(Math.min(5, days.length + 2))}${rows.length}`);
  }
  rows.push({ cells: [{ value: 'Сроки задач: • назначен, ✓ исполнено, ! срок во время события', style: { color: MUTED } }] });

  return { name: 'График', columns: [22, 14, ...days.map(() => 4.2)], rows, merges, freeze: { rows: 4, columns: 2 } };
};

/** Лист «События»: события месяца списком, каждое поле — в своей колонке. */
const eventsSheet = (input: TetrisExportInput): Sheet => {
  const { month, days, absences, dictionaries, types, today } = input;
  const merges: string[] = [];
  const rows = titleRows(`События месяца — ${fmtMonthYear(month)}`, `Выгружено ${fmtDate(today)}. Отклонённые события не выгружаются.`, 'F', merges);
  rows.push(headerRow(['Сотрудник', 'Вид', 'Период', 'Дней', 'Состояние', 'Основание']));

  const inMonth = absences
    .filter((a) => a.status !== 'rejected' && days.some((d) => covers(a, d, today)))
    .sort((a, b) => a.from.localeCompare(b.from) || a.employeeId - b.employeeId);
  for (const a of inMonth) {
    const type = types.find((t) => t.key === a.type);
    rows.push({
      cells: [
        { value: shortName(a.employeeId), style: { border: true } },
        { value: type?.full ?? a.type, style: { border: true, fill: lighten(typeColor(dictionaries, a.type), approved(a) ? 0.55 : 0.25) } },
        { value: fmtSpan(a), style: { border: true } },
        { value: absenceDays(a), style: { border: true, center: true } },
        { value: approved(a) ? 'согласовано' : 'заявка', style: { border: true } },
        { value: a.note, style: { border: true, wrap: true } },
      ],
    });
  }
  if (!inMonth.length) rows.push({ cells: [{ value: 'В этом месяце событий нет.', style: { color: MUTED } }] });

  return { name: 'События', columns: [24, 24, 22, 8, 16, 46], rows, merges, freeze: { rows: 4, columns: 1 } };
};

/** Лист «Пересечения»: задачи, срок которых приходится на событие исполнителя. */
const clashesSheet = (input: TetrisExportInput): Sheet => {
  const { month, clashes, dictionaries, types, today } = input;
  const merges: string[] = [];
  const rows = titleRows(
    `Пересечения со сроками задач — ${fmtMonthYear(month)}`,
    `Выгружено ${fmtDate(today)}. Неисполненные задачи, срок которых приходится на событие исполнителя.`,
    'F',
    merges,
  );
  rows.push(headerRow(['Задача', 'Исполнитель', 'Срок задачи', 'Вид события', 'Период события', 'Состояние']));

  const sorted = [...clashes].sort((a, b) => a.task.end.localeCompare(b.task.end) || a.employeeId - b.employeeId);
  for (const clash of sorted) {
    const type = types.find((t) => t.key === clash.absence.type);
    const overdue = clash.severity === 'overdue';
    rows.push({
      cells: [
        { value: clash.task.title, style: { border: true, wrap: true } },
        { value: shortName(clash.employeeId), style: { border: true } },
        { value: fmtDate(new Date(clash.task.end)), style: { border: true, center: true, color: overdue ? DANGER : INK } },
        { value: type?.full ?? clash.absence.type, style: { border: true, fill: lighten(typeColor(dictionaries, clash.absence.type), approved(clash.absence) ? 0.55 : 0.25) } },
        { value: fmtSpan(clash.absence), style: { border: true } },
        { value: SEVERITY[clash.severity], style: { border: true, bold: overdue, color: overdue ? DANGER : INK } },
      ],
    });
  }
  if (!sorted.length) rows.push({ cells: [{ value: 'Пересечений нет.', style: { color: MUTED } }] });

  // Период больничного без даты окончания — самая длинная подпись, под неё и ширина.
  return { name: 'Пересечения', columns: [46, 24, 14, 24, 30, 16], rows, merges, freeze: { rows: 4, columns: 1 } };
};

/** Лист «Остатки»: остаток отпуска и отгулов. Пропускается, когда остатки недоступны. */
const balancesSheet = (input: TetrisExportInput): Sheet | null => {
  const { month, people, balance, today } = input;
  const withBalance = people
    .map((person) => ({ person, bal: balance(person.id) }))
    .filter((x): x is { person: Employee; bal: { vacation: number; dayoff: number } } => !!x.bal);
  if (!withBalance.length) return null;

  const merges: string[] = [];
  const rows = titleRows(`Остатки на ${month.getFullYear()} год`, `Выгружено ${fmtDate(today)}. Остаток отпуска 5 дней и меньше выделен.`, 'D', merges);
  rows.push(headerRow(['Сотрудник', 'Должность', 'Остаток отпуска, дней', 'Остаток отгулов, дней']));
  for (const { person, bal } of withBalance) {
    const low = bal.vacation <= 5;
    rows.push({
      cells: [
        { value: shortName(person.id), style: { border: true } },
        { value: person.position, style: { border: true, color: MUTED } },
        { value: bal.vacation, style: { border: true, center: true, bold: low, color: low ? DANGER : INK } },
        { value: bal.dayoff, style: { border: true, center: true } },
      ],
    });
  }
  return { name: 'Остатки', columns: [26, 38, 20, 20], rows, merges, freeze: { rows: 4, columns: 1 } };
};

/** Листы книги: график, события, пересечения и — если остатки видны — остатки. */
export const tetrisSheets = (input: TetrisExportInput): Sheet[] =>
  [chartSheet(input), eventsSheet(input), clashesSheet(input), balancesSheet(input)].filter((sheet): sheet is Sheet => !!sheet);

/** Готовый файл книги. */
export const tetrisXlsx = (input: TetrisExportInput): Blob => buildXlsx(tetrisSheets(input));

/** Сотрудники для выгрузки: те же, что показаны на графике. */
export const exportPeople = (ids: number[]): Employee[] => employees.filter((e) => ids.includes(e.id));
