// Скрипт создания базы данных SQL Server для ручного запуска: scripts/create-database.sql.
// Таблицы берутся из SCHEMA хранилища (server/mssqlRepo.ts), поэтому скрипт не расходится с приложением:
// файл создаётся командой `npm run build:sql`, а тест сверяет его с текущей схемой.
import { SCHEMA } from './mssqlRepo';

export const DATABASE_NAME = 'TaskControl';
export const LOGIN_NAME = 'tc_app';
/** Пока пароль не заменён этой строкой, скрипт учётную запись не создаёт. */
export const PASSWORD_PLACEHOLDER = 'ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ';

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

/** Скрипт целиком: UTF-8 с меткой BOM и переводами строк Windows — так его правильно откроют SSMS и sqlcmd. */
export const databaseScript = (schema: string[] = SCHEMA): string => {
  const head = `-- ============================================================
--  Контроль задач — создание базы данных Microsoft SQL Server
--  (SQL Server 2016 и новее). Файл создаётся командой  npm run build:sql
--  из схемы приложения (server/mssqlRepo.ts) — вручную его лучше не править.
--
--  Что делает скрипт:
--    1. создаёт базу ${DATABASE_NAME}, если её ещё нет;
--    2. создаёт учётную запись SQL Server ${LOGIN_NAME}, под которой работает приложение;
--    3. делает её владельцем базы (db_owner), чтобы приложение могло дополнять таблицы при обновлениях;
--    4. создаёт все таблицы и индексы приложения (префикс tc_).
--  Скрипт можно запускать повторно: существующее не пересоздаётся и не удаляется,
--  пароль уже существующей учётной записи не меняется.
--
--  Как запустить:
--    1. Откройте файл в SQL Server Management Studio под учётной записью с правами
--       sysadmin (или dbcreator и securityadmin). Режим SQLCMD не нужен.
--    2. В разделе «Параметры» ниже замените пароль ${LOGIN_NAME} на свой.
--    3. Выполните скрипт целиком (F5). Либо из командной строки:
--         sqlcmd -S СЕРВЕР -E -C -b -i create-database.sql
--       (пароль при этом тоже заменяется в файле).
--    4. Впишите в раздел appSettings файла web.config приложения (IIS):
--         MSSQL_SERVER   — имя сервера (СЕРВЕР или СЕРВЕР\\ЭКЗЕМПЛЯР)
--         MSSQL_DATABASE — ${DATABASE_NAME}
--         MSSQL_USER     — ${LOGIN_NAME}
--         MSSQL_PASSWORD — пароль из шага 2
--         AUTH_SECRET    — любая длинная случайная строка (ключ подписи сеансов)
--       и публикуйте приложение с ключом /nosql:  deploy-iis.bat /nosql
--       (иначе deploy-iis.bat сам создаст учётную запись и пароль).
--
--  Данные: таблицы создаются пустыми. При первом открытии приложения пустая база
--  заполняется демонстрационными данными (пользователи, подразделения, план, задачи);
--  рабочий состав вносится в «Администрировании».
--
--  Другое имя базы или учётной записи: замените ${DATABASE_NAME} и ${LOGIN_NAME}
--  во всём файле и укажите те же значения в web.config.
-- ============================================================

-- ------------------------------------------------------------
--  Параметры
-- ------------------------------------------------------------
-- Пароль учётной записи ${LOGIN_NAME} задаётся в следующем пакете, в строке
--   DECLARE @password nvarchar(128) = N'${PASSWORD_PLACEHOLDER}';

-- ------------------------------------------------------------
--  1. База данных
-- ------------------------------------------------------------
USE [master];
GO
IF DB_ID(N'${DATABASE_NAME}') IS NULL
BEGIN
  CREATE DATABASE [${DATABASE_NAME}];
  PRINT N'Создана база ${DATABASE_NAME}.';
END
ELSE
  PRINT N'База ${DATABASE_NAME} уже есть.';
GO

-- ------------------------------------------------------------
--  2. Учётная запись приложения
-- ------------------------------------------------------------
DECLARE @password nvarchar(128) = N'${PASSWORD_PLACEHOLDER}';
IF SUSER_ID(N'${LOGIN_NAME}') IS NULL
BEGIN
  IF @password = N'${PASSWORD_PLACEHOLDER}'
  BEGIN
    THROW 50001, N'Задайте пароль учётной записи ${LOGIN_NAME}: замените ${PASSWORD_PLACEHOLDER} в начале раздела 2 и запустите скрипт снова.', 1;
  END
  DECLARE @create nvarchar(max) = N'CREATE LOGIN [${LOGIN_NAME}] WITH PASSWORD = N''' + REPLACE(@password, N'''', N'''''') + N''', CHECK_EXPIRATION = OFF';
  EXEC (@create);
  PRINT N'Создана учётная запись ${LOGIN_NAME}.';
END
ELSE
  PRINT N'Учётная запись ${LOGIN_NAME} уже есть, её пароль не изменён.';
GO

-- ------------------------------------------------------------
--  3. Права в базе
-- ------------------------------------------------------------
USE [${DATABASE_NAME}];
GO
IF SUSER_ID(N'${LOGIN_NAME}') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'${LOGIN_NAME}')
    CREATE USER [${LOGIN_NAME}] FOR LOGIN [${LOGIN_NAME}];
  ALTER ROLE [db_owner] ADD MEMBER [${LOGIN_NAME}];
  PRINT N'${LOGIN_NAME} — владелец базы ${DATABASE_NAME}.';
END
GO

-- ------------------------------------------------------------
--  4. Таблицы и индексы (каждый оператор проверяет, что объекта ещё нет)
-- ------------------------------------------------------------`;

  const body = schema.map((statement) => `${statement.trim()}${LF}GO`).join(`${LF}${LF}`);

  const tail = `-- ------------------------------------------------------------
--  Проверка: должны быть выведены все таблицы приложения
-- ------------------------------------------------------------
SELECT name AS [Таблица] FROM sys.tables WHERE name LIKE N'tc[_]%' ORDER BY name;
GO`;

  const text = [head, body, tail].join(`${LF}${LF}`) + LF;
  // Единые переводы строк Windows, в том числе внутри операторов схемы.
  return `﻿${text.replaceAll(CRLF, LF).replaceAll(LF, CRLF)}`;
};
