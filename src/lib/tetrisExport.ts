// Выгрузка «Тетриса» в Excel: матрица месяца, как на экране, и два листа-перечня.
//   «Тетрис»       — сотрудники × дни: события (отпуска, командировки, отгулы, больничные, учёба) — ячейки,
//                    закрашенные цветом вида (согласовано — заливка, заявка — штриховка), сроки задач — маркеры,
//                    итоговая строка «Отсутствуют, %», легенда;
//   «События»      — события месяца списком: вид, статус, даты, дни, комментарий;
//   «Сроки задач»  — задачи со сроком в этом месяце и их состояние.
// Отбор тот же, что на экране: группа, видимые виды событий; отклонённые заявки не выгружаются.
import { absenceDays, absenceEnd, covers, findClashes, fmtShare, fmtSpan, isActive, VACATION_LIMIT } from './absences';
import { ABSENCE_TYPES, absenceType, shortName } from './data';
import { fmtDate, fmtDateTime, fmtMonthYear, fmtWeekday, isSameDay, startOfDay, toDateKey } from './dates';
import type { Absence, AbsenceType, DictionaryEntry, Employee, Task } from './types';
import { tint, xlsxWorkbook, type Cell, type CellStyle, type Rgb, type Sheet } from './xlsx';

/** Цвета светлой темы (index.css): документ печатается на белом. */
const DEFAULT_ABSENCE_COLORS: Record<string, Rgb> = { vacation: '#9A6B12', trip: '#2F5480', dayoff: '#6A4C93', sick: '#983A6E', study: '#1E7268' };
const INK = '#1F2B3A';
const INK_3 = '#5D6575';
const ACCENT = '#1F3A5F';
const OK = '#2C6B45';
const DANGER = '#A32D22';
const DANGER_BG = '#F3DEDB';
const AMBER = '#7A5312';
const WEEKEND = '#F1EFEA';
const GRID = '#DDD8CE';
/** Доля цвета вида в заливке согласованного события — чуть плотнее экранной, чтобы читалось на печати. */
const APPROVED_TINT = 0.3;

export type TetrisExport = {
  month: Date;
  people: Employee[];
  /** Все события: матрица показывает видимые виды, итоговая строка — все согласованные, как на экране. */
  absences: Absence[];
  hidden: Set<AbsenceType>;
  tasks: Task[];
  dictionaries: DictionaryEntry[];
  groupLabel: string;
  /** Остатки отпуска и отгулов — только тем, кому их показывает экран. */
  balances?: Map<number, { vacation: number; dayoff: number }>;
  now?: Date;
};

/** Цвет вида события: из справочника (Администрирование → Словари), иначе цвет темы. */
export const absenceColor = (type: AbsenceType, dictionaries: DictionaryEntry[]): Rgb =>
  dictionaries.find((e) => e.dictionary === 'absenceType' && e.code === type && e.color)?.color?.toUpperCase() ?? DEFAULT_ABSENCE_COLORS[type] ?? INK_3;

const thin = (color: Rgb = GRID) => ({ style: 'thin' as const, color });
const grid = { left: thin(), right: thin(), top: thin(), bottom: thin() };
const head: CellStyle = { font: { bold: true, color: INK }, fill: { color: '#E9E6DF' }, border: grid, align: { h: 'center', v: 'center', wrap: true } };

/** Стиль ячейки события: согласовано — заливка цветом вида, заявка — штриховка; края периода — рамкой цвета вида. */
const eventStyle = (color: Rgb, a: Absence, first: boolean, last: boolean, openEnd: boolean): CellStyle => {
  const request = a.status === 'request';
  const edge = { style: request ? ('dashed' as const) : ('thin' as const), color };
  return {
    fill: request ? { color: tint(color, 0.55), pattern: 'lightUp', bg: '#FFFFFF' } : { color: tint(color, APPROVED_TINT) },
    font: { size: 8, color: INK, bold: first },
    border: {
      left: first ? { style: request ? 'dashed' : 'thick', color } : undefined,
      right: last ? (openEnd ? { style: 'dotted', color } : edge) : undefined,
      top: edge,
      bottom: edge,
    },
    align: { h: 'left', v: 'center', wrap: true },
  };
};

