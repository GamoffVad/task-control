// Сборка документации: сборка приложения → скриншоты и дымовая проверка → PDF.
// Запуск: npm run docs (без пересъёмки: node docs/build-docs.mjs --no-shots)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const skipShots = process.argv.includes('--no-shots');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// Число тестов берётся из фактического прогона, чтобы документация не расходилась с проектом.
const report = path.join(docs, '.vitest.json');
execSync(`npx vitest run --reporter=json --outputFile="${report}"`, { cwd: root, stdio: 'ignore' });
const { numPassedTests, numFailedTests, numPendingTests, numTotalTests } = JSON.parse(readFileSync(report, 'utf8'));
rmSync(report);
// Тесты хранилища SQL Server пропускаются без настроенного сервера, поэтому считаем именно провалы.
if (numFailedTests) throw new Error(`Тесты не прошли: ${numFailedTests} из ${numTotalTests}`);
if (numPendingTests) console.log(`Пропущено тестов: ${numPendingTests} (нужен SQL Server — npm run test:mssql)`);

if (!skipShots) {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  execSync('node docs/shoot.mjs', { cwd: root, stdio: 'inherit' });
}

let figure = 0;
const html = readFileSync(path.join(docs, 'manual.html'), 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{TESTS}}', String(numPassedTests))
  // Рисунки нумеруются по порядку при сборке — вставка новой главы не сбивает номера.
  .replace(/<span class="num">Рис\.[^<]*<\/span>/g, () => `<span class="num">Рис. ${++figure}</span>`)
  // PDF свёрстан на светлой бумаге — в него идут скриншоты светлой темы (name.light.png), если они есть.
  .replace(/src="shots\/([^"]+)\.png"/g, (m, name) => (existsSync(path.join(docs, 'shots', `${name}.light.png`)) ? `src="shots/${name}.light.png"` : m));
const tmp = path.join(docs, '.manual.render.html');
writeFileSync(tmp, html);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(docs, `Контроль-задач-руководство-v${version}.pdf`);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#5D6575;padding:0 17mm;display:flex;justify-content:space-between">
      <span>Контроль задач ${version} · Возможности и руководство пользователя</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  console.log('PDF:', out, `(тестов: ${numPassedTests})`);
  // Раздел «Информация»: PDF для скачивания и сведения о сборке документации.
  const pub = path.join(root, 'public', 'manual');
  mkdirSync(pub, { recursive: true });
  // Прежние PDF руководства убираем; PDF инструкции по IIS (его кладёт docs/build-iis-guide.mjs) остаётся.
  for (const f of readdirSync(pub)) if (!f.startsWith('Kontrol-zadach-IIS-')) rmSync(path.join(pub, f));
  const pdfName = `Kontrol-zadach-rukovodstvo-v${version}.pdf`;
  const previousMeta = existsSync(path.join(docs, 'manual.meta.json')) ? JSON.parse(readFileSync(path.join(docs, 'manual.meta.json'), 'utf8')) : {};
  copyFileSync(out, path.join(pub, pdfName));
  writeFileSync(path.join(docs, 'manual.meta.json'), JSON.stringify({ version, tests: numPassedTests, pdf: `/manual/${pdfName}`, ...(previousMeta.iisPdf ? { iisPdf: previousMeta.iisPdf } : {}) }, null, 2) + String.fromCharCode(10));
} finally {
  await browser.close();
  rmSync(tmp);
}
