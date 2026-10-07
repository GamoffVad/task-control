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
--  Данные: таблицы создаются пустыми. При первом открытии приложение записывает только
--  справочники, роли, шаблоны и разделы плана; тестовых данных нет. Администратором
--  становится учётная запись из TC_ADMIN_LOGIN, остальные сотрудники вносятся в «Администрировании».
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

if object_id(N'dbo.tc_meta', N'U') is null create table dbo.tc_meta (
    [key] nvarchar(64) not null primary key,
    [value] nvarchar(max) not null constraint df_tc_meta_value default '')
GO

if col_length('dbo.tc_meta', 'value') is null alter table dbo.tc_meta add [value] nvarchar(max) not null constraint df_tc_meta_value default ''
GO

if object_id(N'dbo.tc_tasks', N'U') is null create table dbo.tc_tasks (
    [id] nvarchar(64) not null primary key,
    [seq] bigint identity(1,1) not null,
    [title] nvarchar(max) not null constraint df_tc_tasks_title default '',
    [row_id] nvarchar(64) null,
    [category] nvarchar(64) null,
    [assignee_ids] nvarchar(max) not null constraint df_tc_tasks_assignee_ids default '[]',
    [start_at] datetimeoffset(3) not null constraint df_tc_tasks_start_at default sysdatetimeoffset(),
    [end_at] datetimeoffset(3) not null constraint df_tc_tasks_end_at default sysdatetimeoffset(),
    [doc_name] nvarchar(max) not null constraint df_tc_tasks_doc_name default '',
    [doc_number] nvarchar(max) not null constraint df_tc_tasks_doc_number default '',
    [result] nvarchar(max) not null constraint df_tc_tasks_result default '',
    [done] bit not null constraint df_tc_tasks_done default 0,
    [score] decimal(10,2) null,
    [done_at] datetimeoffset(3) null)
GO

if col_length('dbo.tc_tasks', 'seq') is null alter table dbo.tc_tasks add [seq] bigint identity(1,1) not null
GO

if col_length('dbo.tc_tasks', 'title') is null alter table dbo.tc_tasks add [title] nvarchar(max) not null constraint df_tc_tasks_title default ''
GO

if col_length('dbo.tc_tasks', 'row_id') is null alter table dbo.tc_tasks add [row_id] nvarchar(64) null
GO

if col_length('dbo.tc_tasks', 'category') is null alter table dbo.tc_tasks add [category] nvarchar(64) null
GO

if col_length('dbo.tc_tasks', 'assignee_ids') is null alter table dbo.tc_tasks add [assignee_ids] nvarchar(max) not null constraint df_tc_tasks_assignee_ids default '[]'
GO

if col_length('dbo.tc_tasks', 'start_at') is null alter table dbo.tc_tasks add [start_at] datetimeoffset(3) not null constraint df_tc_tasks_start_at default sysdatetimeoffset()
GO

if col_length('dbo.tc_tasks', 'end_at') is null alter table dbo.tc_tasks add [end_at] datetimeoffset(3) not null constraint df_tc_tasks_end_at default sysdatetimeoffset()
GO

if col_length('dbo.tc_tasks', 'doc_name') is null alter table dbo.tc_tasks add [doc_name] nvarchar(max) not null constraint df_tc_tasks_doc_name default ''
GO

if col_length('dbo.tc_tasks', 'doc_number') is null alter table dbo.tc_tasks add [doc_number] nvarchar(max) not null constraint df_tc_tasks_doc_number default ''
GO

if col_length('dbo.tc_tasks', 'result') is null alter table dbo.tc_tasks add [result] nvarchar(max) not null constraint df_tc_tasks_result default ''
GO

if col_length('dbo.tc_tasks', 'done') is null alter table dbo.tc_tasks add [done] bit not null constraint df_tc_tasks_done default 0
GO

if col_length('dbo.tc_tasks', 'score') is null alter table dbo.tc_tasks add [score] decimal(10,2) null
GO

if col_length('dbo.tc_tasks', 'done_at') is null alter table dbo.tc_tasks add [done_at] datetimeoffset(3) null
GO

