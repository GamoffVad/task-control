import { memo, useMemo } from 'react';
import { Link } from 'react-router';
import { absenceDays, absenceEnd, balanceFor, fmtSpan, travelNote, type Clash } from '../lib/absences';
import type { AbsenceStroke } from '../lib/absenceBrush';
import { absenceType, shortName } from '../lib/data';
import { fmtDate, isSameDay } from '../lib/dates';
import { dutyTypeTitle } from '../lib/eventTypes';
import { isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import type { Absence, Employee, Task } from '../lib/types';
import { vacationPeriodLabel, vacationTypeTitle, vacationYear } from '../lib/vacations';
import { absColor } from './absColor';
import { eventLabel } from '../lib/eventPresentation';
import { useTaskEditor } from './taskEditor';

type Props = {
  employee: Employee; groupStart: boolean; days: Date[]; today: Date; balanceDate: Date;
  absences: Absence[]; tasks: Task[]; clashes: Clash[]; flash: string | null;
  stroke: AbsenceStroke | null; invalid: boolean;
  onCreate: (employeeId: number, day: Date) => void; onEdit: (absence: Absence) => void;
};

/** Кисть обновляет только свою строку; остальные строки получают прежние ссылки на данные. */
export const TetrisRow = memo(({ employee: e, groupStart, days, today, balanceDate, absences, tasks, clashes, flash, stroke, invalid, onCreate, onEdit }: Props) => {
  const { state } = useStore();
  const { openTask } = useTaskEditor();
  const manager = isManager(state.user), me = state.user?.employeeId;
  const monthStart = days[0], monthEnd = days[days.length - 1], year = monthStart.getFullYear();
  const name = shortName(e.id), showBal = manager || e.id === me, canAdd = showBal;
  const bal = useMemo(() => balanceFor(state.absences, state.entitlements, e.id, year, today, { users: state.users, settings: state.vacationSettings, referenceDate: balanceDate }), [state.absences, state.entitlements, state.users, state.vacationSettings, e.id, year, today, balanceDate]);
  const bars = absences.flatMap((a) => {
    const start = new Date(`${a.from}T00:00`), end = absenceEnd(a);
    if (end < monthStart || start > monthEnd) return [];
    const from = start < monthStart ? 1 : start.getDate();
    return [{ a, from, span: (end > monthEnd ? days.length : end.getDate()) - from + 1 }];
  });
  return <div style={{ display: 'contents' }}>
    <Link className={`tl-who${groupStart ? ' tl-group-start' : ''}`} to={`/employees/${e.id}`}
      data-tip={showBal ? `Осталось отпуска: ${bal.vacation.left} дн. Отпускной период: ${vacationPeriodLabel(vacationYear(balanceDate, state.vacationSettings), state.vacationSettings)}. Осталось отгулов: ${bal.dayoff.left} дн. (${year} год).` : undefined}>
      <b>{name}</b>{!showBal && <span className="bal">{e.position}</span>}
    </Link>
    <div className={`tl-lane${groupStart ? ' tl-group-start' : ''}`} data-brush-employee={e.id}>
      {days.map((d) => <button key={d.getDate()} type="button" className={`tl-cell${[0, 6].includes(d.getDay()) ? ' we' : ''}${isSameDay(d, today) ? ' today' : ''}`}
        style={{ gridColumn: d.getDate() }} disabled={!canAdd} tabIndex={-1} aria-label={canAdd ? `Новое событие: ${name}, ${fmtDate(d)}` : undefined} onClick={() => onCreate(e.id, d)} />)}
      {stroke && (() => {
        const from = new Date(`${stroke.from}T00:00`), to = new Date(`${stroke.to}T00:00`);
        if (to < monthStart || from > monthEnd) return null;
        const start = from < monthStart ? 1 : from.getDate(), end = to > monthEnd ? days.length : to.getDate();
        return <div aria-hidden className={`tl-brush-preview${stroke.mode === 'erase' ? ' erasing' : ''}${invalid ? ' invalid' : ''}`} style={{ ...absColor(stroke, state.dictionaries), gridColumn: `${start} / span ${end - start + 1}` }} />;
      })()}
      {bars.map(({ a, from, span }) => {
        const t = absenceType(a.type), hit = clashes.some((c) => c.absence.id === a.id), subtype = a.type === 'vacation' || a.type === 'duty';
        const label = subtype ? eventLabel(a, state.dictionaries) : span >= 3 ? t.label : `${t.label.slice(0, 3)}.`;
        return <button key={a.id} type="button" id={`abs-${a.id}`} className={`tl-bar${a.status === 'request' ? ' request' : ''}${a.to === null ? ' open' : ''}${hit ? ' clash' : ''}${flash === a.id ? ' flash' : ''}`}
          style={{ ...absColor(a, state.dictionaries), gridColumn: `${from} / span ${span}` }} onClick={() => onEdit(a)}
          data-tip={`${a.type === 'vacation' ? vacationTypeTitle(a, state.dictionaries) : a.type === 'duty' ? dutyTypeTitle(a, state.dictionaries) : t.full}${a.status === 'request' ? ' — заявка' : ''}: ${name}, ${fmtSpan(a)}${travelNote(a) ? `. ${travelNote(a)}` : ''}${a.note ? `. ${a.note}` : ''}${hit ? '. Есть задачи со сроком в этот период' : ''}`}>
          <span className="tl-bar-title">{label}{span >= 3 && a.status === 'request' && ' · заявка'}</span>
          <small>{span >= 3 ? `${fmtSpan(a)} · ` : ''}{absenceDays(a)} дн.</small>
        </button>;
      })}
      {tasks.map((t) => {
        const c = clashes.find((hit) => hit.task.id === t.id && hit.employeeId === e.id), end = new Date(t.end);
        return <button key={t.id} type="button" className={`tl-dl${c ? ' bad' : ''}${t.done ? ' done' : ''}`} style={{ gridColumn: end.getDate() }}
          aria-label={`Срок ${fmtDate(end)}: ${t.title}${t.done ? ', исполнено' : c ? ', исполнитель отсутствует' : ''}`}
          data-tip={`${t.title} — срок ${fmtDate(end)}${t.done ? ', исполнено' : c ? ', исполнитель отсутствует' : ''}`} onClick={() => openTask({ task: t })} />;
      })}
    </div>
  </div>;
});
