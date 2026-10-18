// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('публикация сохраняет рабочее подключение', () => {
  it.each(['web.config', 'admin-settings'])('%s не заменяется настройками установщика', (source) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tc-upgrade-'));
    const config = path.join(dir, 'web.config');
    const xml = `<configuration><appSettings><add key="MSSQL_SERVER" value="${source === 'web.config' ? 'CORP-SQL' : ''}" /><add key="MSSQL_DATABASE" value="WorkingDatabase" /><add key="MSSQL_USER" value="working_login" /><add key="MSSQL_PASSWORD" value="unchanged-test-secret" /><add key="AUTH_SECRET" value="unchanged-session-key" /></appSettings></configuration>`;
    writeFileSync(config, xml);
    const connection = path.join(dir, 'data', 'sqlserver-connection.json');
    if (source === 'admin-settings') {
      mkdirSync(path.dirname(connection));
      writeFileSync(connection, '{"server":"CORP-SQL","database":"WorkingDatabase"}');
    }
    try {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/setup-sql.ps1'), '-Server', 'DO-NOT-CONNECT', '-Database', 'WrongDatabase', '-ConfigPath', config, '-PreserveExisting'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(config, 'utf8')).toBe(xml);
      if (source === 'admin-settings') expect(readFileSync(connection, 'utf8')).toBe('{"server":"CORP-SQL","database":"WorkingDatabase"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
