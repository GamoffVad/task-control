// Документы Word (.doc): Word открывает HTML как документ, поэтому файл собирается разметкой.

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Обёртка документа: шрифт Times New Roman 12 pt, таблицы с тонкими рамками. */
export const wordDocument = (title: string, body: string) =>
  `<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body { font-family: 'Times New Roman', serif; font-size: 12pt; }
    h1 { font-size: 16pt; margin: 0 0 6pt; }
    h2 { font-size: 13pt; margin: 14pt 0 4pt; }
    p.sub { margin: 0 0 12pt; font-size: 10pt; color: #444; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 10pt; }
    th, td { border: 1px solid #999; padding: 4pt 6pt; text-align: left; vertical-align: top; font-size: 11pt; }
    th { background: #EFEFEF; }
    td.num, th.num { white-space: nowrap; }
  </style></head><body>${body}</body></html>`;

/** Текст построчно — абзацами (отступы сохраняются). */
export const wordParagraphs = (text: string) =>
  text.split('\n').map((line) => `<p style="margin:0;white-space:pre-wrap">${escapeHtml(line) || '&nbsp;'}</p>`).join('');

/** Таблица: заголовки и строки; ячейки экранируются. */
export const wordTable = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
