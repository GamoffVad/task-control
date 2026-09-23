import { describe, expect, it, vi } from 'vitest';
import { planDocContext, planItems, planToCsv } from '../lib/planExport';
import { createSeed } from '../lib/seed';
import { DEFAULT_TEMPLATES, parseTemplate, renderTemplate, templateScope } from '../lib/templates';
import { reportDocContext } from '../lib/reportExport';
import { controlWordHtml } from '../lib/controlExport';
import { bucketize } from '../lib/logic';
import type { Report } from '../lib/types';
import { planWeekStart } from '../lib/dates';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

const NOW = new Date(2026, 8, 17, 12, 0);

describe('выгрузка «Контроля» в Word', () => {
  it('раздел на колонку, таблица с задачами и строка условий отбора', () => {
    const state = createSeed(NOW);
    const buckets = bucketize(state.tasks, null, NOW, { includeDone: true });
    const html = controlWordHtml(
      [
        { key: 'overdue', title: 'Просроченные', tasks: buckets.overdue },
        { key: 'today', title: 'Сегодня', tasks: [] },
      ],
      state.planRows,
      'Сотрудник: все; категории: все',
      NOW,
    );
    expect(html).toContain('<h1>Контроль исполнения</h1>');
    expect(html).toContain('Сотрудник: все; категории: все');
    expect(html).toContain(`<h2>Просроченные — ${buckets.overdue.length}</h2>`);
    // Пустые колонки в документ не попадают.
    expect(html).not.toContain('Сегодня —');
    expect(html).toContain('<th>Раздел планирования</th>');
    expect(html).toContain('просрочено на');
    expect(html).toContain(state.tasks.find((t) => buckets.overdue.includes(t))!.title);
  });
});

describe('документ отчётности', () => {
  it('объединяет исполнителей задачи, считает баллы и срок исполнения', () => {
    const base = { rowId: '1.1', rowTitle: '', title: 'Справка', deadline: '2026-09-10T18:00:00.000Z', result: 'готово', docName: 'Справка', docNumber: '7', score: 2 };
    const report: Report = { weekStart: '2026-09-04', submittedAt: '2026-09-11T09:00:00.000Z', entries: [
      { ...base, taskId: 't1', assigneeId: 1, doneAt: '2026-09-09T10:00:00.000Z' },
      { ...base, taskId: 't1', assigneeId: 2, doneAt: '2026-09-09T10:00:00.000Z' },
      { ...base, taskId: 't2', assigneeId: 2, title: 'Поздно', score: 1, doneAt: '2026-09-12T10:00:00.000Z' },
    ] };
    const ctx = reportDocContext(report, createSeed(NOW).planRows, new Date(2026, 8, 4), null, NOW);
    expect(ctx.всего).toBe(2);
    expect(ctx.баллы).toBe('5');
    const [section] = ctx.разделы as Record<string, unknown>[];
    expect(section).toMatchObject({ код: '1', баллы: '5' });
    const events = (section.позиции as Record<string, unknown>[])[0].мероприятия as Record<string, unknown>[];
    expect(events.map((e) => [e.исполнители, e.баллы, e.статус])).toEqual([
      ['Иванов А.Б., Петров В.С.', '4', 'исполнено в срок'],
      ['Петров В.С.', '1', 'исполнено с нарушением срока'],
    ]);
    expect((ctx.сотрудники as Record<string, unknown>[]).map((p) => [p.сотрудник, p.баллы])).toEqual([['Иванов А.Б.', '2'], ['Петров В.С.', '3']]);
    const text = renderTemplate(DEFAULT_TEMPLATES.find((t) => t.scope === 'reports')!.body, ctx);
    expect(text).toMatch(/1\) Справка \(Иванов А\.Б\., Петров В\.С\.\) — исполнено в срок, 09\.09\.2026\. готово; документ: Справка № 7/);
    expect(text).toMatch(/Всего исполнено мероприятий: 2, баллов: 5\./);
  });

  it('раздел шаблонов, сохранённых до 5.3.0, определяется по идентификатору', () => {
    expect(templateScope({ id: 'tpl-plan-report' })).toBe('reports');
    expect(templateScope({ id: 'tpl-x', scope: null })).toBe('planning');
    expect(templateScope({ id: 'tpl-plan-report', scope: 'planning' })).toBe('planning');
  });
});

describe('шаблоны документов', () => {
  it('подставляет значения, повторяет блоки и показывает блок для пустого списка', () => {
    const tpl = 'Отдел: {{отдел}}\n{{#пункты}}\n- {{название}} ({{отдел}})\n{{/пункты}}\n{{^пусто}}\nничего\n{{/пусто}}\nВсего: {{пункты}}';
    const text = renderTemplate(tpl, { отдел: 'ОР', пункты: [{ название: 'А' }, { название: 'Б' }], пусто: [] });
    expect(text).toBe('Отдел: ОР\n- А (ОР)\n- Б (ОР)\nничего\nВсего: 2\n');
  });

  it('незакрытый или лишний блок — понятная ошибка', () => {
    expect(() => parseTemplate('{{#разделы}} текст')).toThrow(/не закрыт/);
    expect(() => parseTemplate('текст {{/разделы}}')).toThrow(/Лишний конец/);
  });

  it('документ «План мероприятий на неделю» собирается из «Планирования»', () => {
    const s = createSeed(NOW);
    const week = planWeekStart(NOW);
    const items = planItems(s.tasks, s.planRows, week, [1, 2, 3, 4, 5, 6, 7]);
    expect(items.length).toBeGreaterThan(0);
    const text = renderTemplate(DEFAULT_TEMPLATES[0].body, planDocContext(items, s.planRows, week, { email: 'user@example.com', employeeId: 1, role: 'administrator' }, NOW));
    expect(text).toMatch(/^ПЛАН МЕРОПРИЯТИЙ\nОтдел разработки на неделю 11 – 17 сентября 2026 г\./);
    expect(text).toContain('1. Организационные мероприятия');
    expect(text).toContain(`Всего мероприятий: ${items.length}.`);
    expect(text).toContain('Составил: Иванов А.Б., 17.09.2026');
    expect(text).not.toContain('{{');
  });

  it('CSV перечня мероприятий: заголовок, раздел, позиция, исполнители', () => {
    const s = createSeed(NOW);
    const items = planItems(s.tasks, s.planRows, planWeekStart(NOW), [1]);
    const csv = planToCsv(items, s.planRows, NOW);
    const [head, first] = csv.replace('\uFEFF', '').split('\r\n');
    expect(head).toBe('Раздел;Позиция;Наименование позиции;Мероприятие;Срок;Исполнители;Категория;Статус;Документ;Результат');
    expect(first).toContain('Иванов Алексей Борисович');
    expect(csv.split('\r\n')).toHaveLength(items.length + 1);
  });
});
