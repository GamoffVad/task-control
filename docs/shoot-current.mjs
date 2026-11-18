// Снимки на изолированном сервере с демонстрационными данными в памяти, без SQL Server.
import { mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output', 'manual-shots');
const now = new Date(2026, 8, 17, 13, 20);
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
if (!chrome) throw new Error('Не найден браузер Chrome или Edge.');
await mkdir(out, { recursive: true });
let handler;
let manualIdentity = 'CORP\\user';
const mockApi = { name: 'manual-memory-api', enforce: 'pre', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    try {
      if (!handler) {
        const [{ createApi }, { createMemoryRepo }, { createSeed }, { toData }] = await Promise.all([
          server.ssrLoadModule('/server/app.ts'), server.ssrLoadModule('/server/repo.ts'),
          server.ssrLoadModule('/src/lib/seed.ts'), server.ssrLoadModule('/src/lib/reducer.ts'),
        ]);
        handler = createApi({ repo: createMemoryRepo(undefined, toData(createSeed(now))), secret: 'manual-screenshot-only', now: () => now, windowsIdentity: () => manualIdentity, windowsCheck: () => ({ enabled: true, identity: manualIdentity, secretRequired: false, secretOk: true, seen: [], problem: null }) });
      }
      await handler(req, res);
    } catch (error) { console.error(error); res.statusCode = 500; res.end('Screenshot API error'); }
  });
} };
const server = await createServer({ root, plugins: [mockApi], server: { port: 4180, strictPort: true, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--lang=ru-RU'] });
const done = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((fixed) => { const RealDate = Date; const offset = fixed - RealDate.now(); globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); } static now() { return RealDate.now() + offset; } }; }, now.getTime());
  const go = async (route) => { await page.goto(`http://127.0.0.1:4180${route}`, { waitUntil: 'networkidle0' }); await page.waitForSelector('nav', { timeout: 15000 }); };
  const shot = async (name, { selector, clip } = {}) => {
    for (const theme of ['dark', 'light']) {
      await page.evaluate((wanted) => { const b = document.querySelector(`button[aria-label="Включить ${wanted === 'light' ? 'светлую' : 'тёмную'} тему"]`); if (b) b.click(); }, theme);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const file = path.join(out, `${name}${theme === 'light' ? '.light' : ''}.png`);
      if (selector) {
        const element = await page.$(selector);
        if (!element) throw new Error(`Нет области снимка: ${selector}`);
        await element.screenshot({ path: file });
      } else await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
      done.push(`${name}${theme === 'light' ? '.light' : ''}.png`);
    }
    console.log('Снимок:', name);
  };
  if (process.argv.includes('--remaining-only')) {
    const choose = async (selector, text) => { const ok = await page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t)); if (!el) return false; el.click(); return true; }, selector, text); if (!ok) throw new Error(`Не найдено: ${selector} ${text}`); };
    const press = async (selector) => { await page.$eval(selector, (el) => el.click()); };
    const fill = async (selector, value) => page.$eval(selector, (el, text) => { const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    const dialog = async () => page.waitForSelector('[role=dialog]', { timeout: 5000 });
    const close = async () => { await press('[role=dialog] button[aria-label="Закрыть"]'); await page.waitForSelector('[role=dialog]', { hidden: true }); };
    await go('/planning');
    await press('[aria-label^="Шаг новых задач:"]'); await shot('44-planning-step');
    await go('/planning');
    await shot('05b-planning-cell');
    await press('.cell-add'); await dialog(); await choose('[role=dialog] button', 'Сохранить'); await shot('04c-task-validation', { selector: '[role=dialog]' }); await close();
    await press('.cell-add'); await dialog(); await press('[role=dialog] .datefield-btn'); await page.waitForSelector('.datepop', { timeout: 5000 }); await shot('23-datepicker'); await close();
    await go('/planning');
    await press('.chip'); await dialog();
    if (!(await page.$('#task-score:not([disabled])'))) throw new Error('Не найдено активное поле баллов у задачи');
    await fill('#task-score', '7'); await shot('04b-task-score', { selector: '.done-box' }); await close();
    await go('/planning'); await press('button[aria-label="Направить в отчёт"], button[aria-label="Обновить отчёт"]'); await page.waitForSelector('[role=status]', { timeout: 5000 }); await shot('06-planning-report-sent');
    await go('/reports'); await press('button[aria-label="Документ"]'); await dialog(); await shot('08b-report-doc'); await close();
    await go('/tetris'); await press('.tl-cell:not([disabled])'); await dialog();
    await press('[role=dialog] [aria-label^="Вид события:"]'); await choose('[role=option]', 'Дежурство');
    const dateInputs = await page.$$('[role=dialog] .datefield input');
    if (dateInputs.length < 2) throw new Error('Нет полей периода дежурства');
    for (const [el, value] of [[dateInputs[0], '19.09.2026'], [dateInputs[1], '20.09.2026']]) await el.evaluate((node, text) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value').set.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await shot('38-duty-weekend', { selector: '[role=dialog]' }); await close();
    await go('/calendar'); await shot('11b-chat-badge', { clip: { x: 0, y: 0, width: 1440, height: 118 } });
    await go('/admin'); await choose('button', 'Редактирование UI'); await page.$eval('.nav-order-board', (el) => el.scrollIntoView({ block: 'center' })); await shot('41-nav-order');
    manualIdentity = 'CORP\\sidorov';
    await page.evaluate(() => localStorage.clear()); await go('/planning'); await shot('15-exec-planning');
    await press('.chip'); await dialog(); await shot('16-exec-task'); await close();
    await go('/admin'); await shot('36-exec-admin');
    for (const file of done) await copyFile(path.join(out, file), path.join(root, 'docs', 'shots', file));
    console.log(`Обновлено файлов: ${done.length}.`);
  } else {
  if (!process.argv.includes('--extras-only')) {
  for (const [route, name] of [['/calendar','02-calendar-week'],['/planning','05-planning'],['/control','07-control'],['/reports','08-reports'],['/kpi','09-kpi'],['/employees/3','10-employee'],['/chat','11-chat'],['/tetris','19-absences'],['/info','25-info'],['/admin','26-admin-users']]) { await go(route); await shot(name); }
  for (const [label, name] of [['Подразделения','30-admin-units'], ['Роли и разрешения','27-admin-roles'], ['Словари','31-admin-dictionaries'], ['Производственный календарь','45-production-calendar'], ['Шаблоны документов','32-admin-templates'], ['Оценка','34-admin-scoring'], ['Редактирование UI','35-admin-ui'], ['Разделы планирования','28-admin-plan'], ['База данных','39-admin-database'], ['Периоды','37-admin-periods']]) {
    const clicked = await page.evaluate((text) => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === text); if (!b) return false; b.click(); return true; }, label);
    if (!clicked) throw new Error(`Не найдена вкладка администрирования: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 300)); await shot(name);
  }
  }
  await go('/calendar');
  await shot('13-light-calendar');
  const click = async (selector, text) => {
    const found = await page.evaluate((sel, value) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(value)); if (!el) return false; el.click(); return true; }, selector, text);
    if (!found) throw new Error(`Элемент не найден: ${selector} ${text}`);
  };
  const attempt = async (name, fn) => { try { await fn(); await shot(name); } catch (e) { console.warn(`Не удалось обновить ${name}: ${e.message}`); } };
  await attempt('02b-calendar-search', async () => { const input = await page.$('input[type=search]'); if (!input) throw new Error('нет поиска'); await input.type('доклад'); await new Promise((resolve) => setTimeout(resolve, 300)); });
  await go('/calendar');
  await attempt('02c-calendar-categories', async () => { const el = await page.$('[aria-label^="Категории мероприятий"]'); if (!el) throw new Error('нет фильтра категорий'); await el.click(); });
  await go('/calendar');
  await attempt('03-calendar-month', async () => click('button', 'Месяц'));
  await attempt('03b-calendar-day', async () => click('button', 'День'));
  await go('/calendar');
  await attempt('04-task-modal', async () => { const card = await page.$('.cal-event'); if (!card) throw new Error('нет карточки'); await card.click(); await page.waitForSelector('[role=dialog]', { timeout: 3000 }); });
  await go('/employees/3');
  await attempt('21-employee-absences', async () => click('[role=tab]', 'События'));
  await go('/tetris');
  await attempt('20-absence-modal', async () => { const cell = await page.$('.tl-cell:not([disabled])'); if (!cell) throw new Error('нет доступной ячейки'); await cell.evaluate((el) => el.click()); await page.waitForSelector('[role=dialog]', { timeout: 3000 }); });
  await go('/control');
  await attempt('12-filter-dropdown', async () => { const el = await page.$('.filters .dd-btn'); if (!el) throw new Error('нет фильтра'); await el.click(); });
  await go('/calendar');
  await attempt('43-calendar-resize', async () => click('button', 'Заблокировано'));
  await go('/planning');
  await attempt('05c-planning-doc', async () => { await page.$eval('button[aria-label="Документ"]', (el) => el.click()); await page.waitForSelector('[role=dialog]', { timeout: 3000 }); });
  await go('/admin');
  await click('button', 'Словари');
  await attempt('31-admin-dictionary', async () => { await page.$eval('button[aria-label^="Изменить значение "]', (el) => el.click()); await page.waitForSelector('[role=dialog]', { timeout: 3000 }); });
  await go('/admin');
  await click('button', 'Шаблоны документов');
  await attempt('33-admin-template-dialog', async () => { await page.$eval('button[aria-label^="Изменить шаблон "]', (el) => el.click()); await page.waitForSelector('[role=dialog]', { timeout: 3000 }); });
  await go('/admin');
  await click('button', 'Разделы планирования');
  await attempt('29-admin-plan-dialog', async () => { await page.$eval('button[aria-label^="Редактировать позицию "]', (el) => el.click()); await page.waitForSelector('[role=dialog]', { timeout: 3000 }); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await go('/control'); await shot('17-mobile-control');
  await go('/calendar'); await shot('18-mobile-calendar');
  for (const file of done) await copyFile(path.join(out, file), path.join(root, 'docs', 'shots', file));
  console.log(`Обновлено файлов: ${done.length}.`);
  }
} finally { await browser.close(); await server.close(); }
