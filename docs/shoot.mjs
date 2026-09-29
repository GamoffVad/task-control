// Дымовая проверка собранного приложения в Chrome и съёмка экранов для документации.
// Запуск: npm run build && node docs/shoot.mjs
import { mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'shots');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

// Демоданные строятся от «сегодня»; для одинаковых снимков фиксируем четверг 17.09.2026, 13:20.
const FIXED_NOW = new Date(2026, 8, 17, 13, 20).getTime();
const ROUTES = ['/calendar', '/planning', '/control', '/tetris', '/reports', '/kpi', '/employees/1', '/chat', '/info', '/kit', '/admin'];
const WIDTHS = [375, 768, 1024, 1440];

// Очищаем файлы, а не папку: её может держать открытой проводник.
await mkdir(out, { recursive: true });
for (const f of await readdir(out)) await rm(path.join(out, f), { force: true });
// Сервер разработки вместе с API; база — отдельный файл, очищается перед съёмкой.
const dbFile = path.join(root, '.data', 'shots-db.json');
await rm(dbFile, { force: true });
process.env.TC_DB_FILE = dbFile;
process.env.TC_FIXED_NOW = String(FIXED_NOW);
delete process.env.DATABASE_URL;
const server = await createServer({ root, server: { port: 4180, strictPort: true, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const base = 'http://127.0.0.1:4180';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=ru-RU', '--font-render-hinting=none'] });
const problems = [];

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
  page.on('console', (m) => {
    // 401 на экране входа — намеренная проверка неверного пароля.
    if (m.type() === 'error' && m.text().includes('401') && page.url().endsWith('/login')) return;
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()} @ ${page.url()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message} @ ${page.url()}`));
  page.on('requestfailed', (r) => {
    if (!r.url().includes('fonts.g')) problems.push(`requestfailed: ${r.url()}`);
  });

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  // Тема переключается кнопкой в шапке: программный click не вызывает mousedown,
  // поэтому открытые списки, календари и окна остаются открытыми.
  const setTheme = async (theme) => {
    const label = theme === 'light' ? 'Включить светлую тему' : 'Включить тёмную тему';
    await page.evaluate((l, t) => {
      const button = document.querySelector(`button[aria-label="${l}"]`);
      if (button) button.click();
      else document.documentElement.dataset.theme = t;
    }, label, theme);
    await new Promise((r) => setTimeout(r, 300));
  };
  // Каждый снимок — в двух темах: name.png (тёмная) и name.light.png (светлая).
  // «Информация» показывает вариант текущей темы, PDF собирается из светлых.
  const shot = async (name, { lightOnly = false, ...opts } = {}) => {
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 250));
    if (!lightOnly) await page.screenshot({ path: path.join(out, `${name}.png`), ...opts });
    await setTheme('light');
    await page.screenshot({ path: path.join(out, `${name}.light.png`), ...opts });
    if (lightOnly) await page.screenshot({ path: path.join(out, `${name}.png`), ...opts });
    await setTheme('dark');
    console.log('снимок', name);
  };
  const go = async (url) => {
    await page.goto(base + url, { waitUntil: 'networkidle0' });
    await page.bringToFront();
  };
  const clickText = async (selector, text) => {
    for (const h of await page.$$(selector)) {
      const t = await h.evaluate((el) => el.textContent ?? '');
      if (t.includes(text)) {
        // Программный клик: липкая шапка не перехватит его.
        await h.evaluate((el) => el.click());
        return;
      }
    }
    throw new Error(`Не найден элемент ${selector} с текстом «${text}»`);
  };
  const clipOf = async (selector, pad = 12) => {
    const b = await (await page.$(selector)).boundingBox();
    return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
  };
  // Заполнение поля без клавиатуры: нативный сеттер + событие input, которое слушает React.
  const fill = (selector, value) =>
    page.$eval(selector, (el, v) => {
      // Название задачи — многострочное поле: сеттер берётся от прототипа самого элемента.
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const login = async (email) => {
    await go('/login');
    await fill('input[autocomplete=username]', email);
    await fill('input[type=password]', '123456');
    await clickText('button', 'Войти');
    await page.waitForFunction(() => location.pathname === '/calendar' && !document.querySelector('.loading-screen'), { timeout: 15000 }).catch(async (e) => {
      console.log('URL', page.url(), await page.evaluate(() => document.body.innerText.slice(0, 300)));
      throw e;
    });
  };
  // Сообщения коллег — через API от их имени, чтобы у вошедшего появились непрочитанные.
  const say = async (email, text) => {
    const call = async (p, body, token) =>
      (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
    const { token } = await call('/api/login', { email, password: '123456' });
    await call('/api/action', { action: { type: 'sendMessage', text } }, token);
  };
  const logout = async () => {
    await page.$eval('button[aria-label="Выйти"]', (el) => el.click());
    await page.waitForFunction(() => location.pathname === '/login');
  };
  // Закрываем кнопкой, а не Escape: после перехода по адресу вкладка без фокуса не получает клавиши.
  const closeDialog = async () => {
    await page.$eval('[role=dialog] button[aria-label="Закрыть"]', (el) => el.click());
    await page.waitForSelector('[role=dialog]', { hidden: true });
  };

  // Вход (тёмная тема по умолчанию)
  await go('/calendar');
  await page.evaluate(() => localStorage.clear());
  await go('/calendar');
  if (!page.url().endsWith('/login')) problems.push('Без входа не произошло перенаправления на /login');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'dark') problems.push(`Тема по умолчанию: ${theme}, ожидалась тёмная`);
  await shot('01-login');
  await fill('input[autocomplete=username]', 'user@example.com');
  await fill('input[type=password]', '000000');
  await clickText('button', 'Войти');
  await page.waitForSelector('[role=alert]:not(:empty)');
  await shot('01b-login-error', { clip: { x: 0, y: 0, width: 720, height: 900 } });
  await login('user@example.com');
  // Переписка прочитана при входе; новые сообщения коллег появятся перед съёмкой чата.
  await go('/chat');
  await go('/calendar');

  // Календарь
  await shot('02-calendar-week');
  await fill('input[type=search]', 'доклад');
  await page.waitForSelector('.search-results li');
  await shot('02b-calendar-search');
  await page.$eval('.search-results li button', (el) => el.click());
  await page.waitForSelector('[role=dialog]');
  await closeDialog();
  await page.$eval('.search .clear', (el) => el.click());
  await clickText('.stepper .text-action', 'Сегодня');
  // Категории — выпадающий список с отметками в строке фильтров.
  await page.$eval('[aria-label^="Категории мероприятий"]', (el) => el.click());
  await page.waitForSelector('.dd-list');
  await clickText('.dd-list [role=option]', 'Иное');
  await shot('02c-calendar-categories', { clip: { x: 0, y: 50, width: 1440, height: 450 } });
  await clickText('.dd-list [role=option]', 'все категории');
  await page.keyboard.press('Escape');
  await clickText('.seg button', 'Месяц');
  await shot('03-calendar-month');
  await clickText('.seg button', 'День');
  await shot('03b-calendar-day');
  await clickText('.seg button', 'Рабочая неделя');

  // Карточка задачи: баллы за исполнение
  await clickText('.cal-event', 'Провести планёрку');
  await page.waitForSelector('[role=dialog]');
  await shot('04-task-modal');
  await fill('#task-score', '7');
  await shot('04b-task-score', await clipOf('.done-box', 16));
  await closeDialog();
  await clickText('.page-actions button', 'Новая задача');
  await page.waitForSelector('[role=dialog]');
  await clickText('[role=dialog] button', 'Сохранить');
  await shot('04c-task-validation');
  await closeDialog();

  // Планирование: несколько задач в ячейке
  await go('/planning');
  await shot('05-planning');
  await clickText('.page-actions button', 'Документ');
  await page.waitForSelector('[role=dialog]');
  await shot('05c-planning-doc');
  await closeDialog();
  await page.$eval('button[aria-label^="Добавить задачу — 1.1 Подготовка аналитических материалов, Иванов А.Б. (задач: 1)"]', (el) => el.click());
  await page.waitForSelector('[role=dialog]');
  await fill('#task-title', 'Справка о загрузке отдела');
  await clickText('[role=dialog] button', 'Сохранить');
  await page.waitForSelector('[role=dialog]', { hidden: true });
  const cellRow = 'tr:has(button[aria-label^="Добавить задачу — 1.1 Подготовка аналитических материалов, Иванов А.Б. (задач: 2)"])';
  await page.$eval(cellRow, (el) => el.scrollIntoView({ block: 'center' }));
  await shot('05b-planning-cell', await clipOf(cellRow, 4));
  await clickText('.page-actions button', 'отчёт');
  await page.waitForSelector('.status');
  await shot('06-planning-report-sent', { clip: { x: 0, y: 0, width: 1440, height: 420 } });

  // Доска «Контроля» — шесть колонок по три в ряд: окно выше, чтобы попали оба ряда.
  await page.setViewport({ width: 1440, height: 1480, deviceScaleFactor: 1.5 });
  await go('/control');
  await shot('07-control');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await go('/reports');
  await page.click('button[aria-label="Неделя: вперёд"]');
  await shot('08-reports');
  await clickText('.page-actions button', 'Документ');
  await page.waitForSelector('[role=dialog]');
  await shot('08b-report-doc');
  await closeDialog();
  await go('/kpi');
  // Экран вырос из-за разреза по направлениям: снимаем окном повыше, чтобы попали и сотрудники, и недели.
  await page.setViewport({ width: 1440, height: 1560, deviceScaleFactor: 1.5 });
  await go('/kpi');
  await shot('09-kpi');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await go('/employees/3');
  await shot('10-employee');
  await say('sidorov@example.com', 'Сборка модуля авторизации выложена на тестовый стенд.');
  await say('petrov@example.com', 'Принято. Сверку по бюджету переношу на пятницу, 10:00.');
  await go('/employees/3');
  await page.waitForSelector('.unread-pill');
  await shot('11b-chat-badge', { clip: { x: 0, y: 0, width: 1440, height: 118 } });
  await go('/chat');
  await page.waitForSelector('.new-sep');
  await page.$eval('#chat-input', (el) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Отчёт за неделю отправлен, прошу проверить.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('.composer button', 'Отправить');
  await shot('11-chat');
  await go('/control');
  await page.click('.filters .dd-btn');
  await shot('12-filter-dropdown', { clip: { x: 0, y: 60, width: 1440, height: 520 } });
  await page.keyboard.press('Escape');

  // Тетрис (отсутствия)
  await go('/tetris');
  await shot('19-absences');
  await clickText('.tt-tools button', 'Событие');
  await page.waitForSelector('[role=dialog]');
  await clickText('[role=dialog] .dd-btn', 'Иванов');
  await clickText('[role=dialog] [role=option]', 'Кузнецов М.П.');
  // Поля дат — свои (библиотека компонентов): вводим текст, полная дата применяется сразу.
  const [from, to] = await page.$$('[role=dialog] .datefield input');
  for (const [el, v] of [[from, '18.09.2026'], [to, '22.09.2026']]) {
    await el.evaluate((node, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  }
  await page.waitForSelector('[role=dialog] .warn-note');
  await shot('20-absence-modal');
  await closeDialog();
  await go('/employees/2');
  await page.$eval('[aria-label="Отсутствия сотрудника"]', (el) => el.scrollIntoView({ block: 'start' }));
  await shot('21-employee-absences', await clipOf('[aria-label="Отсутствия сотрудника"]', 8));

  // Библиотека компонентов: календарь в окне задачи и витрина
  await go('/calendar');
  await clickText('.page-actions button', 'Новая задача');
  await page.waitForSelector('[role=dialog]');
  await page.$eval('[role=dialog] .datefield-btn', (el) => el.click());
  await page.waitForSelector('.datepop');
  await shot('23-datepicker', await clipOf('[role=dialog]', 0));
  await page.keyboard.press('Escape');
  await closeDialog();
  await go('/kit');
  await shot('24-kit');
  await go('/info');
  await shot('25-info');

  // Администрирование
  await go('/admin');
  await shot('26-admin-users');
  await clickText('.admin-page .seg button', 'Подразделения');
  await shot('30-admin-units');
  await clickText('.admin-page .seg button', 'Словари');
  await page.$eval('button[aria-label^="Изменить значение Доклад руководству отдела"]', (el) => el.click());
  await page.waitForSelector('[role=dialog]');
  await shot('31-admin-dictionary', await clipOf('[role=dialog]', 0));
  await closeDialog();
  await clickText('.admin-page .seg button', 'Шаблоны документов');
  await shot('32-admin-templates', { clip: { x: 0, y: 0, width: 1440, height: 520 } });
  await page.$eval('button[aria-label^="Изменить шаблон Справка"]', (el) => el.click());
  await page.waitForSelector('[role=dialog]');
  await shot('33-admin-template-dialog');
  await closeDialog();
  await clickText('.admin-page .seg button', 'Оценка');
  // Вкладка длиннее окна: снимаем её целиком, вместе с выбором среднего балла.
  await page.setViewport({ width: 1440, height: 1500, deviceScaleFactor: 1.5 });
  await shot('34-admin-scoring', { clip: { x: 0, y: 130, width: 1440, height: 1180 } });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await clickText('.admin-page .seg button', 'Роли и разрешения');
  await clickText('.admin-directory-list button', 'Руководитель');
  await shot('27-admin-roles');
  await clickText('.admin-page .seg button', 'Разделы планирования');
  await page.$eval('button[aria-label^="Свернуть раздел 3"]', (el) => el.click());
  await shot('28-admin-plan');
  await page.$eval('button[aria-label^="Редактировать позицию 1.1 "]', (el) => el.click());
  await page.waitForSelector('[role=dialog]');
  await page.$eval('[role=dialog] .dd-btn', (el) => el.click());
  await page.waitForSelector('[role=dialog] .dd-list');
  await shot('29-admin-plan-dialog', await clipOf('[role=dialog]', 0));
  await page.$eval('[role=dialog] .dd-btn', (el) => el.click());
  await closeDialog();

  // Светлая тема
  await go('/calendar');
  await shot('13-light-calendar', { lightOnly: true });

  // Исполнитель
  await logout();
  await login('sidorov@example.com');
  await shot('14-exec-calendar');
  await go('/planning');
  await shot('15-exec-planning');
  await go('/control');
  await clickText('.task-card', 'Проверить резервные копии');
  await page.waitForSelector('[role=dialog]');
  await shot('16-exec-task');
  await closeDialog();
  await go('/tetris');
  await shot('22-exec-absences');
  await go('/reports');
  if (!page.url().endsWith('/calendar')) problems.push('Исполнитель открыл /reports');
  await logout();
  await login('user@example.com');

  // Адаптивность: нет горизонтальной прокрутки страницы на всех ширинах
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: w < 800 ? 2 : 1 });
    for (const r of ROUTES) {
      await go(r);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) problems.push(`горизонтальная прокрутка ${overflow}px: ${r} при ширине ${w}`);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, a, [role=button]')]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && !el.closest('.cal-grid, .month-grid, .plan-table, .chip, .list, .tl-dl, .tl-bar') && b.height < 30;
          })
          .map((el) => `${el.tagName}.${el.className} «${(el.textContent ?? '').trim().slice(0, 20)}» ${Math.round(el.getBoundingClientRect().height)}px`),
      );
      if (w === 375 && small.length) problems.push(`маленькие тач-зоны на ${r}: ${small.slice(0, 5).join('; ')}`);
    }
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await go('/control');
  await shot('17-mobile-control');
  await go('/calendar');
  await shot('18-mobile-calendar');
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.log('\nЗамечания:');
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exitCode = 1;
} else {
  console.log('\nЗамечаний нет.');
}
