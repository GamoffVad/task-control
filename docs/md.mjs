// Минимальный Markdown → HTML для PDF-документов (спецификация, инструкции): заголовки, абзацы, списки, таблицы, код.
export const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Строчная разметка: `код`, **жирный**, [текст](адрес). Код прячется на время обработки остального. */
export const inline = (text) => {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `${codes.push(`<code>${esc(c)}</code>`) - 1}`);
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`);
  return s.replace(/(\d+)/g, (_, i) => codes[Number(i)]);
};

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replaceAll('\\|', '|'));

/** Разбор текста Markdown на блоки. */
export const parseBlocks = (source) => {
  const lines = source.replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10)).split(String.fromCharCode(10));
const blocks = [];
for (let i = 0; i < lines.length; ) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  if (/^---+\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
  if (line.startsWith('```')) {
    const body = [];
    for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
    i++;
    blocks.push({ t: 'code', text: body.join('\n') });
    continue;
  }
  if (line.startsWith('|')) {
    const rows = [];
    for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
    blocks.push({ t: 'table', head: cells(rows[0]), body: rows.slice(2).map(cells) });
    continue;
  }
  if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
    const items = [];
    for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) {
      const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
      items.push({ depth: m[1].length >= 2 ? 1 : 0, ordered: /\d/.test(m[2]), text: m[3] });
    }
    blocks.push({ t: 'list', items });
    continue;
  }
  const para = [];
  for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||---+\s*$|\s*([-*]|\d+\.)\s+)/.test(lines[i]); i++) para.push(lines[i].trim());
  blocks.push({ t: 'p', text: para.join(' ') });
}

  return blocks;
};

export const renderList = (items) => {
  let html = '';
  let open = null; // тег внешнего списка
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.depth === 0) {
      if (open && open !== (it.ordered ? 'ol' : 'ul')) { html += `</${open}>`; open = null; }
      if (!open) { open = it.ordered ? 'ol' : 'ul'; html += `<${open}${it.ordered ? ' class="steps"' : ''}>`; }
      const nested = [];
      while (items[k + 1]?.depth === 1) nested.push(items[++k]);
      html += `<li>${inline(it.text)}${nested.length ? `<ul>${nested.map((n) => `<li>${inline(n.text)}</li>`).join('')}</ul>` : ''}</li>`;
    } else {
      html += `<li>${inline(it.text)}</li>`;
    }
  }
  return html + (open ? `</${open}>` : '');
};

export const renderBlock = (b) => {
  switch (b.t) {
    case 'h': return b.level === 3 ? `<h3>${inline(b.text)}</h3>` : `<h4>${inline(b.text)}</h4>`;
    case 'p': return `<p>${inline(b.text)}</p>`;
    case 'code': return `<div class="formula">${esc(b.text)}</div>`;
    case 'list': return renderList(b.items);
    case 'hr': return '';
    case 'table':
      return `<table><thead><tr>${b.head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${b.body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    default: return '';
  }
};

