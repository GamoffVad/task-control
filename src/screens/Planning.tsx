import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTaskEditor } from '../components/taskEditor';
import { EmployeeFilter, GroupFilter } from '../components/ui';
import { FilterCard, PageHeader, Stepper } from '../kit';
import { Icon } from '../components/Icons';
import { absenceType, categoryLabel, employees, groupMembers, shortName } from '../lib/data';
import { addDays, fmtDate, fmtDateTime, fmtRange, planWeekStart, plural, startOfDay, toDateKey } from '../lib/dates';
import { planDocContext, planItems, planToCsv } from '../lib/planExport';
import { saveFile } from '../lib/download';
import { DocumentDialog } from '../components/DocumentDialog';
import { buildReportEntries, cellKey, findReport, groupByCell, isOverdue, tasksInWeek } from '../lib/logic';
import { isManager } from '../lib/permissions';
import { visibleBottom } from '../lib/viewport';
import { useStore } from '../lib/store';
import { useClashes } from '../lib/useClashes';
import { absenceInPeriod, fmtSpan, type Clash } from '../lib/absences';
import { AbsentTag } from '../components/AbsentTag';
import type { Task } from '../lib/types';

export const Planning = () => {
  const { state, dispatch } = useStore();
  const { openTask } = useTaskEditor();
  const manager = isManager(state.user);
  const me = state.user?.employeeId ?? 0;
  const [weekStart, setWeekStart] = useState(() => planWeekStart(new Date()));
  const [group, setGroup] = useState('all');
  const [employee, setEmployee] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const now = new Date();
  const clashes = useClashes();

  // Матрица занимает высоту окна и прокручивается внутри себя, как «Тетрис»:
  // фамилии закреплены сверху, позиции плана — слева, полоса прокрутки всегда видна.
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Под матрицей — легенда: оставляем место и для неё.
      const below = (el.nextElementSibling as HTMLElement | null)?.offsetHeight ?? 0;
      el.style.setProperty('--plan-max', `${Math.max(320, Math.floor(visibleBottom() - top - below - 26))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  const weekTasks = useMemo(() => tasksInWeek(state.tasks, weekStart), [state.tasks, weekStart]);
  const cells = useMemo(() => groupByCell(weekTasks), [weekTasks]);
  // Исполнитель видит и планирует только свой столбец.
  // Руководитель сужает матрицу до группы отдела, а внутри неё — до одного сотрудника.
  const people = groupMembers(group);
  const shownId = manager ? employee : me;
  const columns = shownId ? employees.filter((e) => e.id === shownId) : people;
  const [docOpen, setDocOpen] = useState(false);
  const items = useMemo(() => planItems(state.tasks, state.planRows, weekStart, columns.map((e) => e.id)), [state.tasks, state.planRows, weekStart, columns]);
  const exportCsv = () => saveFile(`plan-${toDateKey(weekStart)}.csv`, planToCsv(items, state.planRows), 'text/csv;charset=utf-8');

  const changeGroup = (g: string) => {
    setGroup(g);
    // Сотрудник из другой группы сбрасывается, иначе матрица показала бы человека вне выбранной группы.
    if (employee && !groupMembers(g).some((e) => e.id === employee)) setEmployee(null);
  };
  const weekEnd = addDays(weekStart, 6);
  const report = findReport(state.reports, weekStart);
  const doneCount = useMemo(() => buildReportEntries(state, weekStart).length, [state, weekStart]);
  const unplanned = weekTasks.filter((t) => !t.rowId && (manager || t.assigneeIds.includes(me))).length;

  const move = (dir: number) => {
    setWeekStart((w) => addDays(w, 7 * dir));
    setStatus(null);
  };

  const createInCell = (rowId: string, employeeId: number) => {
    const today = startOfDay(now);
    const day = today >= weekStart && today <= weekEnd ? today : weekStart;
    const start = new Date(day);
    start.setHours(16, 0, 0, 0);
    const row = state.planRows.find((r) => r.id === rowId);
    openTask({
      defaults: {
        rowId,
        assigneeIds: [employeeId],
        start: start.toISOString(),
        end: new Date(start.getTime() + 2 * 3600_000).toISOString(),
      },
      context: `${rowId} ${row?.title ?? ''} · ${shortName(employeeId)}`,
    });
  };

  const submit = () => {
    if (doneCount === 0) {
      setStatus({ ok: false, text: 'За эту неделю нет исполненных задач с позицией плана: отметьте исполнение в карточке задачи.' });
      return;
    }
    dispatch({ type: 'submitReport', weekStart });
    setStatus({
      ok: true,
      text: `${report ? 'Отчёт обновлён' : 'Отчёт отправлен'}: ${doneCount} ${plural(doneCount, 'запись', 'записи', 'записей')}. Он доступен в разделе «Отчётность».`,
    });
  };

  return (
    <>
      <PageHeader
        title="Планирование"
        subtitle={
          <>
            {manager ? 'Плановые мероприятия' : 'Ваши плановые мероприятия'} на неделю <b>{fmtRange(weekStart, weekEnd)}</b>. Плановая неделя начинается в пятницу.
          </>
        }
        actions={
          <>
            {/* Выгрузка перечня мероприятий недели и документ по шаблону — по выбранным сотрудникам. */}
            <button type="button" className="btn" onClick={() => setDocOpen(true)}>
              Документ
            </button>
            {manager && (
              <button type="button" className="btn btn--primary" onClick={submit}>
                <Icon.Send size={15} /> {report ? 'Обновить отчёт' : 'Направить в отчёт'}
              </button>
            )}
          </>
        }
      />
      <div className="filters">
        <FilterCard label="Плановая неделя">
          <Stepper label="Неделя" value={fmtRange(weekStart, weekEnd)} onPrev={() => move(-1)} onNext={() => move(1)} onToday={() => setWeekStart(planWeekStart(new Date()))} todayLabel="Текущая" />
        </FilterCard>
        {manager && (
          <FilterCard label="Группа">
            <GroupFilter value={group} onChange={changeGroup} />
          </FilterCard>
        )}
        <FilterCard label="Сотрудник">
          {manager ? (
            <EmployeeFilter value={employee} onChange={setEmployee} people={people} allLabel={group === 'all' ? 'Все сотрудники' : 'Вся группа'} />
          ) : (
            <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 700 }}>{shortName(me)}</div>
          )}
        </FilterCard>
        <FilterCard label="Отчёт за неделю">
          <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', fontSize: 13 }}>
            {report ? (
              <span className="ok" style={{ fontWeight: 600 }}>отправлен {fmtDateTime(new Date(report.submittedAt))}</span>
            ) : (
              <span className="muted">
                не отправлен{manager && <> · исполнено <span className="num">{doneCount}</span></>}
              </span>
            )}
          </div>
        </FilterCard>
      </div>

      {status && (
        <p className={`status ${status.ok ? 'ok' : 'err'}`} role="status" style={{ margin: '12px 0 0' }}>{status.text}</p>
      )}

      <div className="plan-wrap" ref={wrap}>
        <table className="plan-table">
          <thead>
            <tr>
              <th className="sticky-col pos-cell">Разделы планирования</th>
              {columns.map((e) => (
                <th key={e.id} className="emp">
                  {shortName(e.id)}
                  {(() => {
                    // Отсутствие на выбранной неделе — красная точка у фамилии, подробности в подсказке.
                    const a = absenceInPeriod(state.absences, e.id, weekStart, weekEnd);
                    return a && <AbsentTag absence={a} from={weekStart} dot />;
                  })()}
                  <span className="pos">{e.position}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.planRows.map((row) =>
              row.isHeader ? (
                <tr key={row.id} className="section">
                  <td className="sticky-col pos-cell">
                    <span className="code">{row.id}</span>
                    {row.title}
                  </td>
                  <td colSpan={columns.length} />
                </tr>
              ) : (
                <Fragment key={row.id}>
                  <tr>
                    <td className="sticky-col pos-cell">
                      <span className="code">{row.id}</span>
                      {row.title}
                    </td>
                    {columns.map((e) => {
                      const list = cells.get(cellKey(row.id, e.id)) ?? [];
                      const canAdd = manager || e.id === me;
                      return (
                        <td key={e.id} className="cell">
                          {list.map((t) => (
                            <TaskChip key={t.id} task={t} now={now} clash={clashes.find((c) => c.task.id === t.id && c.employeeId === e.id)} onOpen={() => openTask({ task: t, context: `${row.id} ${row.title}` })} />
                          ))}
                          {canAdd && (
                            <button
                              type="button"
                              className={`cell-add ${list.length ? 'more' : 'empty'}`}
                              onClick={() => createInCell(row.id, e.id)}
                              aria-label={`Добавить задачу — ${row.id} ${row.title}, ${shortName(e.id)} (задач: ${list.length})`}
                            >
                              + задача
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ),
            )}
          </tbody>
        </table>
      </div>
      {/* Легенда под матрицей — матрице достаётся вся высота окна. */}
      <div className="legend" style={{ margin: '10px 0 0' }}>
        <span><i />в работе</span>
        <span><i className="done" />исполнено</span>
        <span><i className="overdue" />просрочено</span>
        {unplanned > 0 && <span className="amber">Вне плана на этой неделе: <span className="num">{unplanned}</span> — они видны в Календаре и Контроле</span>}
      </div>
      {docOpen && <DocumentDialog templates={state.templates.filter((t) => t.scope === 'planning')} context={planDocContext(items, state.planRows, weekStart, state.user)} fileBase={`plan-${toDateKey(weekStart)}`} source="Текст собирается из мероприятий недели в «Планировании»" onCsv={exportCsv} onClose={() => setDocOpen(false)} />}
    </>
  );
};

const TaskChip = ({ task, now, clash, onOpen }: { task: Task; now: Date; clash?: Clash; onOpen: () => void }) => {
  const overdue = isOverdue(task, now);
  const cls = task.done ? ' done' : overdue ? ' overdue' : '';
  return (
    <button type="button" className={`chip${cls}`} onClick={onOpen}>
      {task.category && (
        <i className="cat-dot" style={{ background: `var(--cat-${task.category})` }} data-tip={categoryLabel(task.category)} aria-label={categoryLabel(task.category)} />
      )}
      {task.title}
      <span className="meta">
        {task.done ? '✓ исполнено' : overdue ? 'просрочено · ' : 'до '}
        {!task.done && fmtDate(new Date(task.end))}
      </span>
      {clash && (
        <span className="meta absent-mark" data-tip={clash.absence.note}>
          {absenceType(clash.absence.type).label.toLowerCase()} {fmtSpan(clash.absence)}
          {clash.absence.status === 'request' && ' (заявка)'}
        </span>
      )}
    </button>
  );
};
