import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FilterCard, PageHeader, Stepper } from '../kit';
import { Icon } from '../components/Icons';
import { employees, fullName, shortName } from '../lib/data';
import { addDays, fmtDate, fmtDateTime, fmtNum, fmtRange, planWeekStart, plural, points, toDateKey } from '../lib/dates';
import { findReport, reportRows, reportToCsv } from '../lib/logic';
import { useStore } from '../lib/store';
import { DocumentDialog } from '../components/DocumentDialog';
import { reportDocContext } from '../lib/reportExport';
import { useFitHeight } from '../lib/useFitHeight';
import type { ReportEntry } from '../lib/types';

export const Reports = () => {
  // Таблица на высоту окна: шапка, колонка разделов и итог закреплены.
  const wrap = useRef<HTMLDivElement>(null);
  useFitHeight(wrap, '--report-max');
  const { state } = useStore();
  const [weekStart, setWeekStart] = useState(() => addDays(planWeekStart(new Date()), -7));
  const weekEnd = addDays(weekStart, 6);
  const report = findReport(state.reports, weekStart);
  const entries = useMemo(() => report?.entries ?? [], [report]);
  const rows = useMemo(() => reportRows(entries, state.planRows), [entries, state.planRows]);
  const cols = employees.filter((e) => entries.some((x) => x.assigneeId === e.id));
  const byCell = useMemo(() => {
    const m = new Map<string, ReportEntry[]>();
    for (const e of entries) m.set(`${e.rowId}|${e.assigneeId}`, [...(m.get(`${e.rowId}|${e.assigneeId}`) ?? []), e]);
    return m;
  }, [entries]);
  const totals = new Map(cols.map((c) => [c.id, entries.filter((e) => e.assigneeId === c.id).reduce((s, e) => s + e.score, 0)]));
  const grand = entries.reduce((s, e) => s + e.score, 0);
  const [docOpen, setDocOpen] = useState(false);
  const sent = [...state.reports].sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  const download = () => {
    if (!report) return;
    const blob = new Blob([reportToCsv(report, fullName)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `otchet-${toDateKey(weekStart)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Отчётность"
        subtitle={<>Исполненные мероприятия за неделю <b>{fmtRange(weekStart, weekEnd)}</b>.</>}
        actions={
          <>
            <button type="button" className="btn" onClick={download} disabled={!report || entries.length === 0}>
              <Icon.Download size={15} /> Выгрузить CSV
            </button>
            <button type="button" className="btn" onClick={() => setDocOpen(true)} disabled={!report || entries.length === 0}>
              Документ
            </button>
            <button type="button" className="btn btn--primary" onClick={() => window.print()} disabled={!report || entries.length === 0}>
              <Icon.Print size={15} /> Печать
            </button>
          </>
        }
      />
      {docOpen && report && (
        <DocumentDialog
          templates={state.templates.filter((t) => t.scope === 'reports')}
          context={reportDocContext(report, state.planRows, weekStart, state.user)}
          fileBase={`otchet-${toDateKey(weekStart)}`}
          source="Текст собирается из отчёта за неделю в «Отчётности»"
          onCsv={download}
          onClose={() => setDocOpen(false)}
        />
      )}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <b>Отдел разработки.</b> Отчёт об исполнении мероприятий за неделю {fmtRange(weekStart, weekEnd)}.
      </div>
      <div className="filters no-print">
        <FilterCard label="Отчётная неделя">
          <Stepper
            label="Неделя"
            value={fmtRange(weekStart, weekEnd)}
            onPrev={() => setWeekStart((w) => addDays(w, -7))}
            onNext={() => setWeekStart((w) => addDays(w, 7))}
            onToday={() => setWeekStart(addDays(planWeekStart(new Date()), -7))}
            todayLabel="Прошлая"
          />
        </FilterCard>
        <FilterCard label="Статус">
          <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', fontSize: 13 }}>
            {report ? <span className="ok" style={{ fontWeight: 600 }}>получен {fmtDateTime(new Date(report.submittedAt))}</span> : <span className="muted">не отправлен</span>}
          </div>
        </FilterCard>
        <FilterCard label="Итого по отчёту">
          <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
            <span><span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{entries.length}</span> <span className="muted">{plural(entries.length, 'запись', 'записи', 'записей')}</span></span>
            <span><span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{fmtNum(grand)}</span> <span className="muted">{plural(grand, 'балл', 'балла', 'баллов')}</span></span>
          </div>
        </FilterCard>
      </div>

      {!report || entries.length === 0 ? (
        <div className="card">
          <p className="empty" style={{ paddingBottom: 6 }}>{report ? 'Отчёт за эту неделю отправлен без исполненных задач.' : 'Отчёт за эту неделю ещё не отправлен.'}</p>
          <p className="help-note">
            Отметьте исполнение задач и нажмите «Направить в отчёт» в разделе <Link to="/planning">Планирование</Link> на нужной неделе.
            {sent.length > 0 && (
              <>
                {' '}Последний полученный отчёт — за{' '}
                <button type="button" className="text-action" style={{ minHeight: 0 }} onClick={() => setWeekStart(new Date(`${sent[0].weekStart}T00:00:00`))}>
                  {fmtRange(new Date(`${sent[0].weekStart}T00:00:00`), addDays(new Date(`${sent[0].weekStart}T00:00:00`), 6))}
                </button>
                .
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="report-wrap" ref={wrap} style={{ marginTop: 8 }}>
          <table className="report-table">
            <thead>
              <tr>
                <th className="sticky-col" style={{ width: 280 }}>Разделы планирования</th>
                {cols.map((c) => (
                  <th key={c.id} style={{ minWidth: 200 }}>{shortName(c.id)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.isHeader ? (
                  <tr key={r.id}>
                    <td className="sticky-col" style={{ background: 'var(--soft-alt)', fontWeight: 700, color: 'var(--ink)' }}>
                      <span className="num faint" style={{ marginRight: 8 }}>{r.id}</span>{r.title}
                    </td>
                    <td colSpan={cols.length} style={{ background: 'var(--soft-alt)' }} />
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td className="sticky-col">
                      <span className="num faint" style={{ marginRight: 8 }}>{r.id}</span>{r.title}
                    </td>
                    {cols.map((c) => (
                      <td key={c.id}>
                        {(byCell.get(`${r.id}|${c.id}`) ?? []).map((e) => (
                          <div key={e.taskId} style={{ borderLeft: '2px solid var(--ok)', paddingLeft: 8, marginBottom: 6 }}>
                            <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{e.title}</div>
                            {e.result && <div>{e.result}</div>}
                            <div className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              срок {fmtDate(new Date(e.deadline))} · {points(e.score)}
                            </div>
                            {e.docName && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{e.docName}{e.docNumber && ` № ${e.docNumber}`}</div>}
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
            {/* Итог закреплён внизу таблицы — виден при любой прокрутке. */}
            <tfoot>
                <tr>
                  <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--ink)' }}>Итого баллов</td>
                  {cols.map((c) => (
                    <td key={c.id} className="num" style={{ fontWeight: 700, color: 'var(--ink)' }}>
                      {fmtNum(totals.get(c.id) ?? 0)}
                    </td>
                  ))}
                </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
};