export const tetrisWorkbook = ({ month, people, absences, hidden, tasks, dictionaries, groupLabel, balances, now = new Date() }: TetrisExport): Uint8Array<ArrayBuffer> => {
  const today = startOfDay(now);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1));
  const monthStart = days[0];
  const monthEnd = days[count - 1];
  const ids = new Set(people.map((e) => e.id));
  const shown = absences.filter((a) => isActive(a) && !hidden.has(a.type) && ids.has(a.employeeId));
  const inMonth = (a: Absence) => new Date(`${a.from}T00:00`) <= monthEnd && absenceEnd(a, today) >= monthStart;
  const clashes = findClashes(tasks, absences, today);
  const color = (type: AbsenceType) => absenceColor(type, dictionaries);
  const visibleTypes = ABSENCE_TYPES.filter((t) => !hidden.has(t.key));
  const monthTasks = tasks.filter((t) => {
    const end = new Date(t.end);
    return end >= monthStart && end < new Date(month.getFullYear(), month.getMonth() + 1, 1);
  });

  // Порог отпусков по дням — как подсветка дней в шапке графика.
  const vacationShare = (d: Date, withRequests: boolean) => {
    if (!people.length) return 0;
    const on = new Set(absences.filter((a) => a.type === 'vacation' && (a.status === 'approved' || (withRequests && a.status === 'request')) && ids.has(a.employeeId) && covers(a, d, today)).map((a) => a.employeeId));
    return on.size / people.length;
  };

  // ——— Лист «Тетрис» ———
  const lead = balances ? ['Сотрудник', 'Должность', 'Отпуск, ост.', 'Отгулы, ост.'] : ['Сотрудник', 'Должность'];
  const first = lead.length; // первый столбец дней
  const total = first + count; // столбец «Дней событий»
  const rows: Cell[][] = [];
  const merges: [number, number, number, number][] = [];
  const heights: Record<number, number> = {};
  const types = hidden.size === 0 ? 'все' : visibleTypes.map((t) => t.label.toLowerCase()).join(', ') || 'не выбраны';

  rows.push([{ v: `Тетрис — график событий отдела: ${fmtMonthYear(month)}`, s: { font: { bold: true, size: 14, color: INK } } }]);
  rows.push([{ v: `Группа: ${groupLabel}. Виды событий: ${types}. Выгружено ${fmtDateTime(now)}.`, s: { font: { italic: true, color: INK_3 } } }]);
  merges.push([0, 0, 0, total], [1, 0, 1, total]);
  heights[0] = 22;
  rows.push([]);

  const h1: Cell[] = lead.map((v) => ({ v, s: head }));
  const h2: Cell[] = lead.map(() => ({ s: head }));
  lead.forEach((_, c) => merges.push([3, c, 4, c]));
  days.forEach((d) => {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const over = vacationShare(d, false) > VACATION_LIMIT;
    const overReq = !over && vacationShare(d, true) > VACATION_LIMIT;
    const style: CellStyle = {
      ...head,
      fill: { color: over ? DANGER_BG : overReq ? tint(AMBER, 0.15) : weekend ? '#DEDAD2' : '#E9E6DF' },
      font: { bold: true, color: isSameDay(d, today) ? DANGER : weekend ? INK_3 : INK },
      border: over || overReq ? { ...grid, top: { style: 'thick', color: over ? DANGER : AMBER } } : grid,
    };
    h1.push({ v: d.getDate(), s: style });
    h2.push({ v: fmtWeekday(d), s: { ...style, font: { size: 8, color: style.font!.color } } });
  });
  h1.push({ v: 'Дней событий', s: head });
  h2.push({ s: head });
  merges.push([3, total, 4, total]);
  rows.push(h1, h2);
  heights[3] = 18;

  const marker = (list: Task[], employeeId: number): Cell => {
    if (!list.length) return {};
    const bad = list.some((t) => clashes.some((c) => c.task.id === t.id && c.employeeId === employeeId));
    const open = list.some((t) => !t.done);
    return {
      v: list.length > 1 ? `●${list.length}` : '●',
      s: { font: { bold: true, size: bad ? 11 : 9, color: bad ? DANGER : open ? ACCENT : OK }, align: { h: 'center', v: 'center' } },
    };
  };

  for (const e of people) {
    const top = rows.length;
    const events: Cell[] = [];
    const deadlines: Cell[] = [];
    const bal = balances?.get(e.id);
    const leadCells: Cell[] = [
      { v: shortName(e.id), s: { font: { bold: true, color: INK }, border: grid, align: { v: 'center' } } },
      { v: e.position, s: { font: { size: 9, color: INK_3 }, border: grid, align: { v: 'center', wrap: true } } },
      ...(balances ? [{ v: bal?.vacation ?? '', s: { border: grid, align: { h: 'center' as const, v: 'center' as const }, font: { color: (bal?.vacation ?? 99) <= 5 ? DANGER : INK } } }, { v: bal?.dayoff ?? '', s: { border: grid, align: { h: 'center' as const, v: 'center' as const } } }] : []),
    ];
    events.push(...leadCells);
    deadlines.push(...leadCells.map((c) => ({ s: c.s })));
    leadCells.forEach((_, c) => merges.push([top, c, top + 1, c]));

    // Каждый день — первое видимое событие сотрудника; подряд идущие дни одного события объединяются в «полосу».
    const mine = shown.filter((a) => a.employeeId === e.id).sort((a, b) => a.from.localeCompare(b.from));
    const byDay = days.map((d) => mine.find((a) => covers(a, d, today)) ?? null);
    let busy = 0;
    for (let i = 0; i < count; ) {
      const a = byDay[i];
      const d = days[i];
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      if (!a) {
        events.push({ s: { fill: weekend ? { color: WEEKEND } : undefined, border: grid } });
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < count && byDay[j + 1] === a) j++;
      const span = j - i + 1;
      busy += span;
      const t = absenceType(a.type);
      // Событие, начатое в прошлом месяце или продолжающееся в следующем, не получает рамку на этом краю.
      const startsHere = new Date(`${a.from}T00:00`) >= monthStart;
      const endsHere = a.to === null || startOfDay(absenceEnd(a, today)).getTime() === days[j].getTime();
      const label = span >= 3 ? `${t.label}${a.status === 'request' ? ' · заявка' : ''}\n${fmtSpan(a)} · ${absenceDays(a, today)} дн.` : `${t.label.slice(0, 3)}.${a.status === 'request' ? ' з.' : ''}\n${absenceDays(a, today)} дн.`;
      for (let k = i; k <= j; k++) {
        const style = eventStyle(color(a.type), a, k === i && startsHere, k === j && endsHere, a.to === null);
        events.push(k === i ? { v: label, s: style } : { s: style });
      }
      if (span > 1) merges.push([top, first + i, top, first + j]);
      i = j + 1;
    }
    events.push({ v: busy || '', s: { border: grid, align: { h: 'center', v: 'center' }, font: { bold: true, color: INK } } });

    days.forEach((d) => {
      const list = monthTasks.filter((t) => t.assigneeIds.includes(e.id) && isSameDay(new Date(t.end), d));
      const m = marker(list, e.id);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      deadlines.push({ v: m.v, s: { ...m.s, fill: weekend ? { color: WEEKEND } : undefined, border: { ...grid, top: undefined } } });
    });
    deadlines.push({ s: { border: grid } });
    merges.push([top, total, top + 1, total]);
    rows.push(events, deadlines);
    heights[top] = 30;
    heights[top + 1] = 13;
  }

  // Итоговая строка: доля отсутствующих (согласованные события любого вида), как под графиком.
  const foot: Cell[] = [{ v: 'Отсутствуют, %', s: { font: { bold: true, color: INK }, fill: { color: '#E9E6DF' }, border: { ...grid, top: thin(ACCENT) }, align: { v: 'center' } } }];
  for (let c = 1; c < first; c++) foot.push({ s: { fill: { color: '#E9E6DF' }, border: { ...grid, top: thin(ACCENT) } } });
  merges.push([rows.length, 0, rows.length, first - 1]);
  days.forEach((d) => {
    const absent = people.filter((e) => absences.some((a) => a.employeeId === e.id && a.status === 'approved' && covers(a, d, today))).length;
    const share = people.length ? absent / people.length : 0;
    const hi = share > VACATION_LIMIT;
    foot.push({
      v: absent ? fmtShare(share) : '—',
      s: { font: { size: 8, bold: absent > 0, color: hi ? DANGER : absent ? INK : INK_3 }, fill: { color: hi ? DANGER_BG : d.getDay() === 0 || d.getDay() === 6 ? WEEKEND : '#FFFFFF' }, border: { ...grid, top: thin(ACCENT) }, align: { h: 'center', v: 'center' } },
    });
  });
  foot.push({ s: { border: { ...grid, top: thin(ACCENT) } } });
  rows.push(foot);
  heights[rows.length - 1] = 18;

  // Легенда: цвет каждого вида — согласовано и заявка; маркеры сроков.
  rows.push([]);
  rows.push([{ v: 'Условные обозначения', s: { font: { bold: true, color: INK } } }]);
  for (const t of visibleTypes) {
    const c = color(t.key);
    const r = rows.length;
    const sample = (status: Absence['status']) => eventStyle(c, { status } as Absence, true, true, false);
    const row: Cell[] = [{ v: t.full, s: { font: { color: INK } } }, { v: 'согласовано', s: sample('approved') }];
    for (let k = 2; k < first; k++) row.push({});
    row.push({ v: 'заявка', s: sample('request') });
    for (let k = 1; k < 4; k++) row.push({ s: sample('request') });
    merges.push([r, first, r, first + 3]);
    rows.push(row);
    heights[r] = 16;
  }
  const dot = (text: string, c: Rgb): Cell[] => [{ v: '●', s: { font: { bold: true, color: c }, align: { h: 'right' } } }, { v: text, s: { font: { color: INK } } }];
  rows.push(dot('срок задачи назначен', ACCENT), dot('срок задачи — задача исполнена', OK), dot('срок приходится на событие исполнителя', DANGER));
  rows.push([{ v: 'Заголовок дня красным — в отпуске больше 30% сотрудников; жёлтым — станет больше, если согласовать заявки.', s: { font: { italic: true, size: 9, color: INK_3 } } }]);

  const tetris: Sheet = {
    name: 'Тетрис',
    rows,
    cols: [...(balances ? [20, 22, 7, 7] : [20, 22]), ...days.map(() => 4.6), 9.5],
    heights,
    merges,
    freeze: { rows: 5, cols: first },
    landscape: true,
  };

  // ——— Лист «События» ———
  const order = new Map(people.map((e, i) => [e.id, i]));
  const list = shown.filter(inMonth).sort((a, b) => order.get(a.employeeId)! - order.get(b.employeeId)! || a.from.localeCompare(b.from));
  const eventRows: Cell[][] = [
    [{ v: `События: ${fmtMonthYear(month)}`, s: { font: { bold: true, size: 13, color: INK } } }],
    [{ v: `Группа: ${groupLabel}. Виды: ${types}. Всего: ${list.length}.`, s: { font: { italic: true, color: INK_3 } } }],
    [],
    ['Сотрудник', 'Вид', 'Статус', 'С', 'По', 'Дней', 'Комментарий', 'Сроки задач в период'].map((v) => ({ v, s: head })),
  ];
  for (const a of list) {
    const c = color(a.type);
    const hits = clashes.filter((x) => x.absence.id === a.id).length;
    const cell = (v: string | number, s: CellStyle = {}): Cell => ({ v, s: { border: grid, ...s, align: { v: 'center', wrap: true, ...s.align } } });
    eventRows.push([
      cell(shortName(a.employeeId), { font: { bold: true, color: INK } }),
      { v: absenceType(a.type).full, s: { ...eventStyle(c, a, true, true, a.to === null), font: { color: INK, size: 10 }, align: { v: 'center' } } },
      cell(a.status === 'request' ? 'заявка' : 'согласовано', { font: { bold: a.status === 'request', color: a.status === 'request' ? AMBER : OK } }),
      cell(fmtDate(new Date(`${a.from}T00:00`)), { align: { h: 'center' } }),
      cell(a.to ? fmtDate(new Date(`${a.to}T00:00`)) : 'не известно', { align: { h: 'center' }, font: a.to ? undefined : { italic: true, color: INK_3 } }),
      cell(absenceDays(a, today), { align: { h: 'center' } }),
      cell(a.note),
      cell(hits ? `${hits} — исполнитель отсутствует` : '', { font: { color: DANGER } }),
    ]);
  }
  if (!list.length) eventRows.push([{ v: 'В этом месяце событий нет.', s: { font: { italic: true, color: INK_3 } } }]);

  // ——— Лист «Сроки задач» ———
  const deadlines = monthTasks
    .filter((t) => t.assigneeIds.some((id) => ids.has(id)))
    .sort((a, b) => a.end.localeCompare(b.end));
  const taskRows: Cell[][] = [
    [{ v: `Сроки задач: ${fmtMonthYear(month)}`, s: { font: { bold: true, size: 13, color: INK } } }],
    [{ v: `Группа: ${groupLabel}. Всего: ${deadlines.length}.`, s: { font: { italic: true, color: INK_3 } } }],
    [],
    ['Срок', 'Задача', 'Исполнители', 'Состояние'].map((v) => ({ v, s: head })),
  ];
  for (const t of deadlines) {
    const hit = clashes.filter((c) => c.task.id === t.id && ids.has(c.employeeId));
    const late = !t.done && new Date(t.end) < now;
    const [state, c] = t.done
      ? [`исполнено${t.doneAt ? ` ${fmtDate(new Date(t.doneAt))}` : ''}`, OK]
      : hit.length
        ? [`исполнитель отсутствует: ${hit.map((x) => `${shortName(x.employeeId)} (${absenceType(x.absence.type).label.toLowerCase()}${x.absence.status === 'request' ? ', заявка' : ''})`).join(', ')}`, DANGER]
        : late
          ? ['просрочено', DANGER]
          : ['в работе', ACCENT];
    const border = { border: grid, align: { v: 'center' as const, wrap: true } };
    taskRows.push([
      { v: fmtDateTime(new Date(t.end)), s: { ...border, align: { h: 'center', v: 'center' } } },
      { v: t.title.replace(/\s+/g, ' ').trim(), s: border },
      { v: t.assigneeIds.map(shortName).join(', '), s: border },
      { v: state, s: { ...border, font: { bold: true, color: c }, fill: { color: tint(c, 0.1) } } },
    ]);
  }
  if (!deadlines.length) taskRows.push([{ v: 'Сроков задач в этом месяце нет.', s: { font: { italic: true, color: INK_3 } } }]);

  return xlsxWorkbook(
    [
      tetris,
      { name: 'События', rows: eventRows, cols: [20, 24, 13, 11, 11, 7, 40, 26], merges: [[0, 0, 0, 7], [1, 0, 1, 7]], freeze: { rows: 4, cols: 0 }, landscape: true },
      { name: 'Сроки задач', rows: taskRows, cols: [16, 60, 30, 44], merges: [[0, 0, 0, 3], [1, 0, 1, 3]], freeze: { rows: 4, cols: 0 }, landscape: true },
    ],
    { title: `Тетрис: ${fmtMonthYear(month)}`, now },
  );
};

export const tetrisFileName = (month: Date) => `tetris-${toDateKey(month).slice(0, 7)}.xlsx`;
