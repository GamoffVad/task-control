import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AbsenceModal } from '../components/AbsenceModal';
import { absColor } from '../components/absColor';
import { Icon } from '../components/Icons';
import { useTaskEditor } from '../components/taskEditor';
import { GroupFilter } from '../components/ui';
import { MultiSelect, Stepper } from '../kit';
import {
  absenceDays,
  absenceEnd,
  balanceFor,
  covers,
  findClashes,
  fmtDayRanges,
  fmtShare,
  fmtSpan,
  isActive,
  shareIfApproved,
  vacationLoad,
  VACATION_LIMIT,
  type AbsenceDraft,
  type Clash,
} from '../lib/absences';
import { ABSENCE_TYPES, absenceType, department, employees, groupMembers, shortName } from '../lib/data';
import { addDays, addMonths, fmtDate, fmtMonthYear, fmtWeekday, isSameDay, plural, startOfDay, toDateKey } from '../lib/dates';
import { saveFile } from '../lib/download';
import { isManager } from '../lib/permissions';
import { tetrisFileName, tetrisWorkbook } from '../lib/tetrisExport';
import { visibleBottom } from '../lib/viewport';
import { useStore } from '../lib/store';
import type { Absence, AbsenceType, Task } from '../lib/types';

const SEVERITY: Record<Clash['severity'], [string, string]> = {
  overdue: ['Просрочено', 'var(--danger)'],
  risk: ['Под угрозой', 'var(--danger)'],
  request: ['По заявке', 'var(--amber)'],
};

type Editing = { absence?: Absence; defaults?: Partial<AbsenceDraft> } | null;

