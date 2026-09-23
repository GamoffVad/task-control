// Документ «Отчётности»: данные отправленного отчёта для шаблона.

import { department, employees, fullName, shortName } from './data';
import { addDays, fmtDate, fmtDateTime, fmtNum, fmtRange } from './dates';
import { reportRows } from './logic';
import type { TemplateContext } from './templates';
import type { PlanRow, Report, ReportEntry, User } from './types';

/** Строки отчёта по исполнителям объединяются в мероприятия: одна задача — одна строка документа. */
const byTask = (entries: ReportEntry[]) => {
  const tasks = new Map<string, { entry: ReportEntry; assignees: number[]; score: number }>();
  for (const e of entries) {
    const t = tasks.get(e.taskId);
    if (t) {
      t.assignees.push(e.assigneeId);
      t.score += e.score;
    } else tasks.set(e.taskId, { entry: e, assignees: [e.assigneeId], score: e.score });
  }
  return [...tasks.values()];
};

/** Разделы верхнего уровня → позиции → исполненные мероприятия; итоги по сотрудникам. */
export const reportDocContext = (report: Report | undefined, rows: PlanRow[], weekStart: Date, user: User | null, now: Date = new Date()): TemplateContext => {
  const entries = report?.entries ?? [];
  const used = reportRows(entries, rows);
  const tasks = byTask(entries);
  let n = 0;
  const sections: TemplateContext[] = [];
  for (const head of used.filter((r) => r.isHeader && !r.id.includes('.'))) {
    const positions = used
      .filter((r) => !r.isHeader && r.id.split('.')[0] === head.id)
      .map((r) => ({ row: r, list: tasks.filter((t) => t.entry.rowId === r.id) }))
      .filter((p) => p.list.length > 0)
      .map(({ row, list }) => ({
        код: row.id,
        позиция: row.title,
        мероприятия: list.map(({ entry, assignees, score }) => {
          const late = new Date(entry.doneAt) > new Date(entry.deadline);
          return {
            '№': ++n,
            название: entry.title.replace(/\s+/g, ' ').trim(),
            срок: fmtDate(new Date(entry.deadline)),
            исполнено: fmtDate(new Date(entry.doneAt)),
            исполнители: assignees.map(shortName).join(', '),
            статус: late ? 'исполнено с нарушением срока' : 'исполнено в срок',
            документ: [entry.docName, entry.docNumber && `№ ${entry.docNumber}`].filter(Boolean).join(' '),
            результат: entry.result,
            баллы: fmtNum(score),
          };
        }),
      }));
    const sectionScore = tasks.filter((t) => t.entry.rowId.split('.')[0] === head.id).reduce((s, t) => s + t.score, 0);
    if (positions.length) sections.push({ код: head.id, раздел: head.title, баллы: fmtNum(sectionScore), позиции: positions });
  }
  const people = employees
    .map((e) => ({ id: e.id, list: entries.filter((x) => x.assigneeId === e.id) }))
    .filter((p) => p.list.length > 0)
    .map((p) => ({ сотрудник: shortName(p.id), фио: fullName(p.id), мероприятий: p.list.length, баллы: fmtNum(p.list.reduce((s, x) => s + x.score, 0)) }));
  const weekEnd = addDays(weekStart, 6);
  return {
    отдел: department.name,
    неделя: fmtRange(weekStart, weekEnd),
    год: weekStart.getFullYear(),
    с: fmtDate(weekStart),
    по: fmtDate(weekEnd),
    дата: fmtDate(now),
    составил: user ? shortName(user.employeeId) : '',
    получен: report ? fmtDateTime(new Date(report.submittedAt)) : '',
    всего: tasks.length,
    баллы: fmtNum(entries.reduce((s, e) => s + e.score, 0)),
    разделы: sections,
    сотрудники: people,
  };
};
