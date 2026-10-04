import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PeriodPicker } from '../components/ui';
import { FilterCard, PageHeader } from '../kit';
import { department, employeeById, shortName } from '../lib/data';
import { fmtDate, fmtDayMonth, fmtNum, PERIOD_LABELS, periodStart, plural, points } from '../lib/dates';
import { kpiByDirection, kpiByEmployee, reportWeek, summarize, type ScoringContext } from '../lib/logic';
import { useStore } from '../lib/store';
import { useScope } from '../lib/useScope';
import { inScope } from '../lib/visibility';
import type { Period, ScoringAverageBase } from '../lib/types';

/** Чем делится общий балл — подпись под средним значением. */
const AVERAGE_LABEL: Record<ScoringAverageBase, string> = {
  staff: 'все сотрудники',
  active: 'действующие',
  withScore: 'только с баллами',
};

export const Kpi = () => {
  const { state } = useStore();
  const [period, setPeriod] = useState<Period>('quarter');
  // «Сейчас» фиксируется на время просмотра: иначе пересчёт шёл бы на каждой отрисовке.
  const now = useMemo(() => new Date(), []);
  const ctx = useMemo<ScoringContext>(() => ({ scoring: state.scoring, users: state.users, units: state.units }), [state.scoring, state.users, state.units]);
  const scope = useScope();
  // Начальник отделения видит показатели своего подразделения: баллы остальных ему не показываются (в отчётах их строки скрыты).
  const rows = useMemo(() => kpiByEmployee(state.reports, period, now, ctx).filter((r) => inScope(scope, r.employeeId)), [state.reports, period, now, ctx, scope]);
  const directions = useMemo(() => (state.scoring.byDirection ? kpiByDirection(state.reports, period, now, ctx).filter((d) => scope === null || department.groups.find((g) => g.id === d.id)?.employeeIds.some((id) => scope.has(id))) : []), [state.reports, period, now, ctx, state.scoring.byDirection, scope]);
  // Итоги считаются по правилам оценки: исключённые сотрудники в них не входят.
  const summary = useMemo(() => summarize(new Map(rows.map((r) => [r.employeeId, r.total])), ctx), [rows, ctx]);
  const counted = rows.filter((r) => !r.excluded);
  const total = summary.total;
  const count = counted.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const leader = counted[0]?.total ? counted[0] : null;
  const excludedCount = rows.length - counted.length;
  const from = periodStart(period, now);

  const weeks = useMemo(() => {
    const start = periodStart(period);
    const list = [...state.reports]
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .filter((r) => !start || reportWeek(r) >= new Date(start.getTime() - 7 * 86_400_000))
      .slice(-26);
    return list.map((r) => ({ week: reportWeek(r), total: r.entries.reduce((s, e) => s + e.score, 0), count: r.entries.length }));
  }, [state.reports, period]);
  const weekMax = Math.max(1, ...weeks.map((w) => w.total));

  return (
    <>
      <PageHeader
        title="Показатели эффективности"
        subtitle="Баллы начисляются за исполненные задачи из отправленных отчётов. Вес задачи равен весу позиции плана на момент отправки отчёта."
      />
      {excludedCount > 0 && (
        <p className="help-note">
          Вне общей оценки: {excludedCount} {plural(excludedCount, 'сотрудник', 'сотрудника', 'сотрудников')}. Их баллы показаны, но в итог и среднее не входят — правила задаёт администратор.
        </p>
      )}
      <div className="filters">
        <FilterCard label="Период" wide>
          <PeriodPicker value={period} onChange={setPeriod} />
        </FilterCard>
        <FilterCard label="С даты">
          <div className="num" style={{ fontSize: 15, fontWeight: 700, minHeight: 34, display: 'flex', alignItems: 'center' }}>
            {from ? fmtDate(from) : 'с начала учёта'}
          </div>
        </FilterCard>
      </div>

      <section className="card kpi-summary" aria-label="Итоги периода">
        <div className="stats">
          <div className="stat">
            <span className="caps">Всего баллов</span>
            <div className="value">{fmtNum(total)}</div>
            <div className="expl">{PERIOD_LABELS[period].toLowerCase()}</div>
          </div>
          <div className="stat">
            <span className="caps">Исполнено задач</span>
            <div className="value">{count}</div>
            <div className="expl">записей в отчётах</div>
          </div>
          <div className="stat">
            <span className="caps">В среднем на сотрудника</span>
            <div className="value">{fmtNum(summary.average)}</div>
            <div className="expl">{summary.counted > 0 ? `${AVERAGE_LABEL[state.scoring.averageBase]} · ${summary.counted}` : 'нет данных'}</div>
          </div>
          <div className="stat">
            <span className="caps">Лучший результат</span>
            <div className="value" style={{ fontSize: 20, paddingTop: 5, fontFamily: 'inherit' }}>{leader ? shortName(leader.employeeId) : '—'}</div>
            <div className="expl">{leader ? points(leader.total) : 'нет данных'}</div>
          </div>
        </div>
      </section>

      {directions.length > 0 && (
        <section className="card" aria-label="Баллы по направлениям">
          <div className="card-head">
            <h2>Баллы по направлениям</h2>
            <span className="caps">общий · средний балл</span>
          </div>
          <div className="table-scroll">
            <table className="admin-table directions">
              <thead>
                <tr>
                  <th>Направление</th>
                  <th className="col-num" style={{ width: '14%' }}>Общий балл</th>
                  <th className="col-num" style={{ width: '14%' }}>Средний балл</th>
                  <th className="col-num" style={{ width: '14%' }}>В расчёте</th>
                  <th className="col-num" style={{ width: '14%' }}>Задач</th>
                </tr>
              </thead>
              <tbody>
                {directions.map((d) => (
                  <tr key={d.id} className={d.excluded ? 'muted' : undefined}>
                    <td>{d.name}{d.excluded && <span className="faint"> · вне оценки</span>}</td>
                    <td className="num">{fmtNum(d.total)}</td>
                    <td className="num">{fmtNum(d.average)}</td>
                    <td className="num">{d.people}</td>
                    <td className="num">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help-note">Направления — отделения отдела. Средний балл делится на {AVERAGE_LABEL[state.scoring.averageBase]}. У направлений с пометкой «вне оценки» баллы показаны, но в общий итог отдела они не входят.</p>
        </section>
      )}

      <div className="split split--half">
        <section className="card" aria-label="Баллы по сотрудникам">
          <div className="card-head">
            <h2>Баллы по сотрудникам</h2>
            <span className="caps">баллы · задачи</span>
          </div>
          {total === 0 && <p className="empty">За выбранный период нет отправленных отчётов.</p>}
          {rows.map((r, i) => (
            <div className={`hbar-row${r.excluded ? ' hbar-row--muted' : ''}`} key={r.employeeId}>
              <Link className="label" to={`/employees/${r.employeeId}`}>
                {shortName(r.employeeId)}
                <span className="pos">{r.excluded ? 'вне оценки' : employeeById.get(r.employeeId)?.position}</span>
              </Link>
              <div className="bar-track" aria-hidden>
                <div className={`bar-fill${i === 0 && r.total > 0 && !r.excluded ? ' lead' : ''}`} style={{ transform: `scaleX(${r.total / max})` }} />
              </div>
              <div className="val">
                {fmtNum(r.total)}
                <small>{r.count} зад.</small>
              </div>
            </div>
          ))}
        </section>

        <section className="card" aria-label="Динамика по неделям">
          <div className="card-head">
            <h2>Динамика по неделям</h2>
            <span className="caps">баллы за отчётную неделю</span>
          </div>
          {weeks.length === 0 ? (
            <p className="empty">Нет отчётов за период.</p>
          ) : (
            <>
              <div className="week-bars" role="img" aria-label={`Баллы по неделям: ${weeks.map((w) => `${fmtDayMonth(w.week)} — ${fmtNum(w.total)}`).join('; ')}`}>
                {weeks.map((w) => (
                  <div key={w.week.toISOString()} className="wb" style={{ height: `${(w.total / weekMax) * 100}%` }} data-tip={`Неделя с ${fmtDayMonth(w.week)}: ${points(w.total)}, задач ${w.count}`} />
                ))}
              </div>
              <div className="week-labels" aria-hidden>
                {weeks.map((w, i) => (
                  <span key={w.week.toISOString()}>{i % 2 === 0 || weeks.length < 10 ? `${w.week.getDate()}.${String(w.week.getMonth() + 1).padStart(2, '0')}` : ''}</span>
                ))}
              </div>
              <p className="help-note" style={{ marginTop: 16 }}>
                Каждый столбец — отчёт за неделю, подпись — дата её начала (пятница). Наведите курсор, чтобы увидеть сумму.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
};
