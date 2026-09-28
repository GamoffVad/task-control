// Сборка комплекта для публикации в IIS (iisnode): dist-iis/ со статикой, сервером и web.config.
//   npm run build:iis → deploy-iis.bat копирует папку в C:\inetpub\wwwroot\PLAN
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-iis');

execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'data'), { recursive: true });
cpSync(path.join(root, 'dist'), path.join(out, 'public'), { recursive: true });

// Скрипт подготовки SQL Server кладётся рядом с сервером: на сервере может не быть папки проекта.
cpSync(path.join(root, 'scripts', 'setup-sql.ps1'), path.join(out, 'setup-sql.ps1'));

await build({
  entryPoints: [path.join(root, 'server', 'iis.ts')],
  outfile: path.join(out, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['pg-native'],
  logLevel: 'warning',
});

// Настройки из appSettings iisnode передаёт процессу Node.js как переменные окружения.
writeFileSync(
  path.join(out, 'web.config'),
  `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <!-- Доверие заголовкам IIS обязательно: без него бесшовный Windows-вход не работает. -->
    <add key="WINDOWS_AUTH_TRUST_PROXY" value="true" />
    <!-- Общий секрет прокси. Заполняется, если запросы к Node.js может слать кто-то кроме IIS. -->
    <add key="WINDOWS_AUTH_PROXY_SECRET" value="" />
    <!-- Ключ подписи сеансов. Заменить на длинную случайную строку. -->
    <add key="AUTH_SECRET" value="" />
    <!-- SQL Server: имя сервера или СЕРВЕР\\ЭКЗЕМПЛЯР. База и таблицы создаются при первом запуске. -->
    <add key="MSSQL_SERVER" value="" />
    <add key="MSSQL_DATABASE" value="TaskControl" />
    <!-- Учётная запись SQL Server. Для доменной учётной записи заполните ещё MSSQL_DOMAIN. -->
    <add key="MSSQL_USER" value="" />
    <add key="MSSQL_PASSWORD" value="" />
    <add key="MSSQL_DOMAIN" value="" />
    <!-- Строка подключения к PostgreSQL. Используется, только если MSSQL_SERVER пуст. -->
    <add key="DATABASE_URL" value="" />
    <!-- Выпадающий список ФИО из Active Directory. -->
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
    <iisnode nodeProcessCountPerApplication="1" loggingEnabled="true" devErrorsEnabled="false" watchedFiles="web.config;*.cjs" />
  </system.webServer>
</configuration>
`,
);

writeFileSync(
  path.join(out, 'ЧИТАТЬ.txt'),
  [
    'Комплект публикации «Контроль задач» для IIS.',
    '',
    'Состав: server.cjs — сервер приложения, public\\ — интерфейс, web.config — настройки IIS, data\\ — файловое хранилище.',
    'Хранилище: задайте MSSQL_SERVER — база и таблицы в SQL Server создадутся сами при первом запуске.',
    'Настройки правятся в разделе appSettings файла web.config; после правки IIS перезапускает приложение сам.',
    'Порядок развёртывания и настройка Windows-входа: docs\\corporate-offline.md.',
  ].join('\r\n'),
);

console.log(`Готово: ${path.relative(root, out)}`);
