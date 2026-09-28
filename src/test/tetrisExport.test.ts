import { describe, expect, it } from 'vitest';
import { employees } from '../lib/data';
import { buildXlsx } from '../lib/xlsx';
import { tetrisSheets, tetrisXlsx, typeColor, type TetrisExportInput } from '../lib/tetrisExport';
import type { Absence, DictionaryEntry, Employee, Task } from '../lib/types';
import type { Clash } from '../lib/absences';

// Понедельник, 14 сентября 2026: рабочий день, чтобы заливка не путалась с цветом выходного.
const TODAY = new Date(2026, 8, 14, 12, 0);
const MONTH = new Date(2026, 8, 1);
const DAYS = [1, 2, 3].map((d) => new Date(2026, 8, 13 + d));

const DICTIONARY: DictionaryEntry[] = [{ id: 'd1', dictionary: 'absenceType', code: 'vacation', title: 'Отпуск', color: '#9A6B12' }];
const TYPES: TetrisExportInput['types'] = [{ key: 'vacation', label: 'Отпуск', full: 'Ежегодный отпуск' }];

const person = (): Employee => employees[0];

const absence = (over: Partial<Absence> = {}): Absence => ({
  id: 'a1',
  employeeId: person().id,
  type: 'vacation',
  from: '2026-09-14',
  to: '2026-09-15',
  status: 'approved',
  note: 'Заявление от 1 сентября',
  decidedBy: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Подготовить справку',
  rowId: null,
  category: null,
  assigneeIds: [person().id],
  start: '2026-09-14T09:00:00.000Z',
  end: '2026-09-15T15:00:00.000Z',
  docName: '',
  docNumber: '',
  result: '',
  done: false,
  score: null,
  doneAt: null,
  ...over,
});

const input = (over: Partial<TetrisExportInput> = {}): TetrisExportInput => ({
  month: MONTH,
  days: DAYS,
  people: [person()],
  absences: [absence()],
  tasks: [],
  dictionaries: DICTIONARY,
  types: TYPES,
  balance: () => ({ vacation: 10, dayoff: 2 }),
  clashes: [],
  today: TODAY,
  ...over,
});

const sheets = (over: Partial<TetrisExportInput> = {}) => tetrisSheets(input(over));
const byName = (name: string, over: Partial<TetrisExportInput> = {}) => sheets(over).find((s) => s.name === name)!;

/** Строка сотрудника на листе «График»: первые две ячейки — фамилия и остаток, дальше дни. */
const dayCell = (absences: Absence[], index: number) => byName('График', { absences }).rows[4].cells[index + 2];

describe('выгрузка «Тетриса» в Excel', () => {
  it('цвет вида берётся из словаря, а не из запасного списка', () => {
    expect(typeColor(DICTIONARY, 'vacation')).toBe('#9A6B12');
    expect(typeColor([], 'vacation')).toBe('#9A6B12');
    expect(typeColor([{ ...DICTIONARY[0], color: '#123456' }], 'vacation')).toBe('#123456');
  });

  it('книга разбита на листы: график, события, пересечения и остатки', () => {
    expect(sheets().map((s) => s.name)).toEqual(['График', 'События', 'Пересечения', 'Остатки']);
    // Остатки видны не всем: без них лист не создаётся.
    expect(sheets({ balance: () => null }).map((s) => s.name)).toEqual(['График', 'События', 'Пересечения']);
  });

  it('у каждого листа своя шапка и закреплённые области', () => {
    for (const sheet of sheets()) {
      // Первая строка — название, четвёртая — шапка таблицы, она и закрепляется.
      expect(String(sheet.rows[0].cells[0]?.value).length).toBeGreaterThan(8);
      expect(sheet.rows[3].cells[0]?.style?.bold).toBe(true);
      expect(sheet.freeze?.rows).toBe(4);
      expect(sheet.columns.length).toBeGreaterThan(3);
    }
  });

  it('день согласованного события окрашен светлым тоном цвета словаря', () => {
    // #9A6B12, осветлённый на 55 %, — тот же тон, что у полосы на графике.
    expect(dayCell([absence()], 0)?.style?.fill).toBe('#c7ae7d');
    expect(dayCell([absence()], 1)?.style?.fill).toBe('#c7ae7d');
  });

  it('заявка светлее согласованного', () => {
    expect(dayCell([absence({ status: 'request' })], 0)?.style?.fill).toBe('#e6dac4');
  });

  it('день без события и без задач остаётся без заливки', () => {
    expect(dayCell([absence()], 2)?.style?.fill).toBeUndefined();
  });

  it('лист «События» перечисляет события месяца, кроме отклонённых', () => {
    const rows = byName('События', { absences: [absence(), absence({ id: 'a2', status: 'rejected' })] }).rows;
    const values = rows.slice(4).map((r) => r.cells.map((c) => c?.value));
    expect(values.length).toBe(1);
    expect(values[0]).toContain('Ежегодный отпуск');
    expect(values[0]).toContain('согласовано');
  });

  it('лист «Пересечения» показывает задачу, срок и состояние', () => {
    const clash: Clash = { task: task(), employeeId: person().id, absence: absence(), severity: 'risk' };
    const rows = byName('Пересечения', { clashes: [clash], tasks: [clash.task] }).rows;
    expect(rows[3].cells.map((c) => c?.value)).toEqual(['Задача', 'Исполнитель', 'Срок задачи', 'Вид события', 'Период события', 'Состояние']);
    expect(rows[4].cells.map((c) => c?.value)).toContain('Подготовить справку');
    expect(rows[4].cells.map((c) => c?.value)).toContain('Под угрозой');
  });

  it('пустые списки не оставляют лист без объяснения', () => {
    expect(byName('Пересечения').rows.at(-1)!.cells[0]?.value).toBe('Пересечений нет.');
    expect(byName('События', { absences: [] }).rows.at(-1)!.cells[0]?.value).toBe('В этом месяце событий нет.');
  });

  it('лист «Остатки» выделяет малый остаток отпуска', () => {
    const rows = byName('Остатки', { balance: () => ({ vacation: 3, dayoff: 1 }) }).rows;
    expect(rows[4].cells[2]).toMatchObject({ value: 3, style: { bold: true } });
  });

  it('в файле есть все листы, а окрашенная ячейка не теряется без отметки задачи', async () => {
    const text = await tetrisXlsx(input({ balance: () => null })).text();
    // Книга складывается без сжатия, поэтому XML читается прямо из файла.
    expect(text).toContain('<fgColor rgb="FFC7AE7D"/>');
    expect(text).toMatch(/<c r="C5" s="\d+"\/>/);
    for (const name of ['График', 'События', 'Пересечения']) expect(text).toContain(`<sheet name="${name}"`);
    expect(text).toContain('/xl/worksheets/sheet3.xml');
  });

  it('недопустимые символы в имени листа заменяются', async () => {
    const text = await buildXlsx([{ name: 'План/2026: [итог]', columns: [10], rows: [{ cells: [{ value: 'x' }] }] }]).text();
    expect(text).toContain('<sheet name="План 2026   итог"');
  });

  it('пустая ячейка без оформления в файл не пишется', async () => {
    const text = await buildXlsx({ name: 'Лист', columns: [10], rows: [{ cells: [{ value: '' }] }] }).text();
    expect(text).toContain('<row r="1"></row>');
  });
});
