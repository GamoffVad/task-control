// Сборка комплекта для публикации в IIS (iisnode): dist-iis/ со статикой, сервером и web.config.
//   npm run build:iis → deploy-iis.bat копирует папку в C:\inetpub\wwwroot\PLAN
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-iis');

execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'dist'), path.join(out, 'public'), { recursive: true });

// Скрипт подготовки SQL Server кладётся рядом с сервером: на сервере может не быть папки проекта.
cpSync(path.join(root, 'scripts', 'setup-sql.ps1'), path.join(out, 'setup-sql.ps1'));
// Запуск пула под учётной записью публикующего (deploy-iis.bat берёт его отсюда, если рядом нет папки scripts).
cpSync(path.join(root, 'scripts', 'set-pool-identity.ps1'), path.join(out, 'set-pool-identity.ps1'));

await build({
  entryPoints: [path.join(root, 'server', 'iis.ts')],
  outfile: path.join(out, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  // Драйвер ODBC для входа в SQL Server учётной записью Windows — двоичный модуль, в server.cjs не собирается.
  external: ['msnodesqlv8'],
  logLevel: 'warning',
});

// Двоичный модуль msnodesqlv8 (Node-API, подходит для Node.js 18 и новее) и его загрузчик — рядом с сервером.
// Берётся только сборка для Windows x64: на сервере IIS другой не нужно.
const modules = path.join(out, 'node_modules');
const driver = path.join(root, 'node_modules', 'msnodesqlv8');
for (const item of ['package.json', 'LICENSE', 'lib', path.join('prebuilds', 'win32-x64')]) {
  cpSync(path.join(driver, item), path.join(modules, 'msnodesqlv8', item), { recursive: true });
}
cpSync(path.join(root, 'node_modules', 'node-gyp-build'), path.join(modules, 'node-gyp-build'), { recursive: true });

// Настройки из appSettings iisnode передаёт процессу Node.js как переменные окружения.
writeFileSync(
  path.join(out, 'web.config'),
  `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <!-- Доверие заголовкам IIS обязательно: без него бесшовный Windows-вход не работает. -->
    <add key="WINDOWS_AUTH_TRUST_PROXY" value="true" />
    <!-- Доменного пользователя передаёт iisnode (promoteServerVars ниже); другим заголовкам приложение не верит. -->
    <add key="WINDOWS_AUTH_HEADER" value="x-iisnode-logon_user" />
    <!-- Общий секрет прокси. Заполняется, если запросы к Node.js может слать кто-то кроме IIS. -->
    <add key="WINDOWS_AUTH_PROXY_SECRET" value="" />
    <!-- Учётная запись Windows, которая станет администратором, если в базе нет ни одного. deploy-iis.bat записывает сюда публикующего. -->
    <add key="TC_ADMIN_LOGIN" value="" />
    <!-- Ключ подписи сеансов. Заменить на длинную случайную строку. -->
    <add key="AUTH_SECRET" value="" />
    <!-- SQL Server: имя сервера или СЕРВЕР\\ЭКЗЕМПЛЯР. База и таблицы создаются при первом запуске. -->
    <add key="MSSQL_SERVER" value="" />
    <add key="MSSQL_DATABASE" value="TaskControl" />
    <!-- Пустые MSSQL_USER и MSSQL_PASSWORD — вход Windows учётной записью пула IIS, без пароля (так настраивает deploy-iis.bat).
         Заполненные — учётная запись SQL Server; для доменной учётной записи с паролем — ещё MSSQL_DOMAIN. -->
    <add key="MSSQL_USER" value="" />
    <add key="MSSQL_PASSWORD" value="" />
    <add key="MSSQL_DOMAIN" value="" />
    <!-- Выпадающий список ФИО из Active Directory (нужен модуль RSAT-AD-PowerShell; deploy-iis.bat ставит его и включает поиск). -->
    <add key="AD_SEARCH_ENABLED" value="false" />
    <add key="AD_SEARCH_BASE" value="" />
  </appSettings>
  <system.webServer>
    <handlers>
      <add name="iisnode" path="server.cjs" verb="*" modules="iisnode" />
    </handlers>
    <rewrite>
      <rules>
        <rule name="Статика и API — в приложение Node.js">
          <match url=".*" />
          <action type="Rewrite" url="server.cjs" />
        </rule>
      </rules>
    </rewrite>
    <security>
      <requestFiltering>
        <hiddenSegments>
          <add segment="node_modules" />
          <add segment="iisnode" />
          <add segment="data" />
        </hiddenSegments>
      </requestFiltering>
    </security>
    <httpErrors existingResponse="PassThrough" />
    <!-- promoteServerVars: доменный пользователь, подтверждённый IIS, приходит в заголовках x-iisnode-logon_user и x-iisnode-auth_user. -->
    <iisnode nodeProcessCountPerApplication="1" loggingEnabled="true" devErrorsEnabled="false" watchedFiles="web.config;*.cjs" promoteServerVars="LOGON_USER,AUTH_USER" />
  </system.webServer>
</configuration>
`,
);

// Имя латиницей: кириллица в именах файлов портится в архивах, собранных Windows PowerShell 5.1.
const readme = [
  'Комплект публикации «Контроль задач» для IIS.',
  '',
  'Состав: server.cjs — сервер приложения, public\\ — интерфейс, web.config — настройки IIS,',
  'setup-sql.ps1 — подготовка SQL Server, data\\ — файловое хранилище.',
  '',
  'Публикация: запустить deploy-iis.bat от имени администратора. Он копирует этот комплект в IIS,',
  'создаёт сайт, пул и Windows-аутентификацию, заводит учётную запись и базу SQL Server.',
  '',
  'Настройки правятся в разделе appSettings файла web.config; после правки IIS перезапускает приложение сам.',
  'Способ входа (форма или Windows) переключается в приложении: Администрирование > Аутентификация.',
  'Порядок развёртывания и настройка Windows-входа: corporate-offline.md (в архиве релиза) или docs\\corporate-offline.md.',
].join(String.fromCharCode(13, 10));
// BOM нужен, чтобы Блокнот показал кириллицу правильно.
// Версия комплекта: deploy-iis.bat показывает её до и после копирования и проверяет, что файлы обновились.
writeFileSync(path.join(out, 'version.txt'), JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version);
writeFileSync(path.join(out, 'README.txt'), String.fromCharCode(0xfeff) + readme);

console.log(`Готово: ${path.relative(root, out)}`);