export const Absences = () => {
  const { state, dispatch } = useStore();
  const { openTask } = useTaskEditor();
  const manager = isManager(state.user);
  const me = state.user?.employeeId ?? 0;
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [group, setGroup] = useState('all');
  const [hidden, setHidden] = useState<Set<AbsenceType>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1));
  const monthStart = days[0];
  const monthEnd = days[days.length - 1];
  const year = month.getFullYear();

  const people = groupMembers(group);
  const visible = state.absences.filter((a) => isActive(a) && !hidden.has(a.type));
  const clashes = useMemo(() => findClashes(state.tasks, state.absences), [state.tasks, state.absences]);
  // Исполнитель видит пересечения только по своим задачам.
  const myClashes = manager ? clashes : clashes.filter((c) => c.employeeId === me);
  const requests = state.absences.filter((a) => a.status === 'request').sort((a, b) => a.from.localeCompare(b.from));

  const absentToday = employees.filter((e) => state.absences.some((a) => a.employeeId === e.id && a.status === 'approved' && today >= new Date(`${a.from}T00:00`) && today <= absenceEnd(a)));
  // Сколько сотрудников группы одновременно в отпуске: при доле выше порога — предупреждение.
  const load = vacationLoad(state.absences, people.map((e) => e.id), days, today);
  const overDays = new Set(load.over.map((d) => d.getDate()));
  const overReqDays = new Set(load.overWithRequests.map((d) => d.getDate()));
  const allIds = employees.map((e) => e.id);
  // Итоговая строка графика: сколько сотрудников отсутствует в каждый день (согласованные отсутствия любого вида).
  const absentByDay = days.map((d) => people.filter((e) => state.absences.some((a) => a.employeeId === e.id && a.status === 'approved' && covers(a, d, today))));

  // График занимает высоту окна под шапкой раздела и прокручивается внутри себя:
  // строка дней закреплена сверху, итоговая строка «Отсутствуют, %» — снизу.
  // Легенда стоит под графиком — график оставляет под неё место, чтобы она была видна без прокрутки страницы.
  const board = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const below = legend.current ? legend.current.offsetHeight + 8 : 0;
      el.style.setProperty('--tl-max', `${Math.max(320, Math.floor(visibleBottom() - top - 12 - below))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });


  // Выгрузка в Excel: выбранный месяц, группа и виды событий — как на графике.
  const exportExcel = () => {
    const balances = new Map(
      people
        .filter((e) => manager || e.id === me)
        .map((e) => {
          const bal = balanceFor(state.absences, state.entitlements, e.id, year);
          return [e.id, { vacation: bal.vacation.left, dayoff: bal.dayoff.left }] as const;
        }),
    );
    const bytes = tetrisWorkbook({
      month,
      people,
      absences: state.absences,
      hidden,
      tasks: state.tasks,
      dictionaries: state.dictionaries,
      groupLabel: group === 'all' ? 'весь отдел' : (department.groups.find((g) => g.id === group)?.name ?? group),
      balances: balances.size ? balances : undefined,
    });
    saveFile(tetrisFileName(month), bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  const canCreateFor = (employeeId: number) => manager || employeeId === me;
  const create = (employeeId: number, day?: Date) =>
    setEditing({ defaults: { employeeId, from: toDateKey(day ?? today), to: toDateKey(day ?? today) } });


  const barsFor = (employeeId: number) =>
    visible
      .filter((a) => a.employeeId === employeeId)
      .map((a) => {
        const s = new Date(`${a.from}T00:00`);
        const e = absenceEnd(a);
        if (e < monthStart || s > monthEnd) return null;
        const from = s < monthStart ? 1 : s.getDate();
        const to = e > monthEnd ? daysInMonth : e.getDate();
        return { a, from, span: to - from + 1 };
      })
      .filter(Boolean) as { a: Absence; from: number; span: number }[];

  const deadlinesFor = (employeeId: number) =>
    state.tasks.filter((t) => t.assigneeIds.includes(employeeId) && new Date(t.end) >= monthStart && new Date(t.end) < addDays(monthEnd, 1));

  const clashOf = (t: Task, employeeId: number) => clashes.find((c) => c.task.id === t.id && c.employeeId === employeeId);

  return (
    <>
      {/* Компактная шапка: заголовок, месяц, группа и кнопка в одной строке — больше места графику. */}
      <div className="tt-head">
        <div className="tt-title">
          <h1>Тетрис</h1>
          <span className="tt-sub">график событий отдела</span>
        </div>
        <div className="tt-tools">
          <Stepper
            label="Месяц"
            value={fmtMonthYear(month)}
            onPrev={() => setMonth((m) => addMonths(m, -1))}
            onNext={() => setMonth((m) => addMonths(m, 1))}
            onToday={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            todayLabel="Текущий"
          />
          <div className="tt-group">
            <span className="caps">Группа</span>
            <GroupFilter value={group} onChange={setGroup} />
          </div>
          <button type="button" className="btn" onClick={exportExcel} data-tip="Матрица выбранного месяца, список событий и сроки задач">
            <Icon.Download size={15} /> Выгрузить в Excel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => create(me)}>
            <Icon.Plus size={15} /> {manager ? 'Событие' : 'Заявка на событие'}
          </button>
        </div>
      </div>

      <section className="tt-stats" aria-label="Сводка">
        <div className="tt-stat tt-filter">
          <span className="caps">Виды</span>
          <MultiSelect<AbsenceType>
            label="Виды событий"
            allLabel="все виды"
            options={ABSENCE_TYPES.map((t) => ({ value: t.key, label: t.label, style: absColor(t.key) }))}
            value={ABSENCE_TYPES.map((t) => t.key).filter((k) => !hidden.has(k))}
            onChange={(shown) => setHidden(new Set(ABSENCE_TYPES.map((t) => t.key).filter((k) => !shown.includes(k))))}
          />
        </div>
        <div className="tt-stat">
          <span className="caps">Сегодня отсутствуют</span>
          <b className="num">{absentToday.length}</b>
          <span className="expl" data-tip={absentToday.length > 3 ? absentToday.map((e) => shortName(e.id)).join(', ') : undefined}>
            {absentToday.length === 0
              ? 'все на месте'
              : absentToday.length > 3
                ? `${absentToday.slice(0, 3).map((e) => shortName(e.id)).join(', ')} и ещё ${absentToday.length - 3}`
                : absentToday.map((e) => shortName(e.id)).join(', ')}
          </span>
        </div>
        <div className="tt-stat">
          <span className="caps">Пересечения со сроками</span>
          <b className={`num${myClashes.length ? ' danger' : ''}`}>{myClashes.length}</b>
          <span className="expl">{manager ? 'задачи, исполнитель которых отсутствует' : 'Ваши задачи на время события'}</span>
        </div>
        <div className={`tt-stat${load.over.length ? ' bad' : load.overWithRequests.length ? ' warn' : ''}`} data-tip={`Порог — ${fmtShare(VACATION_LIMIT)} сотрудников одновременно`}>
          <span className="caps">Пик отпусков</span>
          <b className="num">{fmtShare(load.share)}</b>
          <span className="expl">
            {load.peak > 0 ? `${load.peak} из ${load.size} · ${fmtDayRanges(load.peakDays)}` : 'в этом месяце никого'}
          </span>
        </div>
        <div className="tt-stat">
          <span className="caps">{manager ? 'Заявки' : 'Мои заявки'}</span>
          <b className="num">{manager ? requests.length : requests.filter((r) => r.employeeId === me).length}</b>
          <span className="expl">ожидают решения{manager ? '' : ' руководителя'}</span>
        </div>
      </section>
      {(load.over.length > 0 || load.overWithRequests.length > 0) && (
        <p className={`tt-warn${load.over.length ? '' : ' soft'}`} role="status">
          {load.over.length > 0 ? (
            <>
              <b>В отпуске больше {fmtShare(VACATION_LIMIT)} {group === 'all' ? 'отдела' : 'группы'}</b> — до {fmtShare(load.share)} ({load.peak} из {load.size}): {fmtDayRanges(load.over)}. Сдвиньте отпуск или договоритесь о замене.
            </>
          ) : (
            <>
              <b>Заявки превысят порог {fmtShare(VACATION_LIMIT)}</b>: если их согласовать, в отпуске будет до {fmtShare(load.shareWithRequests)} ({load.peakWithRequests} из {load.size}) — {fmtDayRanges(load.overWithRequests)}.
            </>
          )}
        </p>
      )}

      <div className="tl-board" ref={board}>
        <div className="tl" style={{ ['--days' as string]: daysInMonth, ['--rows' as string]: people.length }} role="grid" aria-label={`График событий: ${fmtMonthYear(month)}`}>
          <div className="tl-corner"><span className="caps">Сотрудник</span></div>
          {days.map((d) => (
            <div
              key={d.getDate()}
              className={`tl-dh${[0, 6].includes(d.getDay()) ? ' we' : ''}${isSameDay(d, today) ? ' today' : ''}${overDays.has(d.getDate()) ? ' over' : overReqDays.has(d.getDate()) ? ' over-req' : ''}`}
              data-tip={overDays.has(d.getDate()) ? `В отпуске больше ${fmtShare(VACATION_LIMIT)}` : overReqDays.has(d.getDate()) ? `С заявками в отпуске будет больше ${fmtShare(VACATION_LIMIT)}` : undefined}
            >
              <b>{d.getDate()}</b>
              {fmtWeekday(d)}
            </div>
          ))}
          {people.map((e) => {
            const bal = balanceFor(state.absences, state.entitlements, e.id, year);
            const showBal = manager || e.id === me;
            const canAdd = canCreateFor(e.id);
            return (
              <div key={e.id} style={{ display: 'contents' }}>
                <Link className="tl-who" to={`/employees/${e.id}`}>
                  <b>{shortName(e.id)}</b>
                  {showBal ? (
                    <span className="bal">
                      <span>отпуск <span className={`num${bal.vacation.left <= 5 ? ' low' : ''}`}>{bal.vacation.left}</span></span>
                      <span>отгулы <span className="num">{bal.dayoff.left}</span></span>
                    </span>
                  ) : (
                    <span className="bal">{e.position}</span>
                  )}
                </Link>
                <div className="tl-lane">
                  {days.map((d) => (
                    <button
                      key={d.getDate()}
                      type="button"
                      className={`tl-cell${[0, 6].includes(d.getDay()) ? ' we' : ''}${isSameDay(d, today) ? ' today' : ''}`}
                      style={{ gridColumn: d.getDate() }}
                      disabled={!canAdd}
                      tabIndex={-1}
                      aria-label={canAdd ? `Новое событие: ${shortName(e.id)}, ${fmtDate(d)}` : undefined}
                      onClick={() => create(e.id, d)}
                    />
                  ))}
                  {barsFor(e.id).map(({ a, from, span }) => {
                    const t = absenceType(a.type);
                    const hit = clashes.some((c) => c.absence.id === a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        id={`abs-${a.id}`}
                        className={`tl-bar${a.status === 'request' ? ' request' : ''}${a.to === null ? ' open' : ''}${hit ? ' clash' : ''}${flash === a.id ? ' flash' : ''}`}
                        style={{ ...absColor(a.type), gridColumn: `${from} / span ${span}` }}
                        onClick={() => setEditing({ absence: a })}
                        data-tip={`${t.full}${a.status === 'request' ? ' — заявка' : ''}: ${shortName(a.employeeId)}, ${fmtSpan(a)}${a.note ? `. ${a.note}` : ''}${hit ? '. Есть задачи со сроком в этот период' : ''}`}
                      >
                        {span >= 3 ? (
                          <>
                            {t.label}
                            {a.status === 'request' && ' · заявка'}
                            <small>
                              {fmtSpan(a)} · {absenceDays(a)} дн.
                            </small>
                          </>
                        ) : (
                          <>
                            {t.label.slice(0, 3)}.<small>{absenceDays(a)} дн.</small>
                          </>
                        )}
                      </button>
                    );
                  })}
                  {deadlinesFor(e.id).map((t) => {
                    const c = clashOf(t, e.id);
                    const end = new Date(t.end);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`tl-dl${c ? ' bad' : ''}${t.done ? ' done' : ''}`}
                        style={{ gridColumn: end.getDate() }}
                        aria-label={`Срок ${fmtDate(end)}: ${t.title}${t.done ? ', исполнено' : c ? ', исполнитель отсутствует' : ''}`}
                        data-tip={`${t.title} — срок ${fmtDate(end)}${t.done ? ', исполнено' : c ? ', исполнитель отсутствует' : ''}`}
                        onClick={() => openTask({ task: t })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="tl-foot-label" data-tip="Доля сотрудников с согласованным событием любого вида">
            <span className="caps">Отсутствуют, %</span>
          </div>
          {absentByDay.map((list, i) => {
            const share = people.length ? list.length / people.length : 0;
            return (
              <div
                key={i + 1}
                className={`tl-foot${share > VACATION_LIMIT ? ' hi' : list.length ? ' some' : ''}${[0, 6].includes(days[i].getDay()) ? ' we' : ''}`}
                data-tip={list.length ? `${fmtDate(days[i])}: ${list.length} из ${people.length} — ${list.map((e) => shortName(e.id)).join(', ')}` : `${fmtDate(days[i])}: все на месте`}
              >
                {list.length ? fmtShare(share) : '—'}
              </div>
            );
          })}
        </div>
      </div>

      <div className="tl-legend tt-legend" ref={legend}>
        <span><i className="lg-bar" />согласовано</span>
        <span><i className="lg-req" />заявка</span>
        <span className="tl-legend-title">Сроки задач:</span>
        <span><i className="lg-dl" />назначен</span>
        <span><i className="lg-dl done" />выполнен</span>
        <span><i className="lg-dl bad" />во время события</span>
        {manager && <span>под именем — остаток отпуска и отгулов</span>}
      </div>

      <div className="split split--half">
        <section className="card" aria-label="Пересечения со сроками задач">
          <div className="card-head">
            <h2>Пересечения со сроками задач</h2>
            <span className="caps">{myClashes.length} {plural(myClashes.length, 'задача', 'задачи', 'задач')}</span>
          </div>
          {myClashes.length === 0 && <p className="empty">Сроки задач не приходятся на события исполнителей.</p>}
          <ul className="clash-list">
            {myClashes.map((c) => {
              const [label, color] = SEVERITY[c.severity];
              return (
                <li key={`${c.task.id}-${c.employeeId}`} style={{ ['--sev' as string]: color }}>
                  <button type="button" className="t" onClick={() => openTask({ task: c.task })}>
                    {c.task.title}
                  </button>
                  <span className="sev">{label}</span>
                  <span className="m">
                    {shortName(c.employeeId)} · срок <span className="num">{fmtDate(new Date(c.task.end))}</span> · {absenceType(c.absence.type).full.toLowerCase()} {fmtSpan(c.absence)}
                    {c.absence.status === 'request' && ' (заявка)'}
                  </span>
                  <span className="act">
                    <button type="button" className="text-action" onClick={() => openTask({ task: c.task })}>
                      {manager ? 'Перенести срок или передать задачу' : 'Открыть задачу'}
                    </button>
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        const d = new Date(`${c.absence.from}T00:00`);
                        setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                        setFlash(c.absence.id);
                        requestAnimationFrame(() => document.getElementById(`abs-${c.absence.id}`)?.scrollIntoView({ block: 'nearest', inline: 'center' }));
                      }}
                    >
                      Показать на графике
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card" aria-label="Заявки">
          <div className="card-head">
            <h2>{manager ? 'Заявки на согласование' : 'Мои заявки'}</h2>
            <span className="caps">{fmtMonthYear(today)}</span>
          </div>
          {(manager ? requests : requests.filter((r) => r.employeeId === me)).length === 0 && <p className="empty">Заявок нет.</p>}
          <ul className="clash-list">
            {(manager ? requests : requests.filter((r) => r.employeeId === me)).map((r) => {
              const affected = clashes.filter((c) => c.absence.id === r.id).length;
              return (
                <li key={r.id} style={{ ['--sev' as string]: `var(--abs-${r.type})` }}>
                  <button type="button" className="t" onClick={() => setEditing({ absence: r })}>
                    {shortName(r.employeeId)} — {absenceType(r.type).full.toLowerCase()}
                  </button>
                  <span className="sev" style={{ color: 'var(--amber)' }}>заявка</span>
                  <span className="m">
                    {fmtSpan(r)} · {absenceDays(r)} дн.
                    {affected > 0 && <span className="absent-mark"> · задевает {affected} {plural(affected, 'задачу', 'задачи', 'задач')}</span>}
                    {shareIfApproved(state.absences, r, allIds) > VACATION_LIMIT && (
                      <span className="absent-mark"> · в отпуске будет {fmtShare(shareIfApproved(state.absences, r, allIds))} отдела</span>
                    )}
                  </span>
                  {manager && (
                    <span className="act">
                      <button type="button" className="text-action" style={{ color: 'var(--ok)' }} onClick={() => dispatch({ type: 'decideAbsence', id: r.id, status: 'approved' })}>
                        Согласовать
                      </button>
                      <button type="button" className="text-action danger" onClick={() => dispatch({ type: 'decideAbsence', id: r.id, status: 'rejected' })}>
                        Отклонить
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {editing && <AbsenceModal key={editing.absence?.id ?? 'new'} absence={editing.absence} defaults={editing.defaults} onClose={() => setEditing(null)} />}
    </>
  );
};
