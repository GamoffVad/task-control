// PDF «Изменения в версии»: что сделано, как выглядит и что учесть. Оформление — как у руководства (docs/manual.html).
// Запуск: node docs/build-changes.mjs. Снимки экрана делаются с демоданными на четверг 17.09.2026 в светлой теме.
// Раздел «Информация» и public/manual не затрагиваются.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const shotsDir = path.join(docs, '.changes-shots');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manual = readFileSync(path.join(docs, 'manual.html'), 'utf8');
const FIXED_NOW = new Date(2026, 8, 17, 13, 20).getTime();

mkdirSync(shotsDir, { recursive: true });
const dbFile = path.join(root, '.data', 'changes-db.json');
rmSync(dbFile, { force: true });
process.env.TC_DB_FILE = dbFile;
process.env.TC_FIXED_NOW = String(FIXED_NOW);
delete process.env.DATABASE_URL;
const server = await createServer({ root, server: { port: 4181, strictPort: true, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const base = 'http://127.0.0.1:4181';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=ru-RU', '--font-render-hinting=none'] });
let counts = {};

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((fixed) => {
    const Real = Date;
    const offset = fixed - Real.now();
    class FakeDate extends Real {
      constructor(...args) {
        if (args.length === 0) super(Real.now() + offset);
        else super(...args);
      }
      static now() {
        return Real.now() + offset;
      }
    }
    globalThis.Date = FakeDate;
  }, FIXED_NOW);

  const go = async (url) => {
    await page.goto(base + url, { waitUntil: 'networkidle0' });
    await page.bringToFront();
  };
  const fill = (selector, value) =>
    page.$eval(selector, (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const clickText = async (selector, text) => {
    for (const h of await page.$$(selector)) {
      const t = await h.evaluate((el) => el.textContent ?? '');
      if (t.includes(text)) {
        await h.evaluate((el) => el.click());
        return;
      }
    }
    throw new Error(`Не найден элемент ${selector} с текстом «${text}»`);
  };
  const clip = async (selector, pad = 10) => {
    const b = await (await page.$(selector)).boundingBox();
    return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
  };
  const shot = async (name, opts = {}) => {
    await page.evaluate(() => document.fonts.ready);
    await sleep(300);
    await page.screenshot({ path: path.join(shotsDir, `${name}.png`), ...opts });
    console.log('снимок', name);
  };
  // Светлая тема: PDF свёрстан на светлой бумаге. Кнопка в шапке переключает тему; проверяем, что она включилась.
  const lightTheme = async () => {
    for (let i = 0; i < 5; i++) {
      const now = await page.evaluate(() => document.documentElement.dataset.theme);
      if (now === 'light') return;
      await page.evaluate(() => document.querySelector('button[aria-label="Включить светлую тему"]')?.click());
      await sleep(400);
    }
    throw new Error('Светлая тема не включилась');
  };

  // Вход администратором; вид календаря — «Неделя» (по умолчанию).
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await go('/calendar');
  await page.evaluate(() => localStorage.clear());
  await go('/calendar');
  await fill('input[autocomplete=username]', 'user@example.com');
  await fill('input[type=password]', '123456');
  await clickText('button', 'Войти');
  await page.waitForFunction(() => location.pathname === '/calendar' && !document.querySelector('.loading-screen'), { timeout: 20000 });
  await lightTheme();
  await sleep(500);

  // 1. Календарь: заголовок и фильтры в одну строку (1440) и с переносом (1024).
  await shot('calendar-head-1440', { clip: await clip('.sticky-head') });
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1.5 });
  await sleep(500);
  await shot('calendar-head-1024', { clip: await clip('.sticky-head') });

  // Неделя целиком на ширине 1280.
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1.5 });
  await sleep(500);
  await shot('calendar-week', { clip: await clip('.calendar-layout', 0) });

  // Закреплённая панель: «Месяц», страница прокручена — заголовок и фильтры остались наверху.
  await page.setViewport({ width: 1440, height: 640, deviceScaleFactor: 1.5 });
  await clickText('.seg button', 'Месяц');
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(500);
  await shot('calendar-pinned');
  await clickText('.seg button', 'Неделя');

  // 2. Планирование: один сотрудник — его столбец шире колонки разделов.
  await page.setViewport({ width: 1440, height: 760, deviceScaleFactor: 1.5 });
  await go('/planning');
  await sleep(600);
  await page.evaluate(async () => {
    const button = [...document.querySelectorAll('.filters .dd-btn')].find((b) => b.textContent.includes('Все сотрудники'));
    button.click();
    await new Promise((r) => setTimeout(r, 300));
    [...document.querySelectorAll('[role=option]')].find((o) => o.textContent.includes('Иванов')).click();
  });
  await sleep(700);
  await shot('planning-single', { clip: await clip('.plan-wrap', 0) });
  const widths = await page.evaluate(() => ({
    pos: Math.round(document.querySelector('.plan-table th.pos-cell').getBoundingClientRect().width),
    emp: Math.round(document.querySelector('.plan-table th.emp').getBoundingClientRect().width),
  }));

  // 3. Видимость задач: сколько задач получает каждый, по данным сервера.
  const api = async (p, init, token) =>
    (await fetch(base + p, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })).json();
  for (const [key, email] of [['admin', 'user@example.com'], ['manager', 'petrov@example.com'], ['executor', 'sidorov@example.com']]) {
    const { token } = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password: '123456' }) });
    const { data } = await api('/api/state', {}, token);
    counts[key] = data.tasks.length;
  }
  counts.widths = widths;
  console.log('числа', JSON.stringify(counts));
} finally {
  await browser.close();
  await server.close();
  rmSync(dbFile, { force: true });
}

