// Публикация готовой сборки на Vercel: npm run deploy (после npm run build:vercel).
//
// Зачем копия: с тех пор как проект стал репозиторием Git, CLI передаёт Vercel автора последнего коммита.
// На тарифе Hobby развёртывание от имени участника, не связанного с учётной записью Vercel
// (например, адрес вида 1234+Имя@users.noreply.github.com), отклоняется с ответом «Not authorized».
// Поэтому выкладываем из каталога без .git — метаданные коммита не отправляются.
// Другой способ — связать учётную запись GitHub с Vercel в настройках аутентификации.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '.vercel');
if (!existsSync(path.join(source, 'output'))) {
  console.error('Нет сборки: сначала выполните npm run build:vercel');
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), 'task-control-deploy-'));
try {
  cpSync(source, path.join(dir, '.vercel'), { recursive: true });
  const args = process.argv.slice(2).join(' ');
  execSync(`vercel deploy --prebuilt --prod --yes ${args}`.trim(), { cwd: dir, stdio: 'inherit', shell: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
