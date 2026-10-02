// Скрипт создания базы данных SQL Server (scripts/create-database.sql) строится из схемы приложения.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseScript, DATABASE_NAME, LOGIN_NAME, PASSWORD_PLACEHOLDER } from '../../server/databaseScript';
import { SCHEMA } from '../../server/mssqlRepo';

describe('скрипт создания базы данных', () => {
  const text = databaseScript();

  it('лежит в репозитории и не отстаёт от схемы (npm run build:sql)', () => {
    const file = readFileSync(path.resolve(process.cwd(), 'scripts', 'create-database.sql'), 'utf8');
    expect(file).toBe(text);
  });

  it('содержит каждый оператор схемы отдельным пакетом', () => {
    const batches = text.split(/^GO\r?$/m);
    for (const statement of SCHEMA) {
      const wanted = statement.trim().replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
      expect(batches.some((batch) => batch.includes(wanted)), wanted.slice(0, 60)).toBe(true);
    }
  });

  it('создаёт базу, учётную запись и права, а пароль-заглушку не принимает', () => {
    expect(text).toContain(`CREATE DATABASE [${DATABASE_NAME}]`);
    expect(text).toContain(`CREATE LOGIN [${LOGIN_NAME}]`);
    expect(text).toContain(`ALTER ROLE [db_owner] ADD MEMBER [${LOGIN_NAME}]`);
    expect(text).toMatch(new RegExp(`IF @password = N'${PASSWORD_PLACEHOLDER}'[\\s\\S]*THROW`));
    // Файл безопасно запускать повторно: все объекты создаются только при отсутствии.
    expect(text).toContain('IF DB_ID(');
    expect(text).toContain('IF SUSER_ID(');
  });

  it('в кодировке и с переводами строк, которые понимают SSMS и sqlcmd', () => {
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).not.toMatch(/[^\r]\n/);
    // Все таблицы приложения перечислены в схеме.
    for (const table of ['tc_tasks', 'tc_users', 'tc_roles', 'tc_notices', 'tc_meta']) expect(text).toContain(`dbo.${table}`);
  });
});
