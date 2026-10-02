-- ============================================================
--  Контроль задач — создание базы данных Microsoft SQL Server
--  (SQL Server 2016 и новее). Файл создаётся командой  npm run build:sql
--  из схемы приложения (server/mssqlRepo.ts) — вручную его лучше не править.
--
--  Что делает скрипт:
--    1. создаёт базу TaskControl, если её ещё нет;
--    2. создаёт учётную запись SQL Server tc_app, под которой работает приложение;
--    3. делает её владельцем базы (db_owner), чтобы приложение могло дополнять таблицы при обновлениях;
--    4. создаёт все таблицы и индексы приложения (префикс tc_).
--  Скрипт можно запускать повторно: существующее не пересоздаётся и не удаляется,
--  пароль уже существующей учётной записи не меняется.
--
--  Как запустить:
--    1. Откройте файл в SQL Server Management Studio под учётной записью с правами
--       sysadmin (или dbcreator и securityadmin). Режим SQLCMD не нужен.
--    2. В разделе «Параметры» ниже замените пароль tc_app на свой.
--    3. Выполните скрипт целиком (F5). Либо из командной строки:
--         sqlcmd -S СЕРВЕР -E -C -b -i create-database.sql
--       (пароль при этом тоже заменяется в файле).
--    4. Впишите в раздел appSettings файла web.config приложения (IIS):
--         MSSQL_SERVER   — имя сервера (СЕРВЕР или СЕРВЕР\ЭКЗЕМПЛЯР)
--         MSSQL_DATABASE — TaskControl
--         MSSQL_USER     — tc_app
--         MSSQL_PASSWORD — пароль из шага 2
--         AUTH_SECRET    — любая длинная случайная строка (ключ подписи сеансов)
--       и публикуйте приложение с ключом /nosql:  deploy-iis.bat /nosql
--       (иначе deploy-iis.bat сам создаст учётную запись и пароль).
--
--  Данные: таблицы создаются пустыми. При первом открытии приложения пустая база
--  заполняется демонстрационными данными (пользователи, подразделения, план, задачи);
--  рабочий состав вносится в «Администрировании».
--
--  Другое имя базы или учётной записи: замените TaskControl и tc_app
--  во всём файле и укажите те же значения в web.config.
-- ============================================================

-- ------------------------------------------------------------
--  Параметры
-- ------------------------------------------------------------
-- Пароль учётной записи tc_app задаётся в следующем пакете, в строке
--   DECLARE @password nvarchar(128) = N'ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ';

-- ------------------------------------------------------------
--  1. База данных
-- ------------------------------------------------------------
USE [master];
GO
IF DB_ID(N'TaskControl') IS NULL
BEGIN
  CREATE DATABASE [TaskControl];
  PRINT N'Создана база TaskControl.';
END
ELSE
  PRINT N'База TaskControl уже есть.';
GO

-- ------------------------------------------------------------
--  2. Учётная запись приложения
-- ------------------------------------------------------------
DECLARE @password nvarchar(128) = N'ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ';
IF SUSER_ID(N'tc_app') IS NULL
BEGIN
  IF @password = N'ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ'
  BEGIN
    THROW 50001, N'Задайте пароль учётной записи tc_app: замените ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ в начале раздела 2 и запустите скрипт снова.', 1;
  END
  DECLARE @create nvarchar(max) = N'CREATE LOGIN [tc_app] WITH PASSWORD = N''' + REPLACE(@password, N'''', N'''''') + N''', CHECK_EXPIRATION = OFF';
  EXEC (@create);
  PRINT N'Создана учётная запись tc_app.';
END
ELSE
  PRINT N'Учётная запись tc_app уже есть, её пароль не изменён.';
GO

-- ------------------------------------------------------------
--  3. Права в базе
-- ------------------------------------------------------------
USE [TaskControl];
GO
IF SUSER_ID(N'tc_app') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'tc_app')
    CREATE USER [tc_app] FOR LOGIN [tc_app];
  ALTER ROLE [db_owner] ADD MEMBER [tc_app];
  PRINT N'tc_app — владелец базы TaskControl.';
END
GO

-- ------------------------------------------------------------
--  4. Таблицы и индексы (каждый оператор проверяет, что объекта ещё нет)
-- ------------------------------------------------------------

if object_id(N'dbo.tc_meta', N'U') is null create table dbo.tc_meta ([key] nvarchar(64) not null primary key, [value] nvarchar(max) not null)
GO

if object_id(N'dbo.tc_tasks', N'U') is null create table dbo.tc_tasks (
    [id] nvarchar(64) not null primary key,
    [seq] bigint identity(1,1) not null,
    [title] nvarchar(max) not null,
    [row_id] nvarchar(64) null,
    [category] nvarchar(64) null,
    [assignee_ids] nvarchar(max) not null,
    [start_at] datetimeoffset(3) not null,
    [end_at] datetimeoffset(3) not null,
    [doc_name] nvarchar(max) not null constraint df_tc_tasks_doc_name default '',
    [doc_number] nvarchar(max) not null constraint df_tc_tasks_doc_number default '',
    [result] nvarchar(max) not null constraint df_tc_tasks_result default '',
    [done] bit not null constraint df_tc_tasks_done default 0,
    [score] decimal(10,2) null,
    [done_at] datetimeoffset(3) null)
GO

if object_id(N'dbo.tc_absences', N'U') is null create table dbo.tc_absences (
    [id] nvarchar(64) not null primary key,
    [employee_id] int not null,
    [type] nvarchar(16) not null constraint ck_tc_absences_type check ([type] in ('vacation','trip','dayoff','sick','study')),
    [date_from] char(10) not null,
    [date_to] char(10) null,
    [status] nvarchar(16) not null constraint ck_tc_absences_status check ([status] in ('request','approved','rejected')),
    [note] nvarchar(max) not null constraint df_tc_absences_note default '',
    [decided_by] int null,
    [created_at] datetimeoffset(3) not null)
