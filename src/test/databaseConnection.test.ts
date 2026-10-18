// @vitest-environment node
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredStorage, validateDatabaseConnection } from '../../server/databaseConnection';
import { createMemoryRepo } from '../../server/repo';
import { createApi } from '../../server/app';
import { signToken } from '../../server/auth';
import { createSeed } from '../lib/seed';
import { toData } from '../lib/reducer';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tc-connection-test-')); directories.push(root);
  const file = path.join(root, 'connection.json');
  const probe = { version: '17.0.1000', edition: 'Developer Edition', databaseExists: true };
  const inspect = vi.fn().mockResolvedValue(probe);
  const create = vi.fn(() => ({ ...createMemoryRepo(), ping: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }));
  const store = createConfiguredStorage({ MSSQL_SERVER: 'localhost', MSSQL_DATABASE: 'TaskControlDev' }, file, { create, inspect });
  return { file, inspect, create, ...store };
};
const draft = { server: 'localhost', database: 'TaskControlDev', auth: 'windows' as const, username: '', encrypt: true, trustServerCertificate: true };

describe('настройки SQL Server', () => {
  it.each([
    { ...draft, server: 'localhost;password=secret' },
    { ...draft, database: '../other' },
    { ...draft, port: 70000 },
    { ...draft, auth: 'sql', username: '' },
    { ...draft, encrypt: 'false' },
  ])('отклоняет неверные параметры до подключения', value => { expect(() => validateDatabaseConnection(value)).toThrow(); });

  it('проверка не сохраняет настройки и не меняет действующее подключение', async () => {
    const s = setup();
    await s.connection.test({ ...draft, database: 'Other' });
    expect(s.inspect).toHaveBeenCalledWith(expect.objectContaining({ database: 'Other' }));
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(s.connection.get().database).toBe('TaskControlDev');
    expect(existsSync(s.file)).toBe(false);
  });

  it('сохраняет пароль зашифрованным, не возвращает его клиенту и восстанавливает после запуска', async () => {
    const s = setup();
    const value = await s.connection.save({ ...draft, auth: 'sql', username: 'demo', password: 'private-sql-password' });
    expect(value).toMatchObject({ saved: true, hasPassword: true });
    expect(JSON.stringify(value)).not.toContain('private-sql-password');
    expect(readFileSync(s.file, 'utf8')).not.toContain('private-sql-password');
    const restored = createConfiguredStorage({}, s.file, { create: s.create, inspect: s.inspect });
    await restored.connection.test({ ...draft, auth: 'sql', username: 'demo' });
    expect(s.inspect).toHaveBeenLastCalledWith(expect.objectContaining({ password: 'private-sql-password' }));
  });

  it('ошибка проверки сохраняет старый пул и не раскрывает текст драйвера с паролем', async () => {
    const s = setup();
    s.inspect.mockRejectedValue(new Error('private-sql-password from driver'));
    await expect(s.connection.save({ ...draft, database: 'Bad' })).rejects.toThrow('Не удалось подключиться');
    expect(s.connection.get().database).toBe('TaskControlDev');
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(existsSync(s.file)).toBe(false);
  });

  it('не применяет подключение, если не удалось подготовить базу', async () => {
    const s = setup();
    const candidate = { ...createMemoryRepo(), ping: vi.fn().mockRejectedValue(new Error('denied')), close: vi.fn().mockResolvedValue(undefined) };
    s.create.mockReturnValueOnce(candidate);
    await expect(s.connection.save({ ...draft, database: 'Denied' })).rejects.toThrow();
    expect(candidate.close).toHaveBeenCalled();
    expect(s.connection.get().database).toBe('TaskControlDev');
    expect(existsSync(s.file)).toBe(false);
  });

  it('применяет сохранённую базу и закрывает прежнее соединение', async () => {
    const s = setup();
    const old = s.create.mock.results[0].value;
    await s.connection.save({ ...draft, database: 'NewDatabase' });
    expect(old.close).toHaveBeenCalled();
    expect(s.connection.get().database).toBe('NewDatabase');
    expect(JSON.parse(readFileSync(s.file, 'utf8')).database).toBe('NewDatabase');
    await s.repo.read();
  });

  it('API требует сеанс и отдельное разрешение на чтение, проверку и смену базы', async () => {
    const s = setup();
    const repo = createMemoryRepo(undefined, toData(createSeed()));
    const server = createServer(createApi({ repo, connection: s.connection, secret: 'connection-api-test' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const executor = signToken({ email: 'sidorov@example.com', employeeId: 3, role: 'executor' }, 'connection-api-test|windows');
      const admin = signToken({ email: 'user@example.com', employeeId: 1, role: 'administrator' }, 'connection-api-test|windows');
      for (const [url, method] of [['/api/database-connection','GET'], ['/api/database-connection/test','POST'], ['/api/database-connection','POST']]) {
        expect((await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(draft) } : {}) })).status).toBe(403);
        expect((await fetch(base + url, { method, headers: { 'x-tc-token': executor, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(draft) } : {}) })).status).toBe(403);
      }
      expect((await fetch(base + '/api/database-connection', { headers: { 'x-tc-token': admin } })).status).toBe(200);
      const response = await fetch(base + '/api/database-connection/test', { method: 'POST', headers: { 'x-tc-token': admin, 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      expect(await response.json()).toMatchObject({ version: '17.0.1000' });
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
