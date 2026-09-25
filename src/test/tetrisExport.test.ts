// Выгрузка «Тетриса» в Excel: корректный архив .xlsx, матрица месяца и цвета видов событий.
// XLSX_OUT=путь — сохранить книгу на демонстрационных данных для проверки в Excel.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groupMembers, syncStaff } from '../lib/data';
import { createSeed } from '../lib/seed';
import { absenceColor, tetrisFileName, tetrisWorkbook } from '../lib/tetrisExport';
import type { Absence, AbsenceType } from '../lib/types';
import { cellRef, colName, crc32, tint, xlsxWorkbook } from '../lib/xlsx';

const NOW = new Date(2026, 8, 17, 12, 0);

/** Разбор архива без сжатия: имя → текст; проверяет подписи и контрольные суммы. */
const unzip = (bytes: Uint8Array): Map<string, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  const dec = new TextDecoder();
  let p = 0;
  while (view.getUint32(p, true) === 0x04034b50) {
    expect(view.getUint16(p + 8, true)).toBe(0); // без сжатия
    const crc = view.getUint32(p + 14, true);
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const data = bytes.subarray(p + 30 + nameLen, p + 30 + nameLen + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, dec.decode(data));
    p += 30 + nameLen + size;
  }
  expect(view.getUint32(p, true)).toBe(0x02014b50); // центральный каталог
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(files.size);
  // Размер и начало центрального каталога — по ним архив читают Excel и zip-программы.
  expect(view.getUint32(end + 16, true)).toBe(p);
  expect(view.getUint32(end + 12, true)).toBe(end - p);
  return files;
};

const seed = () => {
  const s = createSeed(NOW);
  syncStaff(s.users, s.units);
  return s;
};

describe('xlsx', () => {
  it('имена столбцов и ячеек, смешение цвета с белым', () => {
    expect([colName(0), colName(25), colName(26), colName(27), colName(701), colName(702)]).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(cellRef(4, 2)).toBe('C5');
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(tint('#9A6B12', 1)).toBe('#9A6B12');
  });

  it('crc32 совпадает с эталоном', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('книга: все части на месте, текст экранирован, стили не дублируются', () => {
    const style = { fill: { color: '#2F5480' }, font: { bold: true } };
    const files = unzip(
      xlsxWorkbook([{ name: 'Лист: [1]', rows: [[{ v: 'A & <B> "ё"\u0001', s: style }, { v: 42, s: style }]], merges: [[0, 0, 0, 1]], freeze: { rows: 1, cols: 1 } }]),
    );
    expect([...files.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'docProps/core.xml']));
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('A &amp; &lt;B&gt; &quot;ё&quot;</t>');
    expect(sheet).toContain('<v>42</v>');
    expect(sheet).toContain('<mergeCell ref="A1:B1"/>');
    expect(sheet).toContain('state="frozen"');
    expect(files.get('xl/workbook.xml')).toContain('name="Лист 1"');
    expect(files.get('xl/styles.xml')).toContain('<cellXfs count="2">');
    expect(files.get('xl/styles.xml')).toContain('<fgColor rgb="FF2F5480"/>');
  });
});

describe('выгрузка «Тетриса»', () => {
  it('матрица месяца: дни, сотрудники, события цветом вида, заявки штриховкой, три листа', () => {
    const s = seed();
    const people = groupMembers('all');
    const dictionaries = s.dictionaries.map((e) => (e.dictionary === 'absenceType' && e.code === 'trip' ? { ...e, color: '#123456' } : e));
    const extra: Absence[] = [
      { id: 'x-req', employeeId: people[0].id, type: 'trip', from: '2026-09-21', to: '2026-09-23', status: 'request', note: '', decidedBy: null, createdAt: NOW.toISOString() },
      { id: 'x-rej', employeeId: people[1].id, type: 'study', from: '2026-09-10', to: '2026-09-11', status: 'rejected', note: 'отклонено', decidedBy: 1, createdAt: NOW.toISOString() },
    ];
    const bytes = tetrisWorkbook({ month: new Date(2026, 8, 1), people, absences: [...s.absences, ...extra], hidden: new Set(), tasks: s.tasks, dictionaries, groupLabel: 'весь отдел', now: NOW });
    const files = unzip(bytes);
    const workbook = files.get('xl/workbook.xml')!;
    expect(workbook).toContain('name="Тетрис"');
    expect(workbook).toContain('name="События"');
    expect(workbook).toContain('name="Сроки задач"');
    const matrix = files.get('xl/worksheets/sheet1.xml')!;
    expect(matrix).toContain('Тетрис — график событий отдела: Сентябрь 2026');
    // 2 столбца слева, 30 дней, «Дней событий».
    expect(matrix).toContain('<c r="AF4"');
    expect(matrix).toContain('Дней событий');
    expect(matrix).toContain('Отсутствуют, %');
    expect(matrix).toContain('Командировка · заявка');
    const styles = files.get('xl/styles.xml')!;
    // Цвет вида — из справочника: заявка — штриховка цветом вида, согласовано — заливка его оттенком.
    expect(styles).toContain(`patternType="lightUp"><fgColor rgb="FF${tint('#123456', 0.55).slice(1)}"/>`);
    expect(styles).toContain(`<fgColor rgb="FF${tint('#9A6B12', 0.3).slice(1)}"/>`);
    // Отклонённые заявки не выгружаются.
    expect(files.get('xl/worksheets/sheet2.xml')).not.toContain('отклонено');
    // Все объединения внутри границ и не пересекаются.
    const merges = [...matrix.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)].map((m) => m.slice(1));
    const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const taken = new Set<string>();
    for (const [c1, r1, c2, r2] of merges) {
      for (let r = +r1; r <= +r2; r++)
        for (let c = col(c1); c <= col(c2); c++) {
          expect(taken.has(`${r}:${c}`)).toBe(false);
          taken.add(`${r}:${c}`);
        }
    }
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, bytes);
  });

  it('скрытые виды не попадают в матрицу и список событий', () => {
    const s = seed();
    const hidden = new Set<AbsenceType>(['vacation', 'trip', 'dayoff', 'sick', 'study'].filter((t) => t !== 'sick') as AbsenceType[]);
    const files = unzip(tetrisWorkbook({ month: new Date(2026, 8, 1), people: groupMembers('all'), absences: s.absences, hidden, tasks: s.tasks, dictionaries: s.dictionaries, groupLabel: 'весь отдел', now: NOW }));
    const events = files.get('xl/worksheets/sheet2.xml')!;
    expect(events).not.toContain('Ежегодный отпуск</t>');
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('Виды событий: больничный.');
  });

  it('цвет вида: справочник, иначе цвет темы; имя файла по месяцу', () => {
    expect(absenceColor('vacation', [])).toBe('#9A6B12');
    expect(absenceColor('vacation', [{ id: 'v', dictionary: 'absenceType', code: 'vacation', title: 'Отпуск', color: '#2c6b45' }])).toBe('#2C6B45');
    expect(tetrisFileName(new Date(2026, 8, 1))).toBe('tetris-2026-09.xlsx');
  });
});
