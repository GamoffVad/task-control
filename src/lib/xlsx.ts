// Минимальный сборщик книги Excel (.xlsx) без внешних библиотек: несколько листов, заливки, границы и ширины колонок.
// Файл .xlsx — это ZIP с XML внутри; здесь складываем записи без сжатия (метод «store»).

export type CellStyle = {
  /** Цвет заливки #RRGGBB. */
  fill?: string;
  /** Цвет текста #RRGGBB. */
  color?: string;
  bold?: boolean;
  /** Выравнивание по центру. */
  center?: boolean;
  /** Повернуть текст на 90°: для узких колонок дней. */
  vertical?: boolean;
  border?: boolean;
  /** Перенос по словам. */
  wrap?: boolean;
};

export type Cell = { value: string | number; style?: CellStyle };
export type Sheet = {
  name: string;
  /** Ширина колонок в символах. */
  columns: number[];
  rows: { height?: number; cells: (Cell | null)[] }[];
  /** Объединённые ячейки, например «A1:F1». */
  merges?: string[];
  /** Сколько строк и колонок закрепить. */
  freeze?: { rows: number; columns: number };
};

const xml = (s: string | number) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Номер колонки → буквы: 1 → A, 27 → AA. */
export const columnName = (index: number): string => {
  let n = index;
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6)}`;

const styleKey = (s: CellStyle) => JSON.stringify([s.fill ?? '', s.color ?? '', !!s.bold, !!s.center, !!s.vertical, !!s.border, !!s.wrap]);

/** Таблицы стилей книги: шрифты, заливки, границы и их сочетания. */
const buildStyles = (styles: CellStyle[]) => {
  const fonts = ['<font><sz val="10"/><name val="Calibri"/></font>'];
  const fontIndex = new Map<string, number>([['', 0]]);
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fillIndex = new Map<string, number>([['', 0]]);
  const cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];

  for (const s of styles) {
    const fontKey = `${s.bold ? 'b' : ''}|${s.color ?? ''}`;
    if (!fontIndex.has(fontKey)) {
      fontIndex.set(fontKey, fonts.length);
      fonts.push(`<font><sz val="10"/><name val="Calibri"/>${s.bold ? '<b/>' : ''}${s.color ? `<color rgb="${argb(s.color)}"/>` : ''}</font>`);
    }
    if (s.fill && !fillIndex.has(s.fill)) {
      fillIndex.set(s.fill, fills.length);
      fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
    const alignment = s.center || s.vertical || s.wrap
      ? `<alignment${s.center ? ' horizontal="center" vertical="center"' : ' vertical="center"'}${s.vertical ? ' textRotation="90"' : ''}${s.wrap ? ' wrapText="1"' : ''}/>`
      : '';
    cellXfs.push(
      `<xf numFmtId="0" fontId="${fontIndex.get(fontKey)}" fillId="${s.fill ? fillIndex.get(s.fill) : 0}" borderId="${s.border ? 1 : 0}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${alignment ? ' applyAlignment="1"' : ''}>${alignment}</xf>`,
    );
  }
  const border = '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>
</styleSheet>`;
};

const sheetXml = (sheet: Sheet, styleOf: (style: CellStyle | undefined) => number) => {
  const cols = sheet.columns.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.cells
        .map((cell, c) => {
          if (!cell) return '';
          const ref = `${columnName(c + 1)}${r + 1}`;
          const style = styleOf(cell.style);
          // Пустая ячейка нужна ради заливки и рамки: день без отметки всё равно окрашен видом события.
          if (cell.value === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
          return typeof cell.value === 'number'
            ? `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`
            : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}"${row.height ? ` ht="${row.height}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const freeze = sheet.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${sheet.freeze.columns}" ySplit="${sheet.freeze.rows}" topLeftCell="${columnName(sheet.freeze.columns + 1)}${sheet.freeze.rows + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : '';
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${rows}</sheetData>${merges}</worksheet>`;
};

// ——— ZIP без сжатия ———

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const zip = (files: { name: string; text: string }[]): Blob => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const num = (value: number, bytes: number) => {
    const out = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) out[i] = (value >>> (i * 8)) & 0xff;
    return out;
  };
  const join = (chunks: Uint8Array[]) => {
    const size = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const sum = crc32(data);
    const local = join([num(0x04034b50, 4), num(20, 2), num(0, 2), num(0, 2), num(0, 2), num(0, 2), num(sum, 4), num(data.length, 4), num(data.length, 4), num(name.length, 2), num(0, 2), name, data]);
    parts.push(local);
    central.push(join([num(0x02014b50, 4), num(20, 2), num(20, 2), num(0, 2), num(0, 2), num(0, 2), num(0, 2), num(sum, 4), num(data.length, 4), num(data.length, 4), num(name.length, 2), num(0, 2), num(0, 2), num(0, 2), num(0, 2), num(0, 4), num(offset, 4), name]));
    offset += local.length;
  }
  const dir = join(central);
  const end = join([num(0x06054b50, 4), num(0, 2), num(0, 2), num(files.length, 2), num(files.length, 2), num(dir.length, 4), num(offset, 4), num(0, 2)]);
  return new Blob([join(parts), dir, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

/** Имя листа: Excel не допускает : \ / ? * [ ] и длину больше 31 символа. */
const sheetName = (name: string, fallback: string) => (name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || fallback);

/** Книга Excel с одним или несколькими листами. Таблица стилей — общая для всей книги. */
export const buildXlsx = (input: Sheet | Sheet[]): Blob => {
  const sheets = Array.isArray(input) ? input : [input];
  if (!sheets.length) throw new Error('В книге должен быть хотя бы один лист.');
  const styles: CellStyle[] = [];
  const index = new Map<string, number>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        if (!cell?.style) continue;
        const key = styleKey(cell.style);
        if (index.has(key)) continue;
        styles.push(cell.style);
        index.set(key, styles.length); // 0 — стиль по умолчанию
      }
    }
  }
  const styleOf = (style: CellStyle | undefined) => (style ? (index.get(styleKey(style)) ?? 0) : 0);
  const names = sheets.map((sheet, i) => sheetName(sheet.name, `Лист${i + 1}`));
  return zip([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', text: buildStyles(styles) },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sheet, styleOf) })),
  ]);
};
