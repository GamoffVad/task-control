import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PeriodPicker } from '../components/ui';
import { FilterCard, PageHeader } from '../kit';
import { employeeById, shortName } from '../lib/data';
import { fmtDate, fmtDayMonth, fmtNum, PERIOD_LABELS, periodStart, points } from '../lib/dates';
import { kpiByEmployee, reportWeek } from '../lib/logic';
import { useStore } from '../lib/store';
import type { Period } from '../lib/types';

export const Kpi = () => {
  const { state } = useStore();
  const [period, setPeriod] = useState<Period>('quarter');
  const now = new Date();
  const rows = useMemo(() => kpiByEmployee(state.reports, period), [state.reports, period]);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const leader = rows[0]?.total ? rows[0] : null;
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
            <div className="value">{fmtNum(Math.round((total / rows.length) * 10) / 10)}</div>
            <div className="expl">баллов</div>
          </div>
          <div className="stat">
            <span className="caps">Лучший результат</span>
            <div className="value" style={{ fontSize: 20, paddingTop: 5, fontFamily: 'inherit' }}>{leader ? shortName(leader.employeeId) : '—'}</div>
            <div className="expl">{leader ? points(leader.total) : 'нет данных'}</div>
          </div>
        </div>
      </section>

      <div className="split split--half">
        <section className="card" aria-label="Баллы по сотрудникам">
          <div className="card-head">
            <h2>Баллы по сотрудникам</h2>
            <span className="caps">баллы · задачи</span>
          </div>
          {total === 0 && <p className="empty">За выбранный период нет отправленных отчётов.</p>}
          {rows.map((r, i) => (
            <div className="hbar-row" key={r.employeeId}>
              <Link className="label" to={`/employees/${r.employeeId}`}>
                {shortName(r.employeeId)}
                <span className="pos">{employeeById.get(r.employeeId)?.position}</span>
              </Link>
              <div className="bar-track" aria-hidden>
                <div className={`bar-fill${i === 0 && r.total > 0 ? ' lead' : ''}`} style={{ transform: `scaleX(${r.total / max})` }} />
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
