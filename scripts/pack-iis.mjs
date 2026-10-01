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
copyFileSync(path.join(root, 'docs', 'corporate-offline.md'), path.join(stage, 'corporate-offline.md'));

// Короткая памятка в корне архива. Сервер без интернета: всё нужное привозится заранее, на носителе.
const steps = [
  `Контроль задач ${version} — готовый комплект для публикации в IIS (интернет на сервере не нужен)`,
  '',
  'Привезти на сервер заранее, на съёмном носителе (скачиваются на компьютере с интернетом):',
  '  - Node.js 18 или новее для Windows (установщик .msi) — https://nodejs.org',
  '  - модуль IIS iisnode (.msi) — https://github.com/Azure/iisnode/releases',
  '  - модуль IIS URL Rewrite (.msi) — https://www.iis.net/downloads/microsoft/url-rewrite',
  'Роль «Веб-сервер IIS» ставится из компонентов Windows. Собирать ничего не нужно: dist-iis уже собран.',
  '',
  '1. В первых строках deploy-iis.bat проверьте IP, PORT и SQLSERVER (имя вашего SQL Server).',
  '2. Запустите deploy-iis.bat от имени администратора. Файл сам поймёт, что исходников проекта нет,',
  '   и возьмёт готовую папку dist-iis; ключ /nobuild указывать не обязательно.',
  '3. Откройте http://<адрес>:<порт>/api/health — должно быть {"ok":true,"storage":"sqlserver"}.',
  '',
  'Подробная инструкция — corporate-offline.md в этом архиве.',
];
writeFileSync(path.join(stage, 'README.txt'), String.fromCharCode(0xfeff) + steps.join(String.fromCharCode(13, 10)));

// Compress-Archive кладёт в архив папку целиком, поэтому при распаковке получается task-control-iis-<версия>\.
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force"`, { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });

if (!existsSync(zip)) throw new Error('Архив не создан.');
console.log(`Готово: ${path.relative(root, zip)} (${(statSync(zip).size / 1024 / 1024).toFixed(1)} МБ)`);
