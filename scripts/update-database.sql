-- Контроль задач — обновление схемы существующей рабочей базы.
-- В SSMS выберите ВАШУ действующую базу в списке баз и выполните файл целиком.
-- Перед обновлением сделайте резервную копию базы штатными средствами SQL Server.
-- Скрипт не создаёт и не выбирает другую базу, не меняет подключение, логины или записи.
-- Добавляет недостающие таблицы, столбцы и индексы; повторный запуск допустим.
-- Совместимость старых отсутствий: расширяет код типа и снимает прежнее ограничение списка типов.
-- Все изменения схемы выполняются в одной транзакции. Тестовых данных нет.
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
  OR NOT EXISTS (SELECT 1 FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name LIKE N'tc[_]%')
  THROW 50001, N'Выберите существующую базу приложения с таблицами tc_. Создание новой базы этим скриптом запрещено.', 1;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @rc int;
  EXEC @rc = sp_getapplock @Resource = N'task-control', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
  IF @rc < 0 THROW 50002, N'База занята. Повторите обновление позже.', 1;

  EXEC(N'if object_id(N''dbo.tc_meta'', N''U'') is null create table dbo.tc_meta (
    [key] nvarchar(64) not null primary key,
    [value] nvarchar(max) not null constraint df_tc_meta_value default '''')');

  EXEC(N'if col_length(''dbo.tc_meta'', ''value'') is null alter table dbo.tc_meta add [value] nvarchar(max) not null constraint df_tc_meta_value default ''''');

  EXEC(N'if object_id(N''dbo.tc_tasks'', N''U'') is null create table dbo.tc_tasks (
    [id] nvarchar(64) not null primary key,
    [seq] bigint identity(1,1) not null,
    [title] nvarchar(max) not null constraint df_tc_tasks_title default '''',
    [row_id] nvarchar(64) null,
    [category] nvarchar(64) null,
    [assignee_ids] nvarchar(max) not null constraint df_tc_tasks_assignee_ids default ''[]'',
    [start_at] datetimeoffset(3) not null constraint df_tc_tasks_start_at default sysdatetimeoffset(),
    [end_at] datetimeoffset(3) not null constraint df_tc_tasks_end_at default sysdatetimeoffset(),
    [doc_name] nvarchar(max) not null constraint df_tc_tasks_doc_name default '''',
    [doc_number] nvarchar(max) not null constraint df_tc_tasks_doc_number default '''',
    [result] nvarchar(max) not null constraint df_tc_tasks_result default '''',
    [done] bit not null constraint df_tc_tasks_done default 0,
    [score] decimal(10,2) null,
    [done_at] datetimeoffset(3) null)');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''seq'') is null alter table dbo.tc_tasks add [seq] bigint identity(1,1) not null');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''title'') is null alter table dbo.tc_tasks add [title] nvarchar(max) not null constraint df_tc_tasks_title default ''''');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''row_id'') is null alter table dbo.tc_tasks add [row_id] nvarchar(64) null');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''category'') is null alter table dbo.tc_tasks add [category] nvarchar(64) null');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''assignee_ids'') is null alter table dbo.tc_tasks add [assignee_ids] nvarchar(max) not null constraint df_tc_tasks_assignee_ids default ''[]''');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''start_at'') is null alter table dbo.tc_tasks add [start_at] datetimeoffset(3) not null constraint df_tc_tasks_start_at default sysdatetimeoffset()');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''end_at'') is null alter table dbo.tc_tasks add [end_at] datetimeoffset(3) not null constraint df_tc_tasks_end_at default sysdatetimeoffset()');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''doc_name'') is null alter table dbo.tc_tasks add [doc_name] nvarchar(max) not null constraint df_tc_tasks_doc_name default ''''');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''doc_number'') is null alter table dbo.tc_tasks add [doc_number] nvarchar(max) not null constraint df_tc_tasks_doc_number default ''''');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''result'') is null alter table dbo.tc_tasks add [result] nvarchar(max) not null constraint df_tc_tasks_result default ''''');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''done'') is null alter table dbo.tc_tasks add [done] bit not null constraint df_tc_tasks_done default 0');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''score'') is null alter table dbo.tc_tasks add [score] decimal(10,2) null');

  EXEC(N'if col_length(''dbo.tc_tasks'', ''done_at'') is null alter table dbo.tc_tasks add [done_at] datetimeoffset(3) null');

  EXEC(N'if object_id(N''dbo.tc_absences'', N''U'') is null create table dbo.tc_absences (
    [id] nvarchar(64) not null primary key,
    [employee_id] int not null constraint df_tc_absences_employee_id default 0,
    [type] nvarchar(64) not null constraint df_tc_absences_type default ''vacation'',
    [duty_type] nvarchar(48) null,
    [vacation_type] nvarchar(48) null,
    [travel_days_before] int null,
    [travel_days_after] int null,
    [date_from] char(10) not null constraint df_tc_absences_date_from default ''1970-01-01'',
    [date_to] char(10) null,
    [status] nvarchar(16) not null constraint df_tc_absences_status default ''request'' constraint ck_tc_absences_status check ([status] in (''request'',''approved'',''rejected'')),
    [note] nvarchar(max) not null constraint df_tc_absences_note default '''',
    [decided_by] int null,
    [created_at] datetimeoffset(3) not null constraint df_tc_absences_created_at default sysdatetimeoffset())');

  EXEC(N'if col_length(''dbo.tc_absences'', ''employee_id'') is null alter table dbo.tc_absences add [employee_id] int not null constraint df_tc_absences_employee_id default 0');

  EXEC(N'if col_length(''dbo.tc_absences'', ''type'') is null alter table dbo.tc_absences add [type] nvarchar(64) not null constraint df_tc_absences_type default ''vacation''');

  EXEC(N'if col_length(''dbo.tc_absences'', ''duty_type'') is null alter table dbo.tc_absences add [duty_type] nvarchar(48) null');

  EXEC(N'if col_length(''dbo.tc_absences'', ''vacation_type'') is null alter table dbo.tc_absences add [vacation_type] nvarchar(48) null');

  EXEC(N'if col_length(''dbo.tc_absences'', ''travel_days_before'') is null alter table dbo.tc_absences add [travel_days_before] int null');

  EXEC(N'if col_length(''dbo.tc_absences'', ''travel_days_after'') is null alter table dbo.tc_absences add [travel_days_after] int null');

  EXEC(N'if col_length(''dbo.tc_absences'', ''date_from'') is null alter table dbo.tc_absences add [date_from] char(10) not null constraint df_tc_absences_date_from default ''1970-01-01''');

  EXEC(N'if col_length(''dbo.tc_absences'', ''date_to'') is null alter table dbo.tc_absences add [date_to] char(10) null');

  EXEC(N'if col_length(''dbo.tc_absences'', ''status'') is null alter table dbo.tc_absences add [status] nvarchar(16) not null constraint df_tc_absences_status default ''request'' constraint ck_tc_absences_status check ([status] in (''request'',''approved'',''rejected''))');

  EXEC(N'if col_length(''dbo.tc_absences'', ''note'') is null alter table dbo.tc_absences add [note] nvarchar(max) not null constraint df_tc_absences_note default ''''');

  EXEC(N'if col_length(''dbo.tc_absences'', ''decided_by'') is null alter table dbo.tc_absences add [decided_by] int null');

  EXEC(N'if col_length(''dbo.tc_absences'', ''created_at'') is null alter table dbo.tc_absences add [created_at] datetimeoffset(3) not null constraint df_tc_absences_created_at default sysdatetimeoffset()');

  EXEC(N'if not exists (select 1 from sys.indexes where name = ''tc_absences_employee'' and object_id = object_id(N''dbo.tc_absences''))
     create index tc_absences_employee on dbo.tc_absences ([employee_id], [date_from])');

  EXEC(N'if object_id(N''dbo.tc_entitlements'', N''U'') is null create table dbo.tc_entitlements (
    [employee_id] int not null,
    [year] int not null,
    [vacation_days] int not null constraint df_tc_entitlements_vacation_days default 0,
    [carried_over] int not null constraint df_tc_entitlements_carried default 0,
    [dayoff_accrued] int not null constraint df_tc_entitlements_dayoff default 0,
    constraint pk_tc_entitlements primary key ([employee_id], [year]))');

  EXEC(N'if col_length(''dbo.tc_entitlements'', ''vacation_days'') is null alter table dbo.tc_entitlements add [vacation_days] int not null constraint df_tc_entitlements_vacation_days default 0');

  EXEC(N'if col_length(''dbo.tc_entitlements'', ''carried_over'') is null alter table dbo.tc_entitlements add [carried_over] int not null constraint df_tc_entitlements_carried default 0');

  EXEC(N'if col_length(''dbo.tc_entitlements'', ''dayoff_accrued'') is null alter table dbo.tc_entitlements add [dayoff_accrued] int not null constraint df_tc_entitlements_dayoff default 0');

  EXEC(N'if object_id(N''dbo.tc_reports'', N''U'') is null create table dbo.tc_reports (
    [week_start] char(10) not null primary key,
    [period_end] char(10) null,
    [submitted_at] datetimeoffset(3) not null constraint df_tc_reports_submitted_at default sysdatetimeoffset(),
    [entries] nvarchar(max) not null constraint df_tc_reports_entries default ''[]'')');

  EXEC(N'if col_length(''dbo.tc_reports'', ''period_end'') is null alter table dbo.tc_reports add [period_end] char(10) null');

  EXEC(N'if col_length(''dbo.tc_reports'', ''submitted_at'') is null alter table dbo.tc_reports add [submitted_at] datetimeoffset(3) not null constraint df_tc_reports_submitted_at default sysdatetimeoffset()');

  EXEC(N'if col_length(''dbo.tc_reports'', ''entries'') is null alter table dbo.tc_reports add [entries] nvarchar(max) not null constraint df_tc_reports_entries default ''[]''');

  EXEC(N'if object_id(N''dbo.tc_messages'', N''U'') is null create table dbo.tc_messages (
    [id] nvarchar(64) not null primary key,
    [author_id] int not null constraint df_tc_messages_author_id default 0,
    [text] nvarchar(max) not null constraint df_tc_messages_text default '''',
    [sent_at] datetimeoffset(3) not null constraint df_tc_messages_sent_at default sysdatetimeoffset())');

  EXEC(N'if col_length(''dbo.tc_messages'', ''author_id'') is null alter table dbo.tc_messages add [author_id] int not null constraint df_tc_messages_author_id default 0');

  EXEC(N'if col_length(''dbo.tc_messages'', ''text'') is null alter table dbo.tc_messages add [text] nvarchar(max) not null constraint df_tc_messages_text default ''''');

  EXEC(N'if col_length(''dbo.tc_messages'', ''sent_at'') is null alter table dbo.tc_messages add [sent_at] datetimeoffset(3) not null constraint df_tc_messages_sent_at default sysdatetimeoffset()');

  EXEC(N'if object_id(N''dbo.tc_dictionaries'', N''U'') is null create table dbo.tc_dictionaries (
    [id] nvarchar(64) not null primary key,
    [dictionary] nvarchar(64) not null constraint df_tc_dictionaries_dictionary default '''',
    [code] nvarchar(64) not null constraint df_tc_dictionaries_code default '''',
    [title] nvarchar(256) not null constraint df_tc_dictionaries_title default '''',
    [color] nvarchar(32) null)');

  EXEC(N'if col_length(''dbo.tc_dictionaries'', ''dictionary'') is null alter table dbo.tc_dictionaries add [dictionary] nvarchar(64) not null constraint df_tc_dictionaries_dictionary default ''''');

  EXEC(N'if col_length(''dbo.tc_dictionaries'', ''code'') is null alter table dbo.tc_dictionaries add [code] nvarchar(64) not null constraint df_tc_dictionaries_code default ''''');

  EXEC(N'if col_length(''dbo.tc_dictionaries'', ''title'') is null alter table dbo.tc_dictionaries add [title] nvarchar(256) not null constraint df_tc_dictionaries_title default ''''');

  EXEC(N'if col_length(''dbo.tc_dictionaries'', ''color'') is null alter table dbo.tc_dictionaries add [color] nvarchar(32) null');

  EXEC(N'if not exists (select 1 from sys.indexes where name = ''tc_dictionaries_kind_code'' and object_id = object_id(N''dbo.tc_dictionaries''))
     create unique index tc_dictionaries_kind_code on dbo.tc_dictionaries ([dictionary], [code])');

  EXEC(N'if object_id(N''dbo.tc_plan_rows'', N''U'') is null create table dbo.tc_plan_rows (
    [id] nvarchar(64) not null primary key,
    [title] nvarchar(max) not null constraint df_tc_plan_rows_title default '''',
    [is_header] bit not null constraint df_tc_plan_rows_header default 0,
    [base_score] decimal(10,2) not null constraint df_tc_plan_rows_score default 0)');

  EXEC(N'if col_length(''dbo.tc_plan_rows'', ''title'') is null alter table dbo.tc_plan_rows add [title] nvarchar(max) not null constraint df_tc_plan_rows_title default ''''');

  EXEC(N'if col_length(''dbo.tc_plan_rows'', ''is_header'') is null alter table dbo.tc_plan_rows add [is_header] bit not null constraint df_tc_plan_rows_header default 0');

  EXEC(N'if col_length(''dbo.tc_plan_rows'', ''base_score'') is null alter table dbo.tc_plan_rows add [base_score] decimal(10,2) not null constraint df_tc_plan_rows_score default 0');

  EXEC(N'if object_id(N''dbo.tc_users'', N''U'') is null create table dbo.tc_users (
    [employee_id] int not null primary key,
    [email] nvarchar(256) not null constraint df_tc_users_email default '''' constraint uq_tc_users_email unique,
    [role] nvarchar(32) not null constraint df_tc_users_role default ''executor'',
    [active] bit not null constraint df_tc_users_active default 1,
    [hidden] bit not null constraint df_tc_users_hidden default 0,
    [annual_vacation_days] int null,
    [windows_login] nvarchar(128) not null constraint df_tc_users_login default '''',
    [full_name] nvarchar(256) not null constraint df_tc_users_full_name default '''',
    [position] nvarchar(256) not null constraint df_tc_users_position default '''',
    [unit_id] nvarchar(64) null)');

  EXEC(N'if col_length(''dbo.tc_users'', ''email'') is null alter table dbo.tc_users add [email] nvarchar(256) not null constraint df_tc_users_email default ''''');

  EXEC(N'if col_length(''dbo.tc_users'', ''role'') is null alter table dbo.tc_users add [role] nvarchar(32) not null constraint df_tc_users_role default ''executor''');

  EXEC(N'if col_length(''dbo.tc_users'', ''active'') is null alter table dbo.tc_users add [active] bit not null constraint df_tc_users_active default 1');

  EXEC(N'if col_length(''dbo.tc_users'', ''hidden'') is null alter table dbo.tc_users add [hidden] bit not null constraint df_tc_users_hidden default 0');

  EXEC(N'if col_length(''dbo.tc_users'', ''annual_vacation_days'') is null alter table dbo.tc_users add [annual_vacation_days] int null');

  EXEC(N'if col_length(''dbo.tc_users'', ''windows_login'') is null alter table dbo.tc_users add [windows_login] nvarchar(128) not null constraint df_tc_users_login default ''''');

  EXEC(N'if col_length(''dbo.tc_users'', ''full_name'') is null alter table dbo.tc_users add [full_name] nvarchar(256) not null constraint df_tc_users_full_name default ''''');

  EXEC(N'if col_length(''dbo.tc_users'', ''position'') is null alter table dbo.tc_users add [position] nvarchar(256) not null constraint df_tc_users_position default ''''');

  EXEC(N'if col_length(''dbo.tc_users'', ''unit_id'') is null alter table dbo.tc_users add [unit_id] nvarchar(64) null');

  EXEC(N'set quoted_identifier on;
   if not exists (select 1 from sys.indexes where name = ''tc_users_windows_login'' and object_id = object_id(N''dbo.tc_users''))
     create unique index tc_users_windows_login on dbo.tc_users ([windows_login]) where [windows_login] <> ''''');

  EXEC(N'if object_id(N''dbo.tc_units'', N''U'') is null create table dbo.tc_units (
    [id] nvarchar(64) not null primary key,
    [parent_id] nvarchar(64) null,
    [kind] nvarchar(32) not null constraint df_tc_units_kind default ''section'',
    [name] nvarchar(256) not null constraint df_tc_units_name default '''')');

  EXEC(N'if col_length(''dbo.tc_units'', ''parent_id'') is null alter table dbo.tc_units add [parent_id] nvarchar(64) null');

  EXEC(N'if col_length(''dbo.tc_units'', ''kind'') is null alter table dbo.tc_units add [kind] nvarchar(32) not null constraint df_tc_units_kind default ''section''');

  EXEC(N'if col_length(''dbo.tc_units'', ''name'') is null alter table dbo.tc_units add [name] nvarchar(256) not null constraint df_tc_units_name default ''''');

  EXEC(N'if object_id(N''dbo.tc_templates'', N''U'') is null create table dbo.tc_templates (
    [id] nvarchar(64) not null primary key,
    [name] nvarchar(256) not null constraint df_tc_templates_name default '''',
    [body] nvarchar(max) not null constraint df_tc_templates_body default '''',
    [scope] nvarchar(32) null)');

  EXEC(N'if col_length(''dbo.tc_templates'', ''name'') is null alter table dbo.tc_templates add [name] nvarchar(256) not null constraint df_tc_templates_name default ''''');

  EXEC(N'if col_length(''dbo.tc_templates'', ''body'') is null alter table dbo.tc_templates add [body] nvarchar(max) not null constraint df_tc_templates_body default ''''');

  EXEC(N'if col_length(''dbo.tc_templates'', ''scope'') is null alter table dbo.tc_templates add [scope] nvarchar(32) null');

  EXEC(N'if object_id(N''dbo.tc_chat_reads'', N''U'') is null create table dbo.tc_chat_reads (
    [employee_id] int not null primary key,
    [read_at] datetimeoffset(3) not null constraint df_tc_chat_reads_read_at default sysdatetimeoffset())');

  EXEC(N'if col_length(''dbo.tc_chat_reads'', ''read_at'') is null alter table dbo.tc_chat_reads add [read_at] datetimeoffset(3) not null constraint df_tc_chat_reads_read_at default sysdatetimeoffset()');

  EXEC(N'if object_id(N''dbo.tc_notices'', N''U'') is null create table dbo.tc_notices (
    [id] nvarchar(64) not null primary key,
    [at] datetimeoffset(3) not null constraint df_tc_notices_at default sysdatetimeoffset(),
    [recipients] nvarchar(max) not null constraint df_tc_notices_recipients default ''[]'',
    [title] nvarchar(256) not null constraint df_tc_notices_title default '''',
    [body] nvarchar(max) not null constraint df_tc_notices_body default '''',
    [url] nvarchar(256) not null constraint df_tc_notices_url default '''')');

  EXEC(N'if col_length(''dbo.tc_notices'', ''at'') is null alter table dbo.tc_notices add [at] datetimeoffset(3) not null constraint df_tc_notices_at default sysdatetimeoffset()');

  EXEC(N'if col_length(''dbo.tc_notices'', ''recipients'') is null alter table dbo.tc_notices add [recipients] nvarchar(max) not null constraint df_tc_notices_recipients default ''[]''');

  EXEC(N'if col_length(''dbo.tc_notices'', ''title'') is null alter table dbo.tc_notices add [title] nvarchar(256) not null constraint df_tc_notices_title default ''''');

  EXEC(N'if col_length(''dbo.tc_notices'', ''body'') is null alter table dbo.tc_notices add [body] nvarchar(max) not null constraint df_tc_notices_body default ''''');

  EXEC(N'if col_length(''dbo.tc_notices'', ''url'') is null alter table dbo.tc_notices add [url] nvarchar(256) not null constraint df_tc_notices_url default ''''');

  EXEC(N'if not exists (select 1 from sys.indexes where name = ''tc_notices_at'' and object_id = object_id(N''dbo.tc_notices''))
     create index tc_notices_at on dbo.tc_notices ([at])');

  EXEC(N'if object_id(N''dbo.tc_roles'', N''U'') is null create table dbo.tc_roles (
    [role] nvarchar(32) not null primary key,
    [name] nvarchar(128) not null constraint df_tc_roles_name default '''',
    [permissions] nvarchar(max) not null constraint df_tc_roles_permissions default ''[]'')');

  EXEC(N'if col_length(''dbo.tc_roles'', ''name'') is null alter table dbo.tc_roles add [name] nvarchar(128) not null constraint df_tc_roles_name default ''''');

  EXEC(N'if col_length(''dbo.tc_roles'', ''permissions'') is null alter table dbo.tc_roles add [permissions] nvarchar(max) not null constraint df_tc_roles_permissions default ''[]''');

  EXEC(N'if exists (select 1 from sys.check_constraints where name = ''ck_tc_absences_type'' and parent_object_id = object_id(''dbo.tc_absences'')) alter table dbo.tc_absences drop constraint [ck_tc_absences_type]');

  EXEC(N'if col_length(''dbo.tc_absences'', ''type'') < 128 alter table dbo.tc_absences alter column [type] nvarchar(64) not null');

  COMMIT TRANSACTION;
  SELECT DB_NAME() AS [Обновлена база], N'Схема обновлена. Существующие записи сохранены.' AS [Результат];
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
