// PDF спецификации: docs/specification.md → docs/Контроль-задач-спецификация-v<версия>.pdf
// Оформление — та же дизайн-система, что и у руководства (docs/manual.html): обложка, главы, таблицы, формулы.
// Запуск: node docs/build-spec.mjs. Раздел «Информация» и public/manual не затрагиваются.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = readFileSync(path.join(docs, 'specification.md'), 'utf8').replaceAll('\r\n', '\n');
const manual = readFileSync(path.join(docs, 'manual.html'), 'utf8');

// ——— Markdown → HTML (только то, что используется в спецификации) ———

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Строчная разметка: `код`, **жирный**, [текст](адрес). Код прячется на время обработки остального. */
const inline = (text) => {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `${codes.push(`<code>${esc(c)}</code>`) - 1}`);
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`);
  return s.replace(/(\d+)/g, (_, i) => codes[Number(i)]);
};

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replaceAll('\\|', '|'));

const lines = source.split('\n');
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

const renderList = (items) => {
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

// Главы — заголовки «## N. Название». Всё до первой главы (шапка и содержание) в тело не попадает: обложку и оглавление строим сами.
const chapters = [];
let current = null;
const intro = [];
for (const b of blocks) {
  if (b.t === 'h' && b.level === 2) {
    const m = /^(\d+)\.\s+(.*)$/.exec(b.text);
    if (!m) { current = null; continue; } // «Содержание»
    current = { no: m[1].padStart(2, '0'), title: m[2], blocks: [] };
    chapters.push(current);
    continue;
  }
  if (current) current.blocks.push(b);
  else intro.push(b);
}

const renderBlock = (b) => {
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

/** Краткие пояснения к главам в оглавлении. */
const DESCRIPTIONS = {
  '01': 'зачем нужно приложение и где работает',
  '02': 'словарь предметной области',
  '03': 'роли, 20 разрешений, видимость задач по иерархии',
  '04': 'экраны и поведение каждого раздела',
  '05': 'сущности, поля и ограничения',
  '06': 'недели, сроки, баллы, остатки, пересечения',
  '07': 'API, выполнение действий, синхронизация',
  '08': 'SQL Server, PostgreSQL, файл',
  '09': 'токены, вход через Windows, защита данных',
  '10': 'события, адресаты, напоминания',
  '11': 'библиотека компонентов, темы, адаптивность',
  '12': 'сеть, браузеры, целостность, версии',
  '13': 'IIS без интернета, переменные, Vercel',
  '14': 'стек, команды, проверки, выпуски',
  '15': 'что приложение не делает или делает иначе',
  '16': 'права вкладок, данные браузера, шаблоны, демо-данные',
};

// Стили и знак логотипа берём из руководства, чтобы оформление не расходилось.
const css = /<style>([\s\S]*?)<\/style>/.exec(manual)[1];
const logo = /<div class="logo">[\s\S]*?<\/div><\/div>/.exec(manual)[0];

const today = new Date();
const date = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Контроль задач — спецификация</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
${css}
  /* Спецификация: подзаголовки четвёртого уровня — обычные, а не служебные подписи */
  h4 { font-size: 10.5pt; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--ink); margin: 14px 0 5px; }
  td, th, li, p { overflow-wrap: break-word; }
  td code, li code, p code { overflow-wrap: anywhere; }
  ul ul { margin: 3px 0 3px; }
  ol.steps > li { padding-left: 32px; }
  .toc li .t { color: var(--ink); }
  .lead-note { max-width: 150mm; }
</style>
</head>
<body>

<section class="cover">
  <img src="assets/cover.png" alt="" /><div class="fade"></div>
  <div class="inner">
    ${logo}
    <div class="kicker">Документация · версия ${version}</div>
    <h1>Спецификация<br />приложения</h1>
    <p class="lead">Назначение, роли и права, функции разделов, модель данных, правила расчётов, серверный API, безопасность и развёртывание в сети без интернета.</p>
    <div class="meta">
      <div><span>Версия</span><span class="num v">${version}</span></div>
      <div><span>Платформа</span>Vite 8 · React 19 · SQL Server</div>
      <div><span>Среда</span>корпоративная сеть, IIS</div>
      <div><span>Дата</span><span class="num v">${date}</span></div>
    </div>
  </div>
</section>

<section>
  <div class="chapter-head"><span class="no">00</span><h2>Содержание</h2></div>
  <ol class="toc">
${chapters.map((c) => `    <li><span class="num">${c.no}</span><span class="t">${esc(c.title)}</span><span class="d">${DESCRIPTIONS[c.no] ?? ''}</span></li>`).join('\n')}
  </ol>
  <p class="note" style="margin-top:18px"><b>Как читать.</b> Главы 01–03 — что это за приложение и кто с ним работает. Главы 04–06 — что оно делает и по каким правилам. Главы 07–10 — как устроена серверная часть. Главы 11–15 — оформление, требования и публикация. В приложениях — справочные таблицы. Источник истины — код; описание собрано по версии ${version}.</p>
${intro
  .filter((b) => b.t === 'p' && /Документ описывает/.test(b.text))
  .map((b) => `  <p class="note amber lead-note">${inline(b.text)}</p>`)
  .join('\n')}
</section>

${chapters
  .map(
    (c) => `<section class="chapter">
  <div class="chapter-head"><span class="no">${c.no}</span><h2>${esc(c.title)}</h2></div>
${c.blocks.map(renderBlock).join('\n')}
</section>`,
  )
  .join('\n\n')}

</body>
</html>
`;

const tmp = path.join(docs, '.specification.render.html');
writeFileSync(tmp, html);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(docs, `Контроль-задач-спецификация-v${version}.pdf`);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#5D6575;padding:0 17mm;display:flex;justify-content:space-between">
      <span>Контроль задач ${version} · Спецификация</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  console.log('PDF:', out);
} finally {
  await browser.close();
  rmSync(tmp);
}
