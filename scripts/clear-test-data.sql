-- ============================================================
--  Контроль задач — удаление тестовых (демонстрационных) данных из базы SQL Server
--  (SQL Server 2016 и новее).
--
--  Версии до 6.0.0 заполняли пустую базу демонстрационным отделом. Скрипт убирает его,
--  не трогая настоящие данные, справочники, роли, шаблоны и разделы планирования.
--
--  Что считается тестовыми данными:
--    • сотрудники с почтой @example.com;
--    • задачи с идентификатором seed-…, отсутствия seed-abs-…, сообщения m1–m4;
--    • в недельных отчётах — записи по задачам seed-… и hist-… (отчёт без других записей удаляется);
--    • подразделения демонстрационного отдела («Руководство», «Проектная группа 1/2»,
--      «Группа документооборота», отделения разработки, сопровождения, аналитики, тестирования) —
--      только если в них нет сотрудников и вложенных подразделений;
--    • то, что после этого ссылается на несуществующих сотрудников: отсутствия, нормы отпусков,
--      сообщения, отметки «прочитано»;
--    • журнал уведомлений (временный, хранится неделю).
--
--  Как запустить:
--    1. Сделайте резервную копию базы (SSMS: правая кнопка на базе → Задачи → Создать резервную копию),
--       либо: backup database [TaskControl] to disk = N'C:\Backup\TaskControl-before-cleanup.bak'
--    2. Откройте файл в SQL Server Management Studio и выполните (F5). По умолчанию скрипт ТОЛЬКО
--       ПОКАЗЫВАЕТ, сколько записей удалит, и ничего не меняет.
--    3. Проверив числа, замените в строке «declare @apply bit = 0» ноль на 1 и выполните ещё раз.
--    Из командной строки:  sqlcmd -S СЕРВЕР -E -C -I -b -d TaskControl -i clear-test-data.sql
--  Всё выполняется в одной транзакции: при ошибке ничего не удаляется.
--  Приложение можно не останавливать; после очистки обновите страницу в браузере.
-- ============================================================

set nocount on;
set xact_abort on;
-- Для фильтрованного индекса tc_users нужен QUOTED_IDENTIFIER ON (в sqlcmd — ключ -I).
set quoted_identifier on;

declare @apply bit = 0;   -- 0 — только показать, 1 — удалить

if object_id(N'dbo.tc_users', N'U') is null
begin
  raiserror(N'В текущей базе нет таблиц приложения (tc_…). Выберите базу TaskControl и запустите скрипт снова.', 16, 1);
  return;
end;

begin transaction;

declare @report table ([что] nvarchar(200), [записей] int);

-- Сотрудники демонстрационного отдела.
delete from dbo.tc_users where [email] like N'%@example.com';
insert @report values (N'Сотрудники с почтой @example.com', @@rowcount);

-- Задачи, отсутствия и сообщения из демонстрационного набора.
delete from dbo.tc_tasks where [id] like N'seed-%';
insert @report values (N'Задачи seed-…', @@rowcount);

delete from dbo.tc_absences where [id] like N'seed-abs-%';
insert @report values (N'Отсутствия seed-abs-…', @@rowcount);

delete from dbo.tc_messages where [id] in (N'm1', N'm2', N'm3', N'm4');
insert @report values (N'Сообщения m1–m4', @@rowcount);

-- Недельные отчёты: убираем записи по демонстрационным задачам (seed-…, hist-…),
-- остальные записи отчёта сохраняются; отчёт без записей удаляется.
declare @reports_changed int = 0;
update r
set [entries] = isnull(N'[' + stuff((
      select N',' + e.[value]
      from openjson(r.[entries]) e
      where json_value(e.[value], '$.taskId') not like N'seed-%'
        and json_value(e.[value], '$.taskId') not like N'hist-%'
      order by cast(e.[key] as int)
      for xml path(''), type).value('.', 'nvarchar(max)'), 1, 1, N'') + N']', N'[]')
from dbo.tc_reports r
where exists (
  select 1 from openjson(r.[entries]) e
  where json_value(e.[value], '$.taskId') like N'seed-%' or json_value(e.[value], '$.taskId') like N'hist-%');
set @reports_changed = @@rowcount;
insert @report values (N'Отчёты, из которых убраны демонстрационные записи', @reports_changed);

delete from dbo.tc_reports where [entries] = N'[]';
insert @report values (N'Отчёты без записей (удалены)', @@rowcount);

-- Демонстрационные подразделения — только пустые: без сотрудников и вложенных подразделений.
-- Ведомство, управление и отдел (u-org, u-dir-it, u-dept-dev) остаются.
delete u from dbo.tc_units u
where u.[id] in (N'g-1', N'g-2', N'g-3', N'g-4', N's-dev', N's-support', N's-analytics', N's-qa')
  and not exists (select 1 from dbo.tc_users x where x.[unit_id] = u.[id])
  and not exists (select 1 from dbo.tc_units c where c.[parent_id] = u.[id]);
insert @report values (N'Пустые демонстрационные подразделения', @@rowcount);

-- Записи, которые ссылаются на несуществующих сотрудников.
delete a from dbo.tc_absences a where not exists (select 1 from dbo.tc_users x where x.[employee_id] = a.[employee_id]);
insert @report values (N'Отсутствия сотрудников, которых нет', @@rowcount);

delete e from dbo.tc_entitlements e where not exists (select 1 from dbo.tc_users x where x.[employee_id] = e.[employee_id]);
insert @report values (N'Нормы отпусков сотрудников, которых нет', @@rowcount);

delete m from dbo.tc_messages m where not exists (select 1 from dbo.tc_users x where x.[employee_id] = m.[author_id]);
insert @report values (N'Сообщения сотрудников, которых нет', @@rowcount);

delete c from dbo.tc_chat_reads c where not exists (select 1 from dbo.tc_users x where x.[employee_id] = c.[employee_id]);
insert @report values (N'Отметки «прочитано» сотрудников, которых нет', @@rowcount);

-- Журнал уведомлений временный (неделя): после очистки в нём остались бы события о демонстрационных данных.
delete from dbo.tc_notices;
insert @report values (N'Журнал уведомлений', @@rowcount);

select [что], [записей] from @report;

if @apply = 1
begin
  commit transaction;
  print N'Готово: тестовые данные удалены.';
end
else
begin
  rollback transaction;
  print N'Проверка: ничего не удалено. Чтобы удалить, задайте @apply = 1 и выполните скрипт ещё раз.';
end;