// ——— Документ ———
const css = /<style>([\s\S]*?)<\/style>/.exec(manual)[1];
const logo = /<div class="logo">[\s\S]*?<\/div><\/div>/.exec(manual)[0];
const today = new Date();
const date = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
const img = (name) => pathToFileURL(path.join(shotsDir, `${name}.png`)).href;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Контроль задач — изменения в версии ${version}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
${css}
  h4 { font-size: 10.5pt; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--ink); margin: 14px 0 5px; }
  p, li, td { overflow-wrap: break-word; }
  .block { break-inside: avoid; border-top: 1px solid var(--accent); padding-top: 10px; margin-top: 16px; }
  .block:first-of-type { margin-top: 4px; }
  .block .head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
  .block .head .no { font-family: 'IBM Plex Mono', monospace; font-size: 18pt; font-weight: 500; color: var(--accent); line-height: 1; }
  .block .head h3 { margin: 0; font-size: 14pt; }
  .block ul { margin-bottom: 8px; }
  figure.wide img { border-top-width: 2px; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); margin: 10px 0 14px; break-inside: avoid; }
  .tile { padding: 0 14px; border-left: 1px dashed var(--dash); }
  .tile:first-child { border-left: none; padding-left: 0; }
  .tile span { display: block; font-size: 7pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
  .tile b { font-family: 'IBM Plex Mono', monospace; font-size: 26pt; line-height: 1.15; font-weight: 500; color: var(--accent); }
  .tile small { display: block; font-size: 8pt; color: var(--ink-3); line-height: 1.45; }
  .cmp { display: grid; grid-template-columns: 1fr; gap: 4px; }
  .sizes { display: flex; gap: 10px; align-items: center; margin: 8px 0 12px; font-size: 9pt; }
  .sizes .bar { height: 14px; background: var(--accent); border-radius: 1px; }
  .sizes .bar.alt { background: var(--accent-2); opacity: 0.55; }
  .sizes .lbl { width: 78px; color: var(--ink-3); font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; }
</style>
</head>
<body>

<section class="cover">
  <img src="assets/cover.png" alt="" /><div class="fade"></div>
  <div class="inner">
    ${logo}
    <div class="kicker">Выпуск · версия ${version}</div>
    <h1>Что изменилось<br />в версии ${version}</h1>
    <p class="lead">Календарь, планирование и видимость задач по иерархии подразделений.</p>
    <div class="meta">
      <div><span>Версия</span><span class="num v">${version}</span></div>
      <div><span>Изменений</span><span class="num v">3 замечания</span></div>
      <div><span>Проверки</span><span class="num v">285 тестов</span></div>
      <div><span>Дата</span><span class="num v">${date}</span></div>
    </div>
  </div>
</section>

<section class="chapter" style="break-before: auto;">
  <div class="chapter-head"><span class="no">01</span><h2>Календарь</h2></div>
  <p class="intro">Убрана «Рабочая неделя», выбранный вид запоминается, заголовок с фильтрами закреплён, а поиск больше не наезжает на список категорий.</p>

  <div class="block">
    <div class="head"><span class="no">а</span><h3>Виды и запоминание</h3></div>
    <ul>
      <li>Остались <b>«День»</b>, <b>«Неделя»</b> и <b>«Месяц»</b>. По умолчанию открывается «Неделя».</li>
      <li>Выбранный вид <b>запоминается в браузере отдельно для каждого сотрудника</b> и возвращается при следующем заходе. Прежнее сохранённое «Рабочая неделя» превращается в «Неделю».</li>
    </ul>
    <figure class="wide"><img src="${img('calendar-week')}" alt="" /><figcaption><span class="num">Рис. 1</span>Календарь, вид «Неделя»: три вида вместо четырёх.</figcaption></figure>
  </div>

  <div class="block">
    <div class="head"><span class="no">б</span><h3>Вёрстка фильтров</h3></div>
    <p>Раньше поле поиска (минимум 200 px) выступало за свою ячейку и наезжало на список категорий. Теперь у ячеек есть минимальная ширина, а когда места не хватает, они <b>переносятся на вторую строку</b>.</p>
    <div class="cmp">
      <figure><img src="${img('calendar-head-1440')}" alt="" /><figcaption><span class="num">Рис. 2</span>1440 px: все фильтры в одной строке.</figcaption></figure>
      <figure><img src="${img('calendar-head-1024')}" alt="" /><figcaption><span class="num">Рис. 3</span>1024 px: категории — на второй строке, без наложения.</figcaption></figure>
    </div>
  </div>
</section>

<section class="chapter" style="break-before: auto; margin-top: 18px;">
  <div class="chapter-head"><span class="no">02</span><h2>Закреплённая панель и планирование</h2></div>

  <div class="block">
    <div class="head"><span class="no">а</span><h3>Заголовок и фильтры закреплены</h3></div>
    <p>Заголовок «Календаря» и строка фильтров остаются под шапкой приложения при прокрутке страницы. Закрепление включается на ширине от 1024 px; на узких экранах панель не закрепляется, чтобы не занимать почти весь экран.</p>
    <figure class="wide"><img src="${img('calendar-pinned')}" alt="" /><figcaption><span class="num">Рис. 4</span>«Месяц», страница прокручена: заголовок и фильтры на месте.</figcaption></figure>
  </div>

  <div class="block">
    <div class="head"><span class="no">б</span><h3>Планирование: столбец одного сотрудника шире</h3></div>
    <p>Когда в матрице один сотрудник (он сам или выбранный в фильтре), его столбец шире колонки разделов планирования, а не равен ей.</p>
    <div class="sizes"><span class="lbl">Разделы</span><span class="bar alt" style="width:${Math.round((counts.widths.pos / counts.widths.emp) * 300)}px"></span><span class="num">${counts.widths.pos} px</span></div>
    <div class="sizes"><span class="lbl">Сотрудник</span><span class="bar" style="width:300px"></span><span class="num">${counts.widths.emp} px</span></div>
    <figure class="wide"><img src="${img('planning-single')}" alt="" /><figcaption><span class="num">Рис. 5</span>Планирование на ширине 1440 px, выбран Иванов А.Б.</figcaption></figure>
  </div>
</section>

<section class="chapter" style="break-before: auto; margin-top: 18px;">
  <div class="chapter-head"><span class="no">03</span><h2>Видимость задач по иерархии</h2></div>
  <p class="intro">Каждый видит задачи в соответствии со своим местом в иерархии подразделений. Правило считает сервер: чужие задачи не попадают в браузер вообще.</p>

  <table>
    <tr><th style="width:28%">Кто</th><th>Какие задачи видит</th></tr>
    <tr><td>Подчинённый</td><td>Только свои.</td></tr>
    <tr><td>Начальник отделения</td><td>Задачи своего подразделения вместе с вложенными — своего направления. Это тот, кто планирует задачи другим (разрешение «Планировать задачи для сотрудников»).</td></tr>
    <tr><td>Начальник отдела и администратор</td><td>Все задачи отдела. Это задаёт новое разрешение <code>tasks.viewAll</code> — «Видеть задачи всего отдела»: по умолчанию оно у администратора, его можно выдать и другой роли.</td></tr>
  </table>

  <h4>Сколько задач получает каждый (демоданные)</h4>
  <div class="tiles">
    <div class="tile"><span>Администратор</span><b>${counts.admin}</b><small>Иванов А.Б., начальник отдела — все задачи</small></div>
    <div class="tile"><span>Руководитель</span><b>${counts.manager}</b><small>Петров В.С., подразделение «Руководство»</small></div>
    <div class="tile"><span>Исполнитель</span><b>${counts.executor}</b><small>Сидоров Д.Е. — только свои</small></div>
  </div>

  <h4>Где действует правило</h4>
  <ul>
    <li><b>Сервер</b> отдаёт только видимые задачи; в отчётах скрыты строки невидимых сотрудников.</li>
    <li><b>Изменение:</b> нельзя изменить или удалить невидимую задачу и назначить исполнителем сотрудника вне своего подразделения.</li>
    <li><b>Интерфейс:</b> фильтры «Исполнитель», «Сотрудник» и «Группа», выбор исполнителей в карточке задачи, столбцы «Планирования», дерево «Сотрудников» и «Показатели» ограничены той же областью.</li>
    <li><b>Уведомление</b> «Задача исполнена» получают только руководители, которым задача видна.</li>
  </ul>

  <div class="note amber"><b>Что учесть.</b> Отдельного поля «начальник отделения» нет: им считается любой сотрудник с ролью «Руководитель» и подразделением. Чтобы заместитель начальника отдела видел весь отдел, выдайте его роли разрешение «Видеть задачи всего отдела» в «Администрирование → Роли и разрешения». Если нужен явно назначаемый руководитель в карточке подразделения — это отдельная доработка.</div>

  <h4>Выпуск</h4>
  <p>Версия <span class="num">${version}</span> опубликована на Vercel и в GitHub (тег <span class="num">v${version}</span>), архив для IIS приложен к релизу. Набор прав — версия 7: администратору разрешение дописывается при обновлении базы и при чтении старой базы, до первой записи. Проверки: 285 тестов, типы и линтер без замечаний; видимость проверена тестами и на опубликованном сайте.</p>
</section>

</body>
</html>
`;

const tmp = path.join(docs, '.changes.render.html');
writeFileSync(tmp, html);

const browser2 = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser2.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(docs, `Контроль-задач-изменения-v${version}.pdf`);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#5D6575;padding:0 17mm;display:flex;justify-content:space-between">
      <span>Контроль задач ${version} · Изменения в версии</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  console.log('PDF:', out);
} finally {
  await browser2.close();
  rmSync(tmp);
  rmSync(shotsDir, { recursive: true, force: true });
}