if object_id(N'dbo.tc_absences', N'U') is null create table dbo.tc_absences (
    [id] nvarchar(64) not null primary key,
    [employee_id] int not null constraint df_tc_absences_employee_id default 0,
    [type] nvarchar(16) not null constraint df_tc_absences_type default 'vacation' constraint ck_tc_absences_type check ([type] in ('vacation','trip','dayoff','sick','study')),
    [date_from] char(10) not null constraint df_tc_absences_date_from default '1970-01-01',
    [date_to] char(10) null,
    [status] nvarchar(16) not null constraint df_tc_absences_status default 'request' constraint ck_tc_absences_status check ([status] in ('request','approved','rejected')),
    [note] nvarchar(max) not null constraint df_tc_absences_note default '',
    [decided_by] int null,
    [created_at] datetimeoffset(3) not null constraint df_tc_absences_created_at default sysdatetimeoffset())
GO

if col_length('dbo.tc_absences', 'employee_id') is null alter table dbo.tc_absences add [employee_id] int not null constraint df_tc_absences_employee_id default 0
GO

if col_length('dbo.tc_absences', 'type') is null alter table dbo.tc_absences add [type] nvarchar(16) not null constraint df_tc_absences_type default 'vacation' constraint ck_tc_absences_type check ([type] in ('vacation','trip','dayoff','sick','study'))
GO

if col_length('dbo.tc_absences', 'date_from') is null alter table dbo.tc_absences add [date_from] char(10) not null constraint df_tc_absences_date_from default '1970-01-01'
GO

if col_length('dbo.tc_absences', 'date_to') is null alter table dbo.tc_absences add [date_to] char(10) null
GO

if col_length('dbo.tc_absences', 'status') is null alter table dbo.tc_absences add [status] nvarchar(16) not null constraint df_tc_absences_status default 'request' constraint ck_tc_absences_status check ([status] in ('request','approved','rejected'))
GO

if col_length('dbo.tc_absences', 'note') is null alter table dbo.tc_absences add [note] nvarchar(max) not null constraint df_tc_absences_note default ''
GO

if col_length('dbo.tc_absences', 'decided_by') is null alter table dbo.tc_absences add [decided_by] int null
GO

if col_length('dbo.tc_absences', 'created_at') is null alter table dbo.tc_absences add [created_at] datetimeoffset(3) not null constraint df_tc_absences_created_at default sysdatetimeoffset()
GO

if not exists (select 1 from sys.indexes where name = 'tc_absences_employee' and object_id = object_id(N'dbo.tc_absences'))
     create index tc_absences_employee on dbo.tc_absences ([employee_id], [date_from])
GO

if object_id(N'dbo.tc_entitlements', N'U') is null create table dbo.tc_entitlements (
    [employee_id] int not null,
    [year] int not null,
    [vacation_days] int not null constraint df_tc_entitlements_vacation_days default 0,
    [carried_over] int not null constraint df_tc_entitlements_carried default 0,
    [dayoff_accrued] int not null constraint df_tc_entitlements_dayoff default 0,
    constraint pk_tc_entitlements primary key ([employee_id], [year]))
GO

if col_length('dbo.tc_entitlements', 'vacation_days') is null alter table dbo.tc_entitlements add [vacation_days] int not null constraint df_tc_entitlements_vacation_days default 0
GO

if col_length('dbo.tc_entitlements', 'carried_over') is null alter table dbo.tc_entitlements add [carried_over] int not null constraint df_tc_entitlements_carried default 0
GO

if col_length('dbo.tc_entitlements', 'dayoff_accrued') is null alter table dbo.tc_entitlements add [dayoff_accrued] int not null constraint df_tc_entitlements_dayoff default 0
GO

if object_id(N'dbo.tc_reports', N'U') is null create table dbo.tc_reports (
    [week_start] char(10) not null primary key,
    [submitted_at] datetimeoffset(3) not null constraint df_tc_reports_submitted_at default sysdatetimeoffset(),
    [entries] nvarchar(max) not null constraint df_tc_reports_entries default '[]')
GO

if col_length('dbo.tc_reports', 'submitted_at') is null alter table dbo.tc_reports add [submitted_at] datetimeoffset(3) not null constraint df_tc_reports_submitted_at default sysdatetimeoffset()
GO

if col_length('dbo.tc_reports', 'entries') is null alter table dbo.tc_reports add [entries] nvarchar(max) not null constraint df_tc_reports_entries default '[]'
GO

if object_id(N'dbo.tc_messages', N'U') is null create table dbo.tc_messages (
    [id] nvarchar(64) not null primary key,
    [author_id] int not null constraint df_tc_messages_author_id default 0,
    [text] nvarchar(max) not null constraint df_tc_messages_text default '',
    [sent_at] datetimeoffset(3) not null constraint df_tc_messages_sent_at default sysdatetimeoffset())
