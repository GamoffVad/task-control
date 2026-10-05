// Готовый архив для публикации в IIS: сборка dist-iis + deploy-iis.bat + инструкция.
//   npm run pack:iis → release/task-control-iis-<версия>.zip
// Папка dist-iis в GitHub не хранится (это результат сборки), поэтому сотруднику, у которого
// нет интернета и исходников, достаточно перенести этот архив на носителе и запустить deploy-iis.bat.
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `task-control-iis-${version}`;
const release = path.join(root, 'release');
const stage = path.join(release, name);
const zip = path.join(release, `${name}.zip`);

if (process.platform !== 'win32') {
  throw new Error('Архив для IIS собирается на Windows: используется Compress-Archive.');
}

execSync('npm run build:iis', { cwd: root, stdio: 'inherit' });

rmSync(release, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(path.join(root, 'dist-iis'), path.join(stage, 'dist-iis'), { recursive: true });
copyFileSync(path.join(root, 'deploy-iis.bat'), path.join(stage, 'deploy-iis.bat'));
// Публикация с другого компьютера сети и скрипт базы данных — в тех же папках, что и в репозитории.
copyFileSync(path.join(root, 'deploy-iis-remote.bat'), path.join(stage, 'deploy-iis-remote.bat'));
mkdirSync(path.join(stage, 'scripts'), { recursive: true });
for (const file of ['deploy-remote.ps1', 'create-database.sql']) copyFileSync(path.join(root, 'scripts', file), path.join(stage, 'scripts', file));
copyFileSync(path.join(root, 'docs', 'corporate-offline.md'), path.join(stage, 'corporate-offline.md'));
// Папка для установщиков: deploy-iis.bat ставит из неё Node.js, URL Rewrite и iisnode, если их нет на сервере.
// Сами установщики в архив не входят (это чужие программы со своими лицензиями) — их кладут сюда перед переносом.
mkdirSync(path.join(stage, 'installers'), { recursive: true });
writeFileSync(
  path.join(stage, 'installers', 'README.txt'),
  String.fromCharCode(0xfeff) +
    [
      'Положите сюда установщики (скачиваются на компьютере с интернетом):',
      '  node-vВЕРСИЯ-x64.msi           — Node.js 18 или новее, https://nodejs.org',
      '  rewrite_amd64_ru-RU.msi        — URL Rewrite, https://www.iis.net/downloads/microsoft/url-rewrite',
      '  iisnode-full-v0.2.26-x64.msi   — iisnode, https://github.com/Azure/iisnode/releases',
      '',
      'deploy-iis.bat установит то, чего нет на сервере. Уже установленное не трогается.',
    ].join(String.fromCharCode(13, 10)),
);
// PDF-инструкция по публикации (docs/build-iis-guide.mjs), если она собрана для этой версии.
const guide = path.join(root, 'docs', `Контроль-задач-инструкция-IIS-v${version}.pdf`);
// В архиве имя латиницей: Compress-Archive кладёт кириллические имена в кодировке консоли, и сторонние архиваторы их искажают.
if (existsSync(guide)) copyFileSync(guide, path.join(stage, `IIS-guide-v${version}.pdf`));

// Короткая памятка в корне архива. Сервер без интернета: всё нужное привозится заранее, на носителе.
const steps = [
  `Контроль задач ${version} — готовый комплект для публикации в IIS (интернет на сервере не нужен)`,
  '',
  'Публикация — один файл deploy-iis.bat на сервере. Он сам ставит недостающее, создаёт сайт, базу',
  'и настраивает вход через Windows. Собирать ничего не нужно: dist-iis уже собран.',
  '',
  '1. Если на сервере ещё нет Node.js, URL Rewrite или iisnode — положите их установщики .msi в папку',
  '   installers (список и ссылки — installers\\README.txt). Роли Windows Server (IIS, проверка',
  '   подлинности Windows, модуль Active Directory) батник ставит сам из состава системы.',
  '2. В первых строках deploy-iis.bat проверьте IP, PORT и SQLSERVER (имя вашего SQL Server).',
  '3. Запустите deploy-iis.bat от имени администратора.',
  '4. Откройте http://<адрес>:<порт>/api/health — должно быть {"ok":true,"storage":"sqlserver"}.',
  '5. Способ входа (форма или Windows) переключается в приложении: Администрирование > Аутентификация.',
  '',
  'Публикация с другого компьютера сети (на сервере запускать ничего не нужно):',
  '   deploy-iis-remote.bat -Server ИМЯ_СЕРВЕРА            (проверка сервера: добавьте -Check)',
  '   Нужны права администратора на сервере и включённый WinRM (Enable-PSRemoting -Force).',
  '',
  'База данных вручную: scripts\\create-database.sql — выполните в SQL Server Management Studio',
  '(перед этим замените пароль в разделе 2), затем публикуйте с ключом /nosql.',
  '',
  'Подробная инструкция — corporate-offline.md в этом архиве.',
];
writeFileSync(path.join(stage, 'README.txt'), String.fromCharCode(0xfeff) + steps.join(String.fromCharCode(13, 10)));

// Compress-Archive кладёт в архив папку целиком, поэтому при распаковке получается task-control-iis-<версия>\.
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force"`, { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });

if (!existsSync(zip)) throw new Error('Архив не создан.');
console.log(`Готово: ${path.relative(root, zip)} (${(statSync(zip).size / 1024 / 1024).toFixed(1)} МБ)`);