GO

if not exists (select 1 from sys.indexes where name = 'tc_absences_employee' and object_id = object_id(N'dbo.tc_absences'))
     create index tc_absences_employee on dbo.tc_absences ([employee_id], [date_from])
GO

if object_id(N'dbo.tc_entitlements', N'U') is null create table dbo.tc_entitlements (
    [employee_id] int not null,
    [year] int not null,
    [vacation_days] int not null,
    [carried_over] int not null constraint df_tc_entitlements_carried default 0,
    [dayoff_accrued] int not null constraint df_tc_entitlements_dayoff default 0,
    constraint pk_tc_entitlements primary key ([employee_id], [year]))
GO

if object_id(N'dbo.tc_reports', N'U') is null create table dbo.tc_reports ([week_start] char(10) not null primary key, [submitted_at] datetimeoffset(3) not null, [entries] nvarchar(max) not null)
GO

if object_id(N'dbo.tc_messages', N'U') is null create table dbo.tc_messages ([id] nvarchar(64) not null primary key, [author_id] int not null, [text] nvarchar(max) not null, [sent_at] datetimeoffset(3) not null)
GO

if object_id(N'dbo.tc_dictionaries', N'U') is null create table dbo.tc_dictionaries ([id] nvarchar(64) not null primary key, [dictionary] nvarchar(64) not null, [code] nvarchar(64) not null, [title] nvarchar(256) not null, [color] nvarchar(32) null)
GO

if not exists (select 1 from sys.indexes where name = 'tc_dictionaries_kind_code' and object_id = object_id(N'dbo.tc_dictionaries'))
     create unique index tc_dictionaries_kind_code on dbo.tc_dictionaries ([dictionary], [code])
GO

if col_length('dbo.tc_dictionaries', 'color') is null alter table dbo.tc_dictionaries add [color] nvarchar(32) null
GO

if object_id(N'dbo.tc_plan_rows', N'U') is null create table dbo.tc_plan_rows ([id] nvarchar(64) not null primary key, [title] nvarchar(max) not null, [is_header] bit not null constraint df_tc_plan_rows_header default 0, [base_score] decimal(10,2) not null constraint df_tc_plan_rows_score default 0)
GO

if object_id(N'dbo.tc_users', N'U') is null create table dbo.tc_users (
    [employee_id] int not null primary key,
    [email] nvarchar(256) not null constraint uq_tc_users_email unique,
    [role] nvarchar(32) not null,
    [active] bit not null constraint df_tc_users_active default 1,
    [windows_login] nvarchar(128) not null constraint df_tc_users_login default '',
    [full_name] nvarchar(256) not null constraint df_tc_users_full_name default '',
    [position] nvarchar(256) not null constraint df_tc_users_position default '',
    [unit_id] nvarchar(64) null)
GO

if col_length('dbo.tc_users', 'windows_login') is null alter table dbo.tc_users add [windows_login] nvarchar(128) not null constraint df_tc_users_login default ''
GO

if col_length('dbo.tc_users', 'full_name') is null alter table dbo.tc_users add [full_name] nvarchar(256) not null constraint df_tc_users_full_name default ''
GO

if col_length('dbo.tc_users', 'position') is null alter table dbo.tc_users add [position] nvarchar(256) not null constraint df_tc_users_position default ''
GO

if col_length('dbo.tc_users', 'unit_id') is null alter table dbo.tc_users add [unit_id] nvarchar(64) null
GO

set quoted_identifier on;
   if not exists (select 1 from sys.indexes where name = 'tc_users_windows_login' and object_id = object_id(N'dbo.tc_users'))
     create unique index tc_users_windows_login on dbo.tc_users ([windows_login]) where [windows_login] <> ''
GO

if object_id(N'dbo.tc_units', N'U') is null create table dbo.tc_units ([id] nvarchar(64) not null primary key, [parent_id] nvarchar(64) null, [kind] nvarchar(32) not null, [name] nvarchar(256) not null)
GO

if object_id(N'dbo.tc_templates', N'U') is null create table dbo.tc_templates ([id] nvarchar(64) not null primary key, [name] nvarchar(256) not null, [body] nvarchar(max) not null, [scope] nvarchar(32) null)
GO

if col_length('dbo.tc_templates', 'scope') is null alter table dbo.tc_templates add [scope] nvarchar(32) null
GO

if object_id(N'dbo.tc_chat_reads', N'U') is null create table dbo.tc_chat_reads ([employee_id] int not null primary key, [read_at] datetimeoffset(3) not null)
GO

if object_id(N'dbo.tc_notices', N'U') is null create table dbo.tc_notices ([id] nvarchar(64) not null primary key, [at] datetimeoffset(3) not null, [recipients] nvarchar(max) not null, [title] nvarchar(256) not null, [body] nvarchar(max) not null, [url] nvarchar(256) not null)
GO

if not exists (select 1 from sys.indexes where name = 'tc_notices_at' and object_id = object_id(N'dbo.tc_notices'))
     create index tc_notices_at on dbo.tc_notices ([at])
GO

if object_id(N'dbo.tc_roles', N'U') is null create table dbo.tc_roles ([role] nvarchar(32) not null primary key, [name] nvarchar(128) not null, [permissions] nvarchar(max) not null)
GO

-- ------------------------------------------------------------
--  Проверка: должны быть выведены все таблицы приложения
-- ------------------------------------------------------------
SELECT name AS [Таблица] FROM sys.tables WHERE name LIKE N'tc[_]%' ORDER BY name;
GO
