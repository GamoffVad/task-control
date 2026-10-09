// Демонстрационная сборка для Vercel (Build Output API v3): только статика, без сервера и базы данных.
//   npm run build:vercel → npm run deploy
// Интерфейс собирается в локальном режиме (VITE_BACKEND=local): тестовые данные создаются в браузере посетителя
// и хранятся в его localStorage. Рабочая версия — IIS и SQL Server (npm run build:iis) — не затрагивается.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');

execSync('npm run build', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_BACKEND: 'local' } });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'dist'), path.join(out, 'static'), { recursive: true });

writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        // Service Worker уведомлений: всегда свежая версия, область действия — весь сайт.
        { src: '^/sw[.]js$', headers: { 'cache-control': 'no-cache', 'service-worker-allowed': '/' }, continue: true },
        { handle: 'filesystem' },
        // Сервера нет: адреса API в демо не существуют, остальное — страницы одностраничного приложения.
        { src: '^/api/(.*)$', status: 404, dest: '/404.json' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
writeFileSync(path.join(out, 'static', '404.json'), JSON.stringify({ error: 'Демонстрационная версия работает без сервера.' }));
console.log(`Готово: ${path.relative(root, out)} (статика, локальный режим с тестовыми данными)`);
