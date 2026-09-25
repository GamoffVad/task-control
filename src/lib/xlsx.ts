// Минимальная запись книги Excel (.xlsx) без сторонних библиотек: приложение работает без интернета.
// Книга — zip-архив с XML (Office Open XML). Файлы кладутся в архив без сжатия, Excel это допускает.
// Возможности — ровно те, что нужны выгрузкам: текст и числа, заливки (сплошная и штриховка), шрифт, рамки,
// выравнивание, ширина столбцов, высота строк, объединённые ячейки, закреплённые области, печать на лист.

export type Rgb = string; // «#RRGGBB»

export type BorderSide = { style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'hair'; color: Rgb };

export type CellStyle = {
  /** solid — сплошная заливка; lightUp — косая штриховка цветом fill.color по фону fill.bg (как заявка на графике). */
  fill?: { color: Rgb; pattern?: 'solid' | 'lightUp'; bg?: Rgb };
  font?: { bold?: boolean; italic?: boolean; color?: Rgb; size?: number };
  border?: { left?: BorderSide; right?: BorderSide; top?: BorderSide; bottom?: BorderSide };
  align?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom'; wrap?: boolean };
};

export type Cell = { v?: string | number; s?: CellStyle };

export type Sheet = {
  name: string;
  /** Строки сверху вниз; null и undefined — пустая ячейка. */
  rows: (Cell | null | undefined)[][];
  /** Ширина столбцов в символах. */
  cols?: number[];
  /** Высота строк в пунктах (по номеру строки с нуля). */
  heights?: Record<number, number>;
  /** Объединения: [первая строка, первый столбец, последняя строка, последний столбец], с нуля. */
  merges?: [number, number, number, number][];
  /** Закрепить строки сверху и столбцы слева. */
  freeze?: { rows: number; cols: number };
  landscape?: boolean;
};

const esc = (s: string) =>
  s
    // Управляющие символы недопустимы в XML — Excel не откроет такой файл.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const argb = (rgb: Rgb) => `FF${rgb.replace('#', '').toUpperCase()}`;

/** Буквенное имя столбца: 0 → A, 26 → AA. */
export const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + colName(i % 26));
export const cellRef = (row: number, col: number) => `${colName(col)}${row + 1}`;

/** Смешение цвета с белым: share — доля цвета (как color-mix в CSS). */
export const tint = (rgb: Rgb, share: number): Rgb => {
  const n = parseInt(rgb.replace('#', ''), 16);
  const mix = (c: number) => Math.round(c * share + 255 * (1 - share));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

/** Таблица стилей: одинаковые шрифты, заливки, рамки и сочетания хранятся один раз. */
class Styles {
  fonts = ['<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>'];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private index = new Map<string, number>();

  private add(list: string[], xml: string): number {
    const found = list.indexOf(xml);
    if (found >= 0) return found;
    list.push(xml);
    return list.length - 1;
  }

  id(s?: CellStyle): number {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const cached = this.index.get(key);
    if (cached !== undefined) return cached;
    const f = s.font ?? {};
    const font = this.add(
      this.fonts,
      `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<sz val="${f.size ?? 10}"/>${f.color ? `<color rgb="${argb(f.color)}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`,
    );
    const fill = s.fill
      ? this.add(
          this.fills,
          `<fill><patternFill patternType="${s.fill.pattern ?? 'solid'}"><fgColor rgb="${argb(s.fill.color)}"/><bgColor rgb="${argb(s.fill.bg ?? '#FFFFFF')}"/></patternFill></fill>`,
        )
      : 0;
    const side = (name: string, b?: BorderSide) => (b ? `<${name} style="${b.style}"><color rgb="${argb(b.color)}"/></${name}>` : `<${name}/>`);
    const b = s.border ?? {};
    const border = s.border ? this.add(this.borders, `<border>${side('left', b.left)}${side('right', b.right)}${side('top', b.top)}${side('bottom', b.bottom)}<diagonal/></border>`) : 0;
    const a = s.align;
    const align = a ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}/>` : '';
    const xf = `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ` applyAlignment="1">${align}</xf>` : '/>'}`;
    const id = this.add(this.xfs, xf);
    this.index.set(key, id);
    return id;
  }

  xml(): string {
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${list('fonts', this.fonts)}${list('fills', this.fills)}${list('borders', this.borders)}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>${list('cellXfs', this.xfs)}<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

const sheetXml = (sheet: Sheet, styles: Styles): string => {
  const width = Math.max(1, sheet.cols?.length ?? 0, ...sheet.rows.map((r) => r.length));
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (!cell) return '';
          const ref = cellRef(r, c);
          const s = styles.id(cell.s);
          const attr = s ? ` s="${s}"` : '';
          if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c r="${ref}"${attr}><v>${cell.v}</v></c>`;
          if (typeof cell.v === 'string' && cell.v !== '') return `<c r="${ref}"${attr} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
          return s ? `<c r="${ref}"${attr}/>` : '';
        })
        .join('');
      const ht = sheet.heights?.[r];
      return cells || ht ? `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>` : '';
    })
    .join('');
  const f = sheet.freeze;
  const pane =
    f && (f.rows || f.cols)
      ? `<pane${f.cols ? ` xSplit="${f.cols}"` : ''}${f.rows ? ` ySplit="${f.rows}"` : ''} topLeftCell="${cellRef(f.rows, f.cols)}" activePane="${f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : '';
  const cols = sheet.cols?.length ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(([r1, c1, r2, c2]) => `<mergeCell ref="${cellRef(r1, c1)}:${cellRef(r2, c2)}"/>`).join('')}</mergeCells>`
    : '';
  const last = cellRef(Math.max(0, sheet.rows.length - 1), width - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
};

/** Имя листа Excel: до 31 символа, без []:*?/\ и уникальное в книге. */
const sheetName = (name: string, used: Set<string>) => {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Лист';
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`;
  used.add(n.toLowerCase());
  return n;
};

/** Книга Excel: байты файла .xlsx. */
export const xlsxWorkbook = (sheets: Sheet[], meta: { title?: string; now?: Date } = {}): Uint8Array<ArrayBuffer> => {
  const styles = new Styles();
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const bodies = sheets.map((s) => sheetXml(s, styles));
  const now = (meta.now ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ],
    [
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title ?? '')}</dc:title><dc:creator>Контроль задач</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ...bodies.map((xml, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, xml]),
    ['xl/styles.xml', styles.xml()],
  ];
  const enc = new TextEncoder();
  return zipStore(files.map(([name, text]) => ({ name, data: enc.encode(text) })), meta.now ?? new Date());
};

// ——— Zip без сжатия (метод «stored») ———

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export const zipStore = (files: { name: string; data: Uint8Array }[], date: Date = new Date()): Uint8Array<ArrayBuffer> => {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const entries = files.map((f) => ({ ...f, raw: enc.encode(f.name), crc: crc32(f.data) }));
  const localSize = entries.reduce((s, e) => s + 30 + e.raw.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.raw.length, 0);
  const out = new Uint8Array(new ArrayBuffer(localSize + centralSize + 22));
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v: number) => (view.setUint16(p, v, true), (p += 2));
  const u32 = (v: number) => (view.setUint32(p, v >>> 0, true), (p += 4));
  const bytes = (b: Uint8Array) => (out.set(b, p), (p += b.length));
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(p);
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(time); u16(day);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.raw.length); u16(0);
    bytes(e.raw);
    bytes(e.data);
  }
  const central = p;
  entries.forEach((e, i) => {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(time); u16(day);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.raw.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
    bytes(e.raw);
  });
  const size = p - central;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(size); u32(central); u16(0);
  return out;
};
