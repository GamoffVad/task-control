import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { AbsencePanel } from '../components/AbsencePanel';
import { useTaskEditor } from '../components/taskEditor';
import { PeriodPicker } from '../components/ui';
import { FilterCard } from '../kit';
import { department, employeeById, fullName, initials, shortName } from '../lib/data';
import { fmtDate, fmtNum, PERIOD_LABELS, plural } from '../lib/dates';
import { employeeScoreContext, entriesInPeriod, isOverdue } from '../lib/logic';
import { isManager } from '../lib/permissions';
import { absenceInPeriod } from '../lib/absences';
import { AbsentTag } from '../components/AbsentTag';
import { useStore } from '../lib/store';
import type { Period } from '../lib/types';

export const Employees = () => {
  const { id } = useParams();
  const { state } = useStore();
  const selected = id ? Number(id) : null;

  const counts = useMemo(() => {
    const m = new Map<number, { open: number; overdue: number }>();
    for (const t of state.tasks) {
      if (t.done) continue;
      for (const a of t.assigneeIds) {
        const c = m.get(a) ?? { open: 0, overdue: 0 };
        c.open += 1;
        if (isOverdue(t)) c.overdue += 1;
        m.set(a, c);
      }
    }
    return m;
  }, [state.tasks]);

  const me = state.user?.employeeId ?? 1;
  if (selected === null) return <Navigate to={`/employees/${me}`} replace />;
  // Исполнитель видит только свою карточку.
  if (!isManager(state.user)) {
    if (selected !== me) return <Navigate to={`/employees/${me}`} replace />;
    return <EmployeeCard key={me} id={me} />;
  }

  return (
    <div className="split split--300 employees-layout">
      <aside className="panel employee-directory" aria-label="Структура подразделения">
        <span className="caps">{department.name}</span>
        {department.groups.map((g) => (
          <div className="tree-group" key={g.id}>
            <span className="caps" style={{ color: 'var(--ink-4)' }}>{g.name}</span>
            {g.employeeIds.map((eid) => {
              const e = employeeById.get(eid)!;
              const c = counts.get(eid);
              return (
                <Link key={eid} to={`/employees/${eid}`} className={`tree-row${eid === selected ? ' active' : ''}`} aria-current={eid === selected ? 'page' : undefined}>
                  <span className="avatar">{initials(eid)}</span>
                  <span className="grow">
                    {shortName(eid)}
                    {(() => {
                      // Сегодня отсутствует — красная точка у фамилии, подробности в подсказке.
                      const a = absenceInPeriod(state.absences, eid, new Date(), new Date());
                      return a && <AbsentTag absence={a} from={new Date()} dot focusable={false} />;
                    })()}
                    <span className="sub">{e.position}</span>
                  </span>
                  {c?.overdue ? (
                    <span className="meta danger" data-tip="Просрочено">{c.overdue}!</span>
                  ) : (
                    <span className="meta" data-tip="В работе">{c?.open ?? 0}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        {state.users.some((account) => !employeeById.has(account.employeeId)) && <div className="tree-group">
          <span className="caps" style={{ color: 'var(--ink-4)' }}>Active Directory</span>
          {state.users.filter((account) => !employeeById.has(account.employeeId)).map((account) => {
            const parts = account.fullName.split(/\s+/);
            const compact = `${parts[0] ?? ''} ${parts.slice(1, 3).map((part) => `${part[0]}.`).join('')}`;
            const avatar = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`;
            return <Link key={account.employeeId} to={`/employees/${account.employeeId}`} className={`tree-row${account.employeeId === selected ? ' active' : ''}`} aria-current={account.employeeId === selected ? 'page' : undefined}>
              <span className="avatar">{avatar}</span><span className="grow">{compact}<span className="sub">{account.position || 'Сотрудник'}</span></span>
            </Link>;
          })}
        </div>}
      </aside>
      {employeeById.has(selected) || state.users.some((account) => account.employeeId === selected) ? (
        <EmployeeCard key={selected} id={selected} />
      ) : (
        <div className="not-found">
          <h1>Сотрудник не найден</h1>
          <p className="subtitle">Выберите сотрудника в списке слева.</p>
        </div>
      )}
    </div>
  );
};

const EmployeeCard = ({ id }: { id: number }) => {
  const { state } = useStore();
  const { openTask } = useTaskEditor();
  const [period, setPeriod] = useState<Period>('all');
  const e = employeeById.get(id);
  const managed = state.users.find((account) => account.employeeId === id);
  const group = department.groups.find((g) => g.employeeIds.includes(id));
  const now = new Date();

  const open = useMemo(
    () => state.tasks.filter((t) => !t.done && t.assigneeIds.includes(id)).sort((a, b) => a.end.localeCompare(b.end)),
    [state.tasks, id],
  );
  const periodEntries = useMemo(() => entriesInPeriod(state.reports, period), [state.reports, period]);
  const done = useMemo(() => periodEntries.filter((entry) => entry.assigneeId === id).sort((a, b) => b.doneAt.localeCompare(a.doneAt)), [periodEntries, id]);
  const departmentSize = useMemo(() => new Set([...department.groups.flatMap((item) => item.employeeIds), ...state.users.map((account) => account.employeeId)]).size, [state.users]);
  const scoreContext = useMemo(() => employeeScoreContext(periodEntries, id, departmentSize), [periodEntries, id, departmentSize]);
  const total = scoreContext.employeeTotal;
  const relativeExplanation = scoreContext.relativeToAverage === null
    ? 'нет баллов за период'
    : scoreContext.relativeToAverage === 100
      ? 'на уровне среднего'
      : `на ${fmtNum(Math.abs(scoreContext.relativeToAverage - 100))}% ${scoreContext.relativeToAverage > 100 ? 'выше' : 'ниже'} среднего`;
  const overdue = open.filter((t) => isOverdue(t, now)).length;
  if (!e && !managed) return null;

  return (
    <div className="employee-card">
      <div className="page-header">
        <div className="page-title page-title--employee">
          <p className="caps" style={{ margin: '0 0 6px' }}>{group?.name ?? 'Active Directory'}</p>
          <h1>{managed?.fullName ?? fullName(id)}</h1>
          <p className="subtitle">{managed?.position || e?.position || 'Сотрудник'}{state.user?.employeeId === id && ' · это Вы'}</p>
          {(() => {
            // Сотрудник сегодня отсутствует — метка после ФИО и должности.
            const a = absenceInPeriod(state.absences, id, new Date(), new Date());
            return a && <AbsentTag absence={a} from={new Date()} />;
          })()}
        </div>
      </div>
      <div className="filters">
        <FilterCard label="Период для баллов" wide>
          <PeriodPicker value={period} onChange={setPeriod} />
        </FilterCard>
      </div>
      <section className="card">
        <div className="stats">
          <div className="stat">
            <span className="caps">В работе</span>
            <div className="value">{open.length}</div>
            <div className="expl">неисполненных задач</div>
          </div>
          <div className="stat">
            <span className="caps">Просрочено</span>
            <div className={`value${overdue ? ' danger' : ''}`}>{overdue}</div>
            <div className="expl">{overdue ? 'требуют внимания' : 'сроки соблюдаются'}</div>
          </div>
          <div className="stat">
            <span className="caps">Исполнено</span>
            <div className="value">{done.length}</div>
            <div className="expl">{PERIOD_LABELS[period].toLowerCase()}</div>
          </div>
          <div className="stat">
            <span className="caps">Баллы</span>
            <div className="value ok">{fmtNum(total)}</div>
            <div className="expl">{plural(total, 'балл', 'балла', 'баллов')} за период</div>
          </div>
          <div className="stat" data-tip={`Среднее по отделу: ${fmtNum(scoreContext.departmentAverage)} балла`}>
            <span className="caps">К среднему по отделу</span>
            <div className="value ratio">{scoreContext.relativeToAverage === null ? '—' : `${fmtNum(scoreContext.relativeToAverage)}%`}</div>
            <div className="expl">{relativeExplanation}</div>
          </div>
          <div className="stat" data-tip={`Общая сумма баллов отдела: ${fmtNum(scoreContext.departmentTotal)}`}>
            <span className="caps">Вклад в баллы отдела</span>
            <div className="value ratio">{scoreContext.contribution === null ? '—' : `${fmtNum(scoreContext.contribution)}%`}</div>
            <div className="expl">от суммы за период</div>
          </div>
        </div>
      </section>

      {e && <AbsencePanel id={id} />}

      <div className="split split--half">
        <section className="card">
          <div className="card-head">
            <h2>Запланированные задачи</h2>
            <span className="caps">по сроку</span>
          </div>
          {open.length === 0 && <p className="empty">Неисполненных задач нет.</p>}
          <ul className="list">
            {open.map((t) => {
              const late = isOverdue(t, now);
              const row = t.rowId ? state.planRows.find((item) => item.id === t.rowId) : null;
              return (
                <li key={t.id} className={late ? 'overdue' : ''}>
                  <button type="button" className="t" onClick={() => openTask({ task: t })}>{t.title}</button>
                  <div className="m">
                    <span className={`num${late ? ' danger' : ''}`}>{late ? 'просрочено · ' : 'до '}{fmtDate(new Date(t.end))}</span>
                    <span>{row ? `${row.id} ${row.title}` : 'вне плана'}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Исполненные задачи</h2>
            <span className="caps">из отчётов · баллы</span>
          </div>
          {done.length === 0 && <p className="empty">За выбранный период нет исполненных задач в отчётах.</p>}
          <ul className="list">
            {done.slice(0, 50).map((x) => (
              <li key={`${x.taskId}-${x.doneAt}`} className="done">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="t">{x.title}</span>
                  <span className="pts">+{fmtNum(x.score)}</span>
                </div>
                {x.result && <div className="res">{x.result}</div>}
                <div className="m">
                  <span className="num">{fmtDate(new Date(x.doneAt))}</span>
                  <span>{x.rowId} {x.rowTitle}</span>
                </div>
              </li>
            ))}
          </ul>
          {done.length > 50 && <p className="empty">Показаны последние 50 из {done.length}.</p>}
        </section>
      </div>
    </div>
  );
};
