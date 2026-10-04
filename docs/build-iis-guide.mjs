// PDF инструкции по публикации в IIS: docs/iis-guide.md → docs/Контроль-задач-инструкция-IIS-v<версия>.pdf
// Оформление — как у руководства (docs/manual.html). Запуск: node docs/build-iis-guide.mjs.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { esc, inline, parseBlocks, renderBlock } from './md.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const blocks = parseBlocks(readFileSync(path.join(docs, 'iis-guide.md'), 'utf8'));
const manual = readFileSync(path.join(docs, 'manual.html'), 'utf8');

// Главы — «## N. Название»; абзацы до первой главы идут на страницу содержания.
const chapters = [];
const intro = [];
let current = null;
for (const b of blocks) {
  if (b.t === 'h' && b.level === 2) {
    const m = /^(\d+)\.\s+(.*)$/.exec(b.text);
    if (!m) continue;
    current = { no: m[1].padStart(2, '0'), title: m[2], blocks: [] };
    chapters.push(current);
  } else if (current) current.blocks.push(b);
  else if (b.t === 'p') intro.push(b);
}

const DESCRIPTIONS = {
  '01': 'что нужно привезти на сервер',
  '02': 'архив, установщики, роль IIS',
  '03': 'deploy-iis.bat на сервере',
  '04': 'deploy-iis-remote.bat по WinRM',
  '05': 'автоматически или скриптом create-database.sql',
  '06': 'health, вход администратором, Windows-вход',
  '07': 'новый архив и повторный запуск',
  '08': 'типичные симптомы и их причины',
  '09': 'каталоги, web.config, безопасность',
};

const css = /<style>([\s\S]*?)<\/style>/.exec(manual)[1];
const logo = /<div class="logo">[\s\S]*?<\/div><\/div>/.exec(manual)[0];
const today = new Date();
const date = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Контроль задач — публикация в IIS</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
${css}
  h4 { font-size: 10.5pt; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--ink); margin: 14px 0 5px; }
  td, th, li, p { overflow-wrap: break-word; }
  td code, li code, p code { overflow-wrap: anywhere; }
  ul ul { margin: 3px 0 3px; }
  .toc li .t { color: var(--ink); }
  .formula { font-size: 8.3pt; }
</style>
</head>
<body>

<section class="cover">
  <img src="assets/cover.png" alt="" /><div class="fade"></div>
  <div class="inner">
    ${logo}
    <div class="kicker">Инструкция · версия ${version}</div>
    <h1>Публикация<br />в IIS корпоративной<br />сети</h1>
    <p class="lead">Как развернуть и обновлять приложение на сервере без интернета: на самом сервере или с любого компьютера сети, с базой данных SQL Server и входом через Windows.</p>
    <div class="meta">
      <div><span>Версия</span><span class="num v">${version}</span></div>
      <div><span>Сервер</span>IIS · iisnode · Node.js</div>
      <div><span>База</span>Microsoft SQL Server</div>
      <div><span>Дата</span><span class="num v">${date}</span></div>
    </div>
  </div>
</section>

<section>
  <div class="chapter-head"><span class="no">00</span><h2>Содержание</h2></div>
  <ol class="toc">
${chapters.map((c) => `    <li><span class="num">${c.no}</span><span class="t">${esc(c.title)}</span><span class="d">${DESCRIPTIONS[c.no] ?? ''}</span></li>`).join('\n')}
  </ol>
${intro.map((b) => `  <p class="note" style="margin-top:18px">${inline(b.text)}</p>`).join('\n')}
  <p class="note amber"><b>Коротко.</b> Привезти на сервер архив <span class="num">task-control-iis-&lt;версия&gt;.zip</span> и установщики Node.js, iisnode, URL Rewrite → распаковать → запустить <span class="num">deploy-iis.bat</span> от имени администратора (или с другого компьютера: <span class="num">deploy-iis-remote.bat -Server ИМЯ</span>) → открыть <span class="num">/api/health</span> → заполнить Windows-логины сотрудников.</p>
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

const tmp = path.join(docs, '.iis-guide.render.html');
writeFileSync(tmp, html);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(docs, `Контроль-задач-инструкция-IIS-v${version}.pdf`);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#5D6575;padding:0 17mm;display:flex;justify-content:space-between">
      <span>Контроль задач ${version} · Публикация в IIS</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  console.log('PDF:', out);
} finally {
  await browser.close();
  rmSync(tmp);
}