GO

if col_length('dbo.tc_messages', 'author_id') is null alter table dbo.tc_messages add [author_id] int not null constraint df_tc_messages_author_id default 0
GO

if col_length('dbo.tc_messages', 'text') is null alter table dbo.tc_messages add [text] nvarchar(max) not null constraint df_tc_messages_text default ''
GO

if col_length('dbo.tc_messages', 'sent_at') is null alter table dbo.tc_messages add [sent_at] datetimeoffset(3) not null constraint df_tc_messages_sent_at default sysdatetimeoffset()
GO

if object_id(N'dbo.tc_dictionaries', N'U') is null create table dbo.tc_dictionaries (
    [id] nvarchar(64) not null primary key,
    [dictionary] nvarchar(64) not null constraint df_tc_dictionaries_dictionary default '',
    [code] nvarchar(64) not null constraint df_tc_dictionaries_code default '',
    [title] nvarchar(256) not null constraint df_tc_dictionaries_title default '',
    [color] nvarchar(32) null)
GO

if col_length('dbo.tc_dictionaries', 'dictionary') is null alter table dbo.tc_dictionaries add [dictionary] nvarchar(64) not null constraint df_tc_dictionaries_dictionary default ''
GO

if col_length('dbo.tc_dictionaries', 'code') is null alter table dbo.tc_dictionaries add [code] nvarchar(64) not null constraint df_tc_dictionaries_code default ''
GO

if col_length('dbo.tc_dictionaries', 'title') is null alter table dbo.tc_dictionaries add [title] nvarchar(256) not null constraint df_tc_dictionaries_title default ''
GO

if col_length('dbo.tc_dictionaries', 'color') is null alter table dbo.tc_dictionaries add [color] nvarchar(32) null
GO

if not exists (select 1 from sys.indexes where name = 'tc_dictionaries_kind_code' and object_id = object_id(N'dbo.tc_dictionaries'))
     create unique index tc_dictionaries_kind_code on dbo.tc_dictionaries ([dictionary], [code])
GO

if object_id(N'dbo.tc_plan_rows', N'U') is null create table dbo.tc_plan_rows (
    [id] nvarchar(64) not null primary key,
    [title] nvarchar(max) not null constraint df_tc_plan_rows_title default '',
    [is_header] bit not null constraint df_tc_plan_rows_header default 0,
    [base_score] decimal(10,2) not null constraint df_tc_plan_rows_score default 0)
GO

if col_length('dbo.tc_plan_rows', 'title') is null alter table dbo.tc_plan_rows add [title] nvarchar(max) not null constraint df_tc_plan_rows_title default ''
GO

if col_length('dbo.tc_plan_rows', 'is_header') is null alter table dbo.tc_plan_rows add [is_header] bit not null constraint df_tc_plan_rows_header default 0
GO

if col_length('dbo.tc_plan_rows', 'base_score') is null alter table dbo.tc_plan_rows add [base_score] decimal(10,2) not null constraint df_tc_plan_rows_score default 0
GO

if object_id(N'dbo.tc_users', N'U') is null create table dbo.tc_users (
    [employee_id] int not null primary key,
    [email] nvarchar(256) not null constraint df_tc_users_email default '' constraint uq_tc_users_email unique,
    [role] nvarchar(32) not null constraint df_tc_users_role default 'executor',
    [active] bit not null constraint df_tc_users_active default 1,
    [windows_login] nvarchar(128) not null constraint df_tc_users_login default '',
    [full_name] nvarchar(256) not null constraint df_tc_users_full_name default '',
    [position] nvarchar(256) not null constraint df_tc_users_position default '',
    [unit_id] nvarchar(64) null)
GO

if col_length('dbo.tc_users', 'email') is null alter table dbo.tc_users add [email] nvarchar(256) not null constraint df_tc_users_email default ''
GO

if col_length('dbo.tc_users', 'role') is null alter table dbo.tc_users add [role] nvarchar(32) not null constraint df_tc_users_role default 'executor'
GO

if col_length('dbo.tc_users', 'active') is null alter table dbo.tc_users add [active] bit not null constraint df_tc_users_active default 1
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

if object_id(N'dbo.tc_units', N'U') is null create table dbo.tc_units (
    [id] nvarchar(64) not null primary key,
    [parent_id] nvarchar(64) null,
    [kind] nvarchar(32) not null constraint df_tc_units_kind default 'section',
    [name] nvarchar(256) not null constraint df_tc_units_name default '')
