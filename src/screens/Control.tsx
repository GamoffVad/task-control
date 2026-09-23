import { useMemo, useState } from 'react';
import { useTaskEditor } from '../components/taskEditor';
import { EmployeeFilter } from '../components/ui';
import { FilterCard, MultiSelect, PageHeader, type MultiOption } from '../kit';
import { Icon } from '../components/Icons';
import { absenceType, shortName } from '../lib/data';
import { useCategoryOptions, type CatKey } from '../lib/categories';
import { defaultDeadlineFor, fmtDate, fmtTime, startOfDay, toDateKey } from '../lib/dates';
import { bucketize } from '../lib/logic';
import { controlWordHtml } from '../lib/controlExport';
import { saveFile } from '../lib/download';
import { isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import { useClashes } from '../lib/useClashes';
import { fmtSpan } from '../lib/absences';
import type { DeadlineBucket, Task } from '../lib/types';

type DoneKey = 'done' | 'open';
const DONE_OPTIONS: MultiOption<DoneKey>[] = [
  { value: 'done', label: 'Исполненные' },
  { value: 'open', label: 'В работе' },
];

const COLUMNS: { key: DeadlineBucket; title: string; canAdd: boolean }[] = [
  { key: 'overdue', title: 'Просроченные', canAdd: false },
  { key: 'today', title: 'Сегодня', canAdd: true },
  { key: 'week', title: 'На этой неделе', canAdd: true },
  { key: 'nextWeek', title: 'На следующей неделе', canAdd: true },
  { key: 'month', title: 'В течение месяца', canAdd: true },
  { key: 'quarter', title: 'В течение квартала', canAdd: true },
];
const COLUMN_OPTIONS: MultiOption<DeadlineBucket>[] = COLUMNS.map((c) => ({ value: c.key, label: c.title }));
const ALL_COLUMNS = COLUMNS.map((c) => c.key);

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
  const { keys: allCats, options: catOptions } = useCategoryOptions();
  // Хранятся снятые категории: новая категория из словаря сразу попадает в отбор.
  const [hiddenCats, setHiddenCats] = useState<CatKey[]>([]);
  const cats = useMemo(() => allCats.filter((k) => !hiddenCats.includes(k)), [allCats, hiddenCats]);
  const [columns, setColumns] = useState<DeadlineBucket[]>(ALL_COLUMNS);
  // По умолчанию доска показывает задачи в работе; исполненные добавляются отметкой в фильтре и видны бледными.
  const [done, setDone] = useState<DoneKey[]>(['open']);
  const now = new Date();
  const clashes = useClashes();
  // Сводка над доской считается по всем задачам сотрудника, независимо от фильтров.
  const all = useMemo(() => bucketize(state.tasks, employee), [state.tasks, employee]);
  const shown = useMemo(() => {
    const catSet = new Set(cats);
    const tasks = state.tasks.filter((t) => catSet.has((t.category ?? 'none') as CatKey) && (t.done ? done.includes('done') : done.includes('open')));
    return bucketize(tasks, employee, new Date(), { includeDone: true });
  }, [state.tasks, employee, cats, done]);
  const open = Object.values(all).reduce((s, l) => s + l.length, 0);
  const visible = COLUMNS.filter((c) => columns.includes(c.key));

  const exportWord = () => {
    const parts = [
      `Сотрудник: ${employee === null ? 'все' : shortName(employee)}`,
      `категории: ${cats.length === allCats.length ? 'все' : catOptions.filter((o) => cats.includes(o.value)).map((o) => o.label.toLowerCase()).join(', ')}`,
      `сроки: ${columns.length === ALL_COLUMNS.length ? 'все' : visible.map((c) => c.title.toLowerCase()).join(', ')}`,
      `исполнение: ${done.length === 2 ? 'исполненные и в работе' : done.includes('done') ? 'исполненные' : 'в работе'}`,
    ];
    const html = controlWordHtml(visible.map((c) => ({ key: c.key, title: c.title, tasks: shown[c.key] })), state.planRows, parts.join('; '), now);
    saveFile(`kontrol-${toDateKey(now)}.doc`, html, 'application/msword');
  };

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
        subtitle="Задачи по срокам. Фильтры отбирают сотрудника, категории, сроки и исполнение; исполненные задачи показаны бледными."
        actions={
          <button type="button" className="btn" onClick={exportWord}>
            <Icon.Download size={15} /> Выгрузить в Word
          </button>
        }
      />
      <div className="filters">
        <FilterCard label="Сотрудник">
          {manager ? (
            <EmployeeFilter value={employee} onChange={setEmployee} />
          ) : (
            <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 700 }}>{shortName(employee)}</div>
          )}
        </FilterCard>
        <FilterCard label="Категории">
          <MultiSelect<CatKey> label="Категории задач" allLabel="все категории" options={catOptions} value={cats} onChange={(shown) => setHiddenCats(allCats.filter((k) => !shown.includes(k)))} />
        </FilterCard>
        <FilterCard label="Сроки">
          <MultiSelect<DeadlineBucket> label="Сроки" allLabel="все сроки" options={COLUMN_OPTIONS} value={columns} onChange={setColumns} />
        </FilterCard>
        <FilterCard label="Исполнение">
          <MultiSelect<DoneKey> label="Исполнение" allLabel="исполненные и в работе" options={DONE_OPTIONS} value={done} onChange={setDone} />
        </FilterCard>
        <FilterCard label="В работе">
          <div className="num" style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>{open}</div>
        </FilterCard>
        <FilterCard label="Просрочено">
          <div className={`num${all.overdue.length ? ' danger' : ''}`} style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>
            {all.overdue.length}
          </div>
        </FilterCard>
        <FilterCard label="Позже квартала">
          <div className="num" style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>{all.later.length}</div>
        </FilterCard>
      </div>

      <div className="board">
        {visible.map((col) => {
          const list = shown[col.key];
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
                const late = col.key === 'overdue' && !t.done ? daysLate(t, now) : 0;
                return (
                  <button key={t.id} type="button" className={`task-card${col.key === 'overdue' && !t.done ? ' overdue' : ''}${t.done ? ' done' : ''}`} onClick={() => openTask({ task: t })}>
                    <div className="title">{t.done && <span className="state ok" aria-label="исполнено">✓ </span>}{t.title}</div>
                    <div className="row">{row ? `${row.id} ${row.title}` : 'Вне плана'}</div>
                    {!t.done &&
                      clashes
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
      {all.later.length > 0 && (
        <p className="help-note" style={{ marginTop: 16 }}>
          Задач со сроком дальше квартала: <span className="num">{all.later.length}</span>. Они появятся на доске, когда срок приблизится, а пока видны в Календаре.
        </p>
      )}
    </>
  );
};
