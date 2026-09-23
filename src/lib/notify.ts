// Уведомления сотрудникам: какие события произошли в результате действия и кому о них сообщить.
// Сервер сравнивает данные до и после действия и записывает уведомления в журнал; открытая вкладка приложения
// забирает свои уведомления и показывает их средствами Chrome. Всё работает внутри корпоративной сети, без интернета.

import { shortName } from './data';
import type { Absence, Data, ManagedUser, Permission, Task, User } from './types';

export type NoticeEvent = {
  /** Кому: сотрудники (employeeId). */
  to: number[];
  title: string;
  body: string;
  /** Страница приложения, которая откроется по нажатию на уведомление. */
  url: string;
};

/** Часовой пояс для дат в тексте уведомлений: функции сервера работают в UTC. */
export const NOTIFY_TIME_ZONE = 'Europe/Moscow';

const fmt = (iso: string, withTime: boolean, timeZone: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
/** YYYY-MM-DD → ДД.ММ */
const dm = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

const can = (data: Data, u: ManagedUser, permission: Permission) => data.roles.find((r) => r.role === u.role)?.permissions.includes(permission) ?? false;
const holders = (data: Data, permission: Permission) => data.users.filter((u) => u.active && can(data, u, permission)).map((u) => u.employeeId);
const others = (ids: number[], actor: number) => [...new Set(ids)].filter((id) => id !== actor);

const absenceTitle = (data: Data, a: Absence) =>
  data.dictionaries.find((d) => d.dictionary === 'absenceType' && d.code === a.type)?.title.toLowerCase() ?? a.type;
const absenceRange = (a: Absence) => (a.to ? `${dm(a.from)}–${dm(a.to)}` : `с ${dm(a.from)}`);

/** События действия `actor`: сравнение данных до и после. */
export const detectEvents = (before: Data, after: Data, actor: User, timeZone = NOTIFY_TIME_ZONE): NoticeEvent[] => {
  const events: NoticeEvent[] = [];
  const me = actor.employeeId;
  const who = shortName(me);

  // Переписка: новое сообщение — всем, кроме автора.
  const oldMessages = new Set(before.messages.map((m) => m.id));
  for (const m of after.messages.filter((x) => !oldMessages.has(x.id))) {
    const to = others(after.users.filter((u) => u.active).map((u) => u.employeeId), m.authorId);
    if (to.length) events.push({ to, title: `Переписка · ${shortName(m.authorId)}`, body: clip(m.text, 180), url: '/chat' });
  }

  // Задачи: назначение, перенос срока, исполнение.
  const oldTasks = new Map(before.tasks.map((t) => [t.id, t]));
  const deadline = (t: Task) => `Срок: ${fmt(t.end, true, timeZone)}`;
  for (const t of after.tasks) {
    const was = oldTasks.get(t.id);
    const added = others(t.assigneeIds.filter((id) => !was?.assigneeIds.includes(id)), me);
    if (added.length) {
      events.push({ to: added, title: was ? 'Вам назначена задача' : 'Новая задача', body: `${clip(t.title, 140)}\n${deadline(t)} · ${who}`, url: '/control' });
    }
    if (!was) continue;
    const kept = others(t.assigneeIds.filter((id) => was.assigneeIds.includes(id)), me);
    if (was.end !== t.end && !t.done && kept.length) {
      events.push({ to: kept, title: 'Изменён срок задачи', body: `${clip(t.title, 140)}\nНовый ${deadline(t).toLowerCase()} · ${who}`, url: '/control' });
    }
    if (!was.done && t.done) {
      const to = others(holders(after, 'tasks.plan'), me);
      if (to.length) events.push({ to, title: `Задача исполнена · ${who}`, body: clip(`${t.title}${t.result ? `. ${t.result}` : ''}`, 200), url: '/control' });
    }
  }

  // Отсутствия: новая заявка — тем, кто согласует; решение — сотруднику.
  const oldAbsences = new Map(before.absences.map((a) => [a.id, a]));
  for (const a of after.absences) {
    const was = oldAbsences.get(a.id);
    if (a.status === 'request' && (!was || was.status !== 'request')) {
      const to = others(holders(after, 'absences.manage'), me);
      if (to.length) events.push({ to, title: 'Заявка на отсутствие', body: `${shortName(a.employeeId)}: ${absenceTitle(after, a)} ${absenceRange(a)}${a.note ? `. ${clip(a.note, 100)}` : ''}`, url: '/tetris' });
    }
    if (was?.status === 'request' && (a.status === 'approved' || a.status === 'rejected') && a.employeeId !== me) {
      events.push({
        to: [a.employeeId],
        title: a.status === 'approved' ? 'Заявка согласована' : 'Заявка отклонена',
        body: `${absenceTitle(after, a)} ${absenceRange(a)} · ${who}`,
        url: '/tetris',
      });
    }
  }

  // Отчёт недели: руководителям — что отчёт направлен, исполнителям — начисленные баллы.
  const oldReports = new Map(before.reports.map((r) => [r.weekStart, r.submittedAt]));
  for (const r of after.reports.filter((x) => oldReports.get(x.weekStart) !== x.submittedAt)) {
    const start = new Date(`${r.weekStart}T12:00:00Z`);
    const end = new Date(start.getTime() + 6 * 86400000);
    const week = `${dm(r.weekStart)}–${dm(end.toISOString().slice(0, 10))}`;
    const total = r.entries.reduce((s, e) => s + e.score, 0);
    const heads = others(holders(after, 'reports.view'), me);
    if (heads.length) events.push({ to: heads, title: 'Отчёт за неделю направлен', body: `Неделя ${week}: записей ${r.entries.length}, баллов ${pts(total)} · ${who}`, url: '/reports' });
    const byPerson = new Map<number, { n: number; score: number }>();
    for (const e of r.entries) {
      const p = byPerson.get(e.assigneeId) ?? { n: 0, score: 0 };
      byPerson.set(e.assigneeId, { n: p.n + 1, score: p.score + e.score });
    }
    for (const [id, p] of byPerson) {
      if (id === me) continue;
      events.push({ to: [id], title: 'Начислены баллы', body: `Неделя ${week}: ${pts(p.score)} балл. за ${p.n} мероприят.`, url: '/employees' });
    }
  }
  return events;
};

/** Ежедневное напоминание о просрочке: неисполненные задачи сотрудника со сроком раньше сегодняшнего дня. */
export const overdueNotice = (data: Data, employeeId: number, now: Date, timeZone = NOTIFY_TIME_ZONE): NoticeEvent | null => {
  const todayKey = dayKey(now, timeZone);
  const mine = data.tasks
    .filter((t) => !t.done && t.assigneeIds.includes(employeeId) && dayKey(new Date(t.end), timeZone) < todayKey)
    .sort((a, b) => a.end.localeCompare(b.end));
  if (!mine.length) return null;
  const list = mine.slice(0, 3).map((t) => `• ${clip(t.title, 70)} (${fmt(t.end, false, timeZone).slice(0, 5)})`).join('\n');
  return { to: [employeeId], title: `Просроченные задачи: ${mine.length}`, body: mine.length > 3 ? `${list}\n…и ещё ${mine.length - 3}` : list, url: '/control' };
};

/** День по часовому поясу отдела: YYYY-MM-DD. */
export const dayKey = (d: Date, timeZone = NOTIFY_TIME_ZONE) => d.toLocaleDateString('sv-SE', { timeZone });
/** Час по часовому поясу отдела. */
export const hourOf = (d: Date, timeZone = NOTIFY_TIME_ZONE) => Number(d.toLocaleString('en-GB', { timeZone, hour: '2-digit', hour12: false }).slice(0, 2));
