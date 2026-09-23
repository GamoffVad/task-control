// Выгрузка «Планирования»: перечень мероприятий недели в CSV и данные для документа по шаблону.

import { categoryLabel, department, fullName, shortName } from './data';
import { addDays, fmtDate, fmtRange, toDateKey } from './dates';
import { csvEscape, isOverdue, tasksInWeek } from './logic';
import type { TemplateContext } from './templates';
import type { PlanRow, Task, User } from './types';

type Item = { row: PlanRow | null; task: Task };

const topSection = (rows: PlanRow[], id: string): PlanRow | undefined => rows.find((r) => r.id === id.split('.')[0]);

/** Мероприятия недели в порядке плана; только задачи выбранных сотрудников. */
export const planItems = (tasks: Task[], rows: PlanRow[], weekStart: Date, people: number[]): Item[] => {
  const shown = new Set(people);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const order = new Map(rows.map((r, i) => [r.id, i]));
  return tasksInWeek(tasks, weekStart)
    .filter((t) => t.assigneeIds.some((a) => shown.has(a)))
    .map((task) => ({ row: task.rowId ? byId.get(task.rowId) ?? null : null, task }))
    .sort((a, b) => (order.get(a.task.rowId ?? '') ?? 1e9) - (order.get(b.task.rowId ?? '') ?? 1e9) || a.task.end.localeCompare(b.task.end));
};

const status = (t: Task, now: Date) => (t.done ? 'исполнено' : isOverdue(t, now) ? 'просрочено' : 'в работе');
const doc = (t: Task) => [t.docName, t.docNumber && `№ ${t.docNumber}`].filter(Boolean).join(' ');

export const planToCsv = (items: Item[], rows: PlanRow[], now: Date = new Date()): string => {
  const head = ['Раздел', 'Позиция', 'Наименование позиции', 'Мероприятие', 'Срок', 'Исполнители', 'Категория', 'Статус', 'Документ', 'Результат'];
  const lines = items.map(({ row, task }) =>
    [
      row ? topSection(rows, row.id)?.title ?? row.id.split('.')[0] : '',
      row?.id ?? 'вне плана',
      row?.title ?? '',
      task.title,
      toDateKey(new Date(task.end)),
      task.assigneeIds.map(fullName).join(', '),
      categoryLabel(task.category),
      status(task, now),
      doc(task),
      task.result,
    ]
      .map(csvEscape)
      .join(';'),
  );
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
};

/** Данные для шаблона: разделы верхнего уровня → позиции → мероприятия. */
export const planDocContext = (items: Item[], rows: PlanRow[], weekStart: Date, user: User | null, now: Date = new Date()): TemplateContext => {
  const sections: TemplateContext[] = [];
  const bySection = new Map<string, Map<string, Item[]>>();
  for (const it of items) {
    const code = it.row ? it.row.id.split('.')[0] : 'вне плана';
    const pos = it.row?.id ?? 'вне плана';
    if (!bySection.has(code)) bySection.set(code, new Map());
    const positions = bySection.get(code)!;
    if (!positions.has(pos)) positions.set(pos, []);
    positions.get(pos)!.push(it);
  }
  let n = 0;
  for (const [code, positions] of bySection) {
    const section = rows.find((r) => r.id === code);
    sections.push({
      код: code === 'вне плана' ? '—' : code,
      раздел: section?.title ?? 'Вне плана',
      позиции: [...positions.entries()].map(([pos, list]) => ({
        код: pos === 'вне плана' ? '—' : pos,
        позиция: list[0].row?.title ?? 'Вне плана',
        мероприятия: list.map(({ task }) => ({
          '№': ++n,
          название: task.title.replace(/\s+/g, ' ').trim(),
          срок: fmtDate(new Date(task.end)),
          исполнители: task.assigneeIds.map(shortName).join(', '),
          категория: categoryLabel(task.category),
          статус: status(task, now),
          документ: doc(task),
          результат: task.result,
        })),
      })),
    });
  }
  const weekEnd = addDays(weekStart, 6);
  return {
    отдел: department.name,
    неделя: fmtRange(weekStart, weekEnd),
    год: weekStart.getFullYear(),
    с: fmtDate(weekStart),
    по: fmtDate(weekEnd),
    дата: fmtDate(now),
    составил: user ? shortName(user.employeeId) : '',
    всего: items.length,
    разделы: sections,
  };
};
