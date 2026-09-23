import { useMemo, useState } from 'react';
import { useTaskEditor } from '../components/taskEditor';
import { EmployeeFilter } from '../components/ui';
import { FilterCard, PageHeader } from '../kit';
import { Icon } from '../components/Icons';
import { absenceType, shortName } from '../lib/data';
import { defaultDeadlineFor, fmtDate, fmtTime, startOfDay } from '../lib/dates';
import { bucketize } from '../lib/logic';
import { isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import { useClashes } from '../lib/useClashes';
import { fmtSpan } from '../lib/absences';
import type { DeadlineBucket, Task } from '../lib/types';

const COLUMNS: { key: DeadlineBucket; title: string; canAdd: boolean }[] = [
  { key: 'overdue', title: 'Просроченные', canAdd: false },
  { key: 'today', title: 'Сегодня', canAdd: true },
  { key: 'week', title: 'На этой неделе', canAdd: true },
  { key: 'nextWeek', title: 'На следующей неделе', canAdd: true },
  { key: 'month', title: 'В течение месяца', canAdd: true },
  { key: 'quarter', title: 'В течение квартала', canAdd: true },
];

const EMPTY: Record<DeadlineBucket, string> = {
  overdue: 'Просроченных задач нет',
  today: 'На сегодня задач нет',
  week: 'Задач нет',
  nextWeek: 'Задач нет',
  month: 'Задач нет',
  quarter: 'Задач нет',
  later: 'Задач нет',
};

const daysLate = (t: Task, now: Date) => Math.round((startOfDay(now).getTime() - startOfDay(new Date(t.end)).getTime()) / 86_400_000);

export const Control = () => {
  const { state } = useStore();
  const { openTask } = useTaskEditor();
  const manager = isManager(state.user);
  const [chosen, setEmployee] = useState<number | null>(null);
  // Исполнитель контролирует только свои задачи.
  const employee = manager ? chosen : (state.user?.employeeId ?? null);
  const now = new Date();
  const clashes = useClashes();
  const buckets = useMemo(() => bucketize(state.tasks, employee), [state.tasks, employee]);
  const open = Object.values(buckets).reduce((s, l) => s + l.length, 0);

  const add = (bucket: DeadlineBucket) => {
    const end = defaultDeadlineFor(bucket);
    const start = new Date(end.getTime() - 3600_000);
    openTask({
      defaults: { start: start.toISOString(), end: end.toISOString(), assigneeIds: employee ? [employee] : [] },
      context: `Срок по умолчанию: ${fmtDate(end)}`,
    });
  };

  return (
    <>
      <PageHeader
        title="Контроль исполнения"
        subtitle="Неисполненные задачи, распределённые по срокам. Исполненные задачи сюда не попадают."
      />
      <div className="filters">
        <FilterCard label="Сотрудник">
          {manager ? (
            <EmployeeFilter value={employee} onChange={setEmployee} />
          ) : (
            <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 700 }}>{shortName(employee)}</div>
          )}
        </FilterCard>
        <FilterCard label="В работе">
          <div className="num" style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>{open}</div>
        </FilterCard>
        <FilterCard label="Просрочено">
          <div className={`num${buckets.overdue.length ? ' danger' : ''}`} style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>
            {buckets.overdue.length}
          </div>
        </FilterCard>
        <FilterCard label="Позже квартала">
          <div className="num" style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>{buckets.later.length}</div>
        </FilterCard>
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const list = buckets[col.key];
          return (
            <section key={col.key} className={`column column--${col.key}`} aria-label={col.title}>
              <div className="column-head">
                <h2>
                  {col.title} <span className="num">{list.length}</span>
                </h2>
                {col.canAdd && (
                  <button type="button" className="icon-btn" onClick={() => add(col.key)} aria-label={`Добавить задачу: ${col.title.toLowerCase()}`} data-tip="Добавить задачу">
                    <Icon.Plus size={14} />
                  </button>
                )}
              </div>
              {list.length === 0 && <p className="empty">{EMPTY[col.key]}</p>}
              {list.map((t) => {
                const row = t.rowId ? state.planRows.find((item) => item.id === t.rowId) : null;
                const late = col.key === 'overdue' ? daysLate(t, now) : 0;
                return (
                  <button key={t.id} type="button" className={`task-card${col.key === 'overdue' ? ' overdue' : ''}`} onClick={() => openTask({ task: t })}>
                    <div className="title">{t.title}</div>
                    <div className="row">{row ? `${row.id} ${row.title}` : 'Вне плана'}</div>
                    {clashes
                      .filter((c) => c.task.id === t.id)
                      .map((c) => (
                        <div key={c.employeeId} className="row absent-mark">
                          {shortName(c.employeeId)} отсутствует: {absenceType(c.absence.type).label.toLowerCase()} {fmtSpan(c.absence)}
                          {c.absence.status === 'request' && ' (заявка)'}
                        </div>
                      ))}
                    <div className="meta">
                      <span>{t.assigneeIds.map(shortName).join(', ') || '—'}</span>
                      <span className="num">
                        {col.key === 'today' ? `до ${fmtTime(new Date(t.end))}` : fmtDate(new Date(t.end))}
                        {late > 0 && ` · ${late} дн.`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      {buckets.later.length > 0 && (
        <p className="help-note" style={{ marginTop: 16 }}>
          Задач со сроком дальше квартала: <span className="num">{buckets.later.length}</span>. Они появятся на доске, когда срок приблизится, а пока видны в Календаре.
        </p>
      )}
    </>
  );
};
