# Отчёт о выпуске 6.16.0

Дата: 26 октября 2026 года. Отчёт рассматривает пять изменений текущей версии: фильтр подразделений календаря, адаптивную высоту карточек, календарные периоды показателей, счётчик дежурств в выходные и область доступа руководства отдела.

`report.py` создаёт девятистраничный PDF в `output/pdf/Task_Control_Report_v6.16.0_2026-10-26.pdf`. Используются ReportLab и встроенные шрифты Segoe UI. `qa.py` проверяет текст, версии, ссылки, нумерацию и формирует контактный лист после рендеринга Poppler в `tmp/pdfs/release-report-6.16.0/`.

## Изображения

- `calendar-overview.png` - снимок локальной демонстрации, сделанный при проверке версии 6.16.0. Тестовая задача после проверки удалена; корпоративная база не использовалась. `calendar-context.png` и `calendar-card.png` - фрагменты этого снимка без изменения содержимого.
- `kpi.png` - годовой период в версии 6.16.0; `kpi-header.png` - фрагмент с датой 01.01.2026.
- `employee-full.png` - карточка демонстрационного сотрудника; `employee-balances.png` и `weekend-count.png` - фрагменты блока отсутствий. Нулевой счётчик показан честно, события ради иллюстрации не создавались.
- `leadership-full.png` - форма редактирования группы «Руководство». `leadership.png` - фрагмент формы. Изменения прав через UI не сохранялись.
- `cover.png` - повторно использованная тематическая иллюстрация планирования из отчёта 23.10.2026; изображение не изображает интерфейс приложения и не служит доказательством реализации. Иллюстрация создана ранее инструментом imagegen, используется без перекраски.
- Схема иерархии на странице 7 построена векторно в `report.py`.

Исходный prompt обложки:

> Create a sophisticated editorial still-life illustration for a Russian enterprise software release report about task scheduling. Landscape 3:2 composition. A large ivory paper weekly planning grid on a warm off-white desk, slim matte navy task cards neatly placed into distinct adjacent non-overlapping time slots, one translucent pale blue card slightly hovering above an empty slot, an understated brushed steel clock and dark blue pen at the edge. Precise professional composition, tactile paper, soft natural side lighting, very restrained navy #193652, slate blue, pale cyan and warm white palette. Subtle realistic depth, premium annual-report art direction, calm and orderly. No legible text, no letters, no numbers, no logos, no people. No pink or magenta anywhere. This is a conceptual thematic image, not a screenshot or UI mockup. High detail for print.

## Доказательства

Итог: 554 успешных теста (на 19 больше, чем в 6.15.0), включая настоящий SQL Server в отдельной тестовой базе. Пройдены типизация, линтер и сборка IIS. Миграция добавляет nullable-столбец `tc_units.manages_parent`; рабочие записи, дополнительные корпоративные объекты и параметры подключения сохраняются. Развёртывание на корпоративном IIS не выполнялось.

PDF предназначен также для вложения в выпуск GitHub v6.16.0.
