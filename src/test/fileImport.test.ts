// @vitest-environment node
// Перенос данных файлового хранилища в пустую базу: комплект скопировали вручную, базу настроили позже.
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryRepo, type Repo } from '../../server/repo';
import { withFileImport } from '../../server/storage';
import type { Data } from '../../src/lib/types';

const database = (initial: Data | null = null): Repo => ({ ...createMemoryRepo(undefined, initial), kind: 'sqlserver' });
const sample = { tasks: [], users: [{ employeeId: 42 }] } as unknown as Data;

const folder = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tc-import-'));
  const file = path.join(dir, 'db.json');
  writeFileSync(file, JSON.stringify(sample));
  return { dir, file };
};

describe('перенос файлового хранилища в базу', () => {
  it('пустая база получает данные файла, файл остаётся резервной копией', async () => {
    const { dir, file } = folder();
    const repo = withFileImport(database(), file);
    expect(await repo.read()).toEqual(sample);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir)).toEqual([expect.stringMatching(/^db\.imported-\d+\.json$/)]);
    // Повторно не переносится.
    expect(await repo.read()).toEqual(sample);
  });

  it('данные, уже лежащие в базе, не перезаписываются', async () => {
    const { file } = folder();
    const existing = { tasks: [], users: [] } as unknown as Data;
    const repo = withFileImport(database(existing), file);
    expect(await repo.read()).toEqual(existing);
  });

  it('файловое хранилище и отсутствующий файл не затрагиваются', async () => {
    const { file } = folder();
    const fileRepo = createMemoryRepo(file);
    expect(withFileImport(fileRepo, file)).toBe(fileRepo);
    const db = database();
    expect(withFileImport(db, path.join(path.dirname(file), 'missing.json'))).toBe(db);
  });
});
