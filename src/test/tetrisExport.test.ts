import { describe, expect, it } from 'vitest';
import { employees } from '../lib/data';
import { buildXlsx } from '../lib/xlsx';
import { tetrisSheet, tetrisXlsx, typeColor } from '../lib/tetrisExport';
import type { Absence, DictionaryEntry, Employee } from '../lib/types';

// Понедельник, 14 сентября 2026: рабочий день, чтобы заливка не путалась с цветом выходного.
const TODAY = new Date(2026, 8, 14, 12, 0);
const MONTH = new Date(2026, 8, 1);
const DAYS = [1, 2, 3].map((d) => new Date(2026, 8, 13 + d));

const DICTIONARY: DictionaryEntry[] = [
  { id: 'd1', dictionary: 'absenceType', code: 'vacation', title: 'Отпуск', color: '#9A6B12' },
];

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

const sheet = (absences: Absence[]) =>
  tetrisSheet({
    month: MONTH,
    days: DAYS,
    people: [person()],
    absences,
    tasks: [],
    dictionaries: DICTIONARY,
    types: [{ key: 'vacation', label: 'Отпуск', full: 'Ежегодный отпуск' }],
    balance: () => ({ vacation: 10, dayoff: 2 }),
    clashTaskIds: new Set(),
    today: TODAY,
  });

/** Строка сотрудника: первые две ячейки — фамилия и остаток, дальше дни. */
const dayCell = (absences: Absence[], index: number) => sheet(absences).rows[4].cells[index + 2];

describe('выгрузка «Тетриса» в Excel', () => {
  it('цвет вида берётся из словаря, а не из запасного списка', () => {
    expect(typeColor(DICTIONARY, 'vacation')).toBe('#9A6B12');
    expect(typeColor([], 'vacation')).toBe('#9A6B12');
    expect(typeColor([{ ...DICTIONARY[0], color: '#123456' }], 'vacation')).toBe('#123456');
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

  it('окрашенная ячейка попадает в файл, даже когда в ней нет отметки задачи', async () => {
    const text = await tetrisXlsx({
      month: MONTH,
      days: DAYS,
      people: [person()],
      absences: [absence()],
      tasks: [],
      dictionaries: DICTIONARY,
      types: [{ key: 'vacation', label: 'Отпуск', full: 'Ежегодный отпуск' }],
      balance: () => null,
      clashTaskIds: new Set(),
      today: TODAY,
    }).text();
    // Книга складывается без сжатия, поэтому XML читается прямо из файла.
    expect(text).toContain('<fgColor rgb="FFC7AE7D"/>');
    expect(text).toMatch(/<c r="C5" s="\d+"\/>/);
  });

  it('пустая ячейка без оформления в файл не пишется', async () => {
    const text = await buildXlsx({ name: 'Лист', columns: [10], rows: [{ cells: [{ value: '' }] }] }).text();
    expect(text).toContain('<row r="1"></row>');
  });
});
