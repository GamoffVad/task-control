// Автономный пакет для IIS в корпоративной сети без интернета: всё нужное для работы — внутри.
//   npm run build:iis  (или publish-iis.bat) → deploy/out/Plan-IIS/ и deploy/out/Plan-IIS-<версия>.zip
// Пакет переносится на сервер и устанавливается install.bat. Состав:
//   site/                       — содержимое папки сайта (C:\inetpub\wwwroot\Plan)
//     index.html, assets/, …     — сборка интерфейса (dist/)
//     web.config, bin/PlanHost.dll — модуль IIS: прокси /api и запуск сервера API (deploy/iis/PlanHost.cs)
//     App_Data/node/node.exe     — Node.js (копия того, которым выполняется сборка)
//     App_Data/server/           — сервер API одним файлом + драйвер SQL Server с готовым бинарником win32-x64
//   db/schema.sql               — таблицы (тот же текст, что создаёт сервер: SCHEMA из server/mssqlRepo.ts)
//   install.bat, install.ps1, README.txt
import { build } from 'esbuild';
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const outRoot = path.join(root, 'deploy', 'out');
const out = path.join(outRoot, 'Plan-IIS');
const site = path.join(out, 'site');
const server = path.join(site, 'App_Data', 'server');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('Пакет для IIS собирается в Windows x64: в него копируются node.exe и драйвер SQL Server этой платформы.');
  process.exit(1);
}
const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(csc)) {
  console.error(`Не найден компилятор .NET Framework: ${csc}`);
  process.exit(1);
}

execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(server, { recursive: true });

// Интерфейс и настройки IIS.
cpSync(path.join(root, 'dist'), site, { recursive: true });
cpSync(path.join(root, 'deploy', 'iis', 'web.config'), path.join(site, 'web.config'));
mkdirSync(path.join(site, 'bin'), { recursive: true });
execFileSync(csc, ['-nologo', '-target:library', '-optimize+', '-warnaserror+', '-codepage:65001', `-out:${path.join(site, 'bin', 'PlanHost.dll')}`, '-r:System.Web.dll', '-r:System.Configuration.dll', path.join(root, 'deploy', 'iis', 'PlanHost.cs')], { stdio: 'inherit' });

// Сервер API одним файлом; драйвер SQL Server — рядом (у него бинарный модуль, в бандл его не включить).
await build({
  entryPoints: [path.join(root, 'server', 'iis.ts')],
  outfile: path.join(server, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['msnodesqlv8'],
  logLevel: 'warning',
});
const driver = path.join(root, 'node_modules', 'msnodesqlv8');
const driverOut = path.join(server, 'node_modules', 'msnodesqlv8');
for (const item of ['package.json', 'LICENSE', 'lib', path.join('prebuilds', 'win32-x64')]) cpSync(path.join(driver, item), path.join(driverOut, item), { recursive: true });
rmSync(path.join(driverOut, 'lib', 'sequelize'), { recursive: true, force: true });
cpSync(path.join(root, 'node_modules', 'node-gyp-build'), path.join(server, 'node_modules', 'node-gyp-build'), { recursive: true });

// Node.js — тот же, которым собран и проверен пакет.
mkdirSync(path.join(site, 'App_Data', 'node'), { recursive: true });
cpSync(process.execPath, path.join(site, 'App_Data', 'node', 'node.exe'));
mkdirSync(path.join(site, 'App_Data', 'logs'), { recursive: true });

// Схема базы — из server/mssqlRepo.ts, чтобы установщик и сервер создавали одинаковые таблицы.
const schema = readFileSync(path.join(root, 'server', 'mssqlRepo.ts'), 'utf8').match(/export const SCHEMA = `([\s\S]*?)`;/)?.[1];
if (!schema || schema.includes('${')) throw new Error('Не удалось извлечь SCHEMA из server/mssqlRepo.ts');
mkdirSync(path.join(out, 'db'), { recursive: true });
writeFileSync(path.join(out, 'db', 'schema.sql'), `-- Таблицы «Контроля задач» (v${pkg.version}). Выполняет install.ps1; повторный запуск ничего не меняет.\r\n${schema.trim().replaceAll(/\r?\n/g, '\r\n')}\r\n`);

// Установщик. PowerShell 5.1 читает UTF-8 без BOM как ANSI — сценарий записывается с BOM.
const bom = '\uFEFF';
const text = (name) => readFileSync(path.join(root, 'deploy', 'iis', name), 'utf8').replace(/^\uFEFF/, '').replaceAll(/\r?\n/g, '\r\n');
writeFileSync(path.join(out, 'install.ps1'), bom + text('install.ps1'));
writeFileSync(path.join(out, 'install.bat'), text('install.bat'));
writeFileSync(path.join(out, 'README.txt'), bom + text('README.txt'));
writeFileSync(path.join(out, 'VERSION.txt'), `${pkg.version}\r\nNode.js ${process.version}\r\n${new Date().toISOString()}\r\n`);

const zip = path.join(outRoot, `Plan-IIS-${pkg.version}.zip`);
rmSync(zip, { force: true });
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: 'inherit' });
console.log(`Готово: ${path.relative(root, out)} и ${path.relative(root, zip)}`);