GO

if col_length('dbo.tc_units', 'parent_id') is null alter table dbo.tc_units add [parent_id] nvarchar(64) null
GO

if col_length('dbo.tc_units', 'kind') is null alter table dbo.tc_units add [kind] nvarchar(32) not null constraint df_tc_units_kind default 'section'
GO

if col_length('dbo.tc_units', 'name') is null alter table dbo.tc_units add [name] nvarchar(256) not null constraint df_tc_units_name default ''
GO

if object_id(N'dbo.tc_templates', N'U') is null create table dbo.tc_templates (
    [id] nvarchar(64) not null primary key,
    [name] nvarchar(256) not null constraint df_tc_templates_name default '',
    [body] nvarchar(max) not null constraint df_tc_templates_body default '',
    [scope] nvarchar(32) null)
GO

if col_length('dbo.tc_templates', 'name') is null alter table dbo.tc_templates add [name] nvarchar(256) not null constraint df_tc_templates_name default ''
GO

if col_length('dbo.tc_templates', 'body') is null alter table dbo.tc_templates add [body] nvarchar(max) not null constraint df_tc_templates_body default ''
GO

if col_length('dbo.tc_templates', 'scope') is null alter table dbo.tc_templates add [scope] nvarchar(32) null
GO

if object_id(N'dbo.tc_chat_reads', N'U') is null create table dbo.tc_chat_reads (
    [employee_id] int not null primary key,
    [read_at] datetimeoffset(3) not null constraint df_tc_chat_reads_read_at default sysdatetimeoffset())
GO

if col_length('dbo.tc_chat_reads', 'read_at') is null alter table dbo.tc_chat_reads add [read_at] datetimeoffset(3) not null constraint df_tc_chat_reads_read_at default sysdatetimeoffset()
GO

if object_id(N'dbo.tc_notices', N'U') is null create table dbo.tc_notices (
    [id] nvarchar(64) not null primary key,
    [at] datetimeoffset(3) not null constraint df_tc_notices_at default sysdatetimeoffset(),
    [recipients] nvarchar(max) not null constraint df_tc_notices_recipients default '[]',
    [title] nvarchar(256) not null constraint df_tc_notices_title default '',
    [body] nvarchar(max) not null constraint df_tc_notices_body default '',
    [url] nvarchar(256) not null constraint df_tc_notices_url default '')
GO

if col_length('dbo.tc_notices', 'at') is null alter table dbo.tc_notices add [at] datetimeoffset(3) not null constraint df_tc_notices_at default sysdatetimeoffset()
GO

if col_length('dbo.tc_notices', 'recipients') is null alter table dbo.tc_notices add [recipients] nvarchar(max) not null constraint df_tc_notices_recipients default '[]'
GO

if col_length('dbo.tc_notices', 'title') is null alter table dbo.tc_notices add [title] nvarchar(256) not null constraint df_tc_notices_title default ''
GO

if col_length('dbo.tc_notices', 'body') is null alter table dbo.tc_notices add [body] nvarchar(max) not null constraint df_tc_notices_body default ''
GO

if col_length('dbo.tc_notices', 'url') is null alter table dbo.tc_notices add [url] nvarchar(256) not null constraint df_tc_notices_url default ''
GO

if not exists (select 1 from sys.indexes where name = 'tc_notices_at' and object_id = object_id(N'dbo.tc_notices'))
     create index tc_notices_at on dbo.tc_notices ([at])
GO

if object_id(N'dbo.tc_roles', N'U') is null create table dbo.tc_roles (
    [role] nvarchar(32) not null primary key,
    [name] nvarchar(128) not null constraint df_tc_roles_name default '',
    [permissions] nvarchar(max) not null constraint df_tc_roles_permissions default '[]')
GO

if col_length('dbo.tc_roles', 'name') is null alter table dbo.tc_roles add [name] nvarchar(128) not null constraint df_tc_roles_name default ''
GO

if col_length('dbo.tc_roles', 'permissions') is null alter table dbo.tc_roles add [permissions] nvarchar(max) not null constraint df_tc_roles_permissions default '[]'
GO

-- ------------------------------------------------------------
--  Проверка: должны быть выведены все таблицы приложения
-- ------------------------------------------------------------
SELECT name AS [Таблица] FROM sys.tables WHERE name LIKE N'tc[_]%' ORDER BY name;
GO
