// Сборка для Vercel (Build Output API v3): статика из dist/ и функции API в .vercel/output/.
//   npm run build:vercel → vercel deploy --prebuilt --prod
// Каждый адрес API — отдельная функция с одним и тем же бандлом server/vercel.ts,
// поэтому маршрутизация не зависит от перезаписи адресов.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const ROUTES = ['login', 'windows-login', 'authentication', 'directory-users', 'state', 'action', 'health', 'notices', 'windows-check'];

execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'dist'), path.join(out, 'static'), { recursive: true });

const bundle = path.join(root, 'node_modules', '.tmp', 'api-bundle.cjs');
await build({
  entryPoints: [path.join(root, 'server', 'vercel.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg-native'],
  // Обработчик — module.exports, как ожидает среда Node.js на Vercel.
  footer: { js: 'module.exports = module.exports.default;' },
  logLevel: 'warning',
});

for (const r of ROUTES) {
  const dir = path.join(out, 'functions', 'api', `${r}.func`);
  mkdirSync(dir, { recursive: true });
  cpSync(bundle, path.join(dir, 'index.cjs'));
  writeFileSync(
    path.join(dir, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.cjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
  );
}

writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        // Service Worker уведомлений (нажатие открывает раздел): всегда свежая версия, область действия — весь сайт.
        { src: '^/sw[.]js$', headers: { 'cache-control': 'no-cache', 'service-worker-allowed': '/' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/api/(.*)$', status: 404, dest: '/404.json' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
writeFileSync(path.join(out, 'static', '404.json'), JSON.stringify({ error: 'Нет такого адреса API.' }));
console.log(`Готово: ${path.relative(root, out)} (функции: ${ROUTES.map((r) => `/api/${r}`).join(', ')})`);
