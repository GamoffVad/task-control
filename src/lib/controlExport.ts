// Выгрузка «Контроля» в Word: то, что сейчас на доске, — раздел на каждую колонку срока.

import { categoryLabel, shortName } from './data';
import { fmtDate, fmtDateTime, startOfDay } from './dates';
import { wordDocument, wordTable } from './wordDoc';
import type { DeadlineBucket, PlanRow, Task } from './types';

export type ControlColumn = { key: DeadlineBucket; title: string; tasks: Task[] };

const days = (t: Task, now: Date) => Math.round((startOfDay(now).getTime() - startOfDay(new Date(t.end)).getTime()) / 86_400_000);

const state = (t: Task, key: DeadlineBucket, now: Date) => {
  if (t.done) return `исполнено${t.doneAt ? ` ${fmtDate(new Date(t.doneAt))}` : ''}`;
  if (key !== 'overdue') return 'в работе';
  const late = days(t, now);
  return late > 0 ? `просрочено на ${late} дн.` : 'просрочено';
};

/** Документ Word: заголовок, строка с условиями отбора и таблица по каждой видимой колонке. */
export const controlWordHtml = (columns: ControlColumn[], rows: PlanRow[], filters: string, now: Date = new Date()): string => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sections = columns
    .filter((c) => c.tasks.length > 0)
    .map((c) => {
      const table = wordTable(
        ['№', 'Задача', 'Раздел планирования', 'Исполнители', 'Срок', 'Состояние'],
        c.tasks.map((t, i) => [
          String(i + 1),
          t.title.replace(/\s+/g, ' ').trim(),
          t.rowId ? `${t.rowId} ${byId.get(t.rowId)?.title ?? ''}`.trim() : 'вне плана',
          t.assigneeIds.map(shortName).join(', ') || '—',
          c.key === 'today' ? fmtDateTime(new Date(t.end)) : fmtDate(new Date(t.end)),
          `${state(t, c.key, now)}${t.category ? `; ${categoryLabel(t.category).toLowerCase()}` : ''}`,
        ]),
      );
      return `<h2>${c.title} — ${c.tasks.length}</h2>${table}`;
    })
    .join('');
  const total = columns.reduce((s, c) => s + c.tasks.length, 0);
  const body = `<h1>Контроль исполнения</h1><p class="sub">${filters}. Выгружено ${fmtDateTime(now)}. Всего задач: ${total}.</p>${
    sections || '<p>По выбранным условиям задач нет.</p>'
  }`;
  return wordDocument('Контроль исполнения', body);
};
