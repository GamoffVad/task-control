// Скрипт создания базы данных SQL Server: scripts/create-database.sql.
//   npm run build:sql — пересоздаёт файл из схемы приложения (server/mssqlRepo.ts).
// Файл хранится в репозитории и кладётся в архив для IIS (npm run pack:iis); тест следит, чтобы он не отставал от схемы.
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'node_modules', '.tmp');
const bundle = path.join(tmp, 'database-script.mjs');
mkdirSync(tmp, { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'databaseScript.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['mssql', 'pg-native'],
  logLevel: 'warning',
});

const { databaseScript } = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
const out = path.join(root, 'scripts', 'create-database.sql');
writeFileSync(out, databaseScript(), 'utf8');
rmSync(bundle);
console.log(`Готово: ${path.relative(root, out)}`);
