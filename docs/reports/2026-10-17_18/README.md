# Отчёт за 17–18 октября 2026 года

Иллюстрированный отчёт о функциональных изменениях и проверках выпуска 6.5.0.
Готовый файл: [PDF](../../../output/pdf/Task_Control_Report_2026-10-17_18_v6.5.0.pdf).

## Повторная сборка

Python 3 с ReportLab; шрифты Segoe UI из Windows:

```powershell
python docs/reports/2026-10-17_18/report.py
```

Скрипт читает только сохранённые изображения и текст. Он не подключается к базе,
не импортирует данные и не публикует приложение. Публикация выполняется после
подготовки PDF, поэтому отчёт отделяет подготовленный пакет от последующей проверки
развёрнутой версии.

## Изображения и фактические данные

`tetris-centered.png`, `planning-search.png`, `employee-settings.png`, `period-settings.png`,
`vacation-settings.png` и `admin-users.png` сняты в локальной демонстрации 6.5.0.
Остальные скриншоты — реальные проверки той же работы на этапе 6.4.0 и последующих
локальных исправлений. Версия и назначение указаны в подписях PDF. Снимки не содержат
паролей подключения; конфигурация SQL и резервные копии не входят в отчёт.

Числа импорта отражают момент его завершения, а не обещание неизменности рабочей базы.
417 проверок подтверждены полным прогоном с локальным SQL Server 2025. Интеграционные
SQL-тесты работают в отдельной временной базе.

Две тематические иллюстрации созданы встроенным инструментом генерации изображений
для этого отчёта. Это иллюстрации, а не скриншоты или фотографии реальной инфраструктуры.
Точные финальные запросы сохранены в image-prompts.json. Краткое описание запросов:

1. Photoreal editorial overhead desk with a paper monthly planner with abstract geometric marks and checkmarks, organized task cards, dark blue notebook and pen, laptop edge with an abstract unreadable calendar. Navy and warm white, natural daylight, horizontal 3:2 composition. No people, readable text, logos or watermarks. Thematic cover image for a business application development report.
2. Editorial 3D isometric illustration of a shared application branching into two separate modes: a local office SQL server/database and an independent browser local-storage laptop. Navy, pale blue and warm white, horizontal 3:2 composition. No letters, logos or people. No connection from the private SQL server to the cloud browser. Thematic image for explaining two independent storage modes.
