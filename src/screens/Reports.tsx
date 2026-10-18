import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FilterCard, PageHeader, Select, Stepper } from '../kit';
import { Icon } from '../components/Icons';
import { department, employees, fullName, shortName } from '../lib/data';
import { addDays, fmtDate, fmtDateTime, fmtNum, fmtRange, fromDateKey, reportEnd, plural, points, toDateKey } from '../lib/dates';
import { normalizePeriodSettings, weeklyPeriodEnd, weeklyPeriodStart } from '../lib/periods';
import { buildReportEntries, reportRows, reportToCsv } from '../lib/logic';
import { hasPermission } from '../lib/access';
import { useStore } from '../lib/store';
import { DocumentDialog } from '../components/DocumentDialog';
import { reportDocContext } from '../lib/reportExport';
import { useFitHeight } from '../lib/useFitHeight';
import type { ReportEntry } from '../lib/types';
const EMPTY_ENTRIES: ReportEntry[] = [];

export const Reports = () => {
  // Таблица на высоту окна: шапка, колонка разделов и итог закреплены.
  const wrap = useRef<HTMLDivElement>(null);
  useFitHeight(wrap, '--report-max');
  const { state, dispatch } = useStore();
  const periods = normalizePeriodSettings(state.periodSettings);
  const [selectedStart, setWeekStart] = useState<Date | null>(null);
  const weekStart = selectedStart ?? addDays(weeklyPeriodStart(new Date(), periods.reporting), -7);
  const startKey = toDateKey(weekStart);
  const report = useMemo(() => state.reports.find((r) => r.weekStart === startKey), [state.reports, startKey]);
  const weekEnd = report ? reportEnd(report) : weeklyPeriodEnd(weekStart, periods.reporting);
  const canSubmit = hasPermission(state.user, 'reports.view') && hasPermission(state.user, 'tasks.plan');
  const doneCount = canSubmit ? buildReportEntries({ tasks: state.tasks, planRows: state.planRows }, weekStart, weekEnd).length : 0;
  const entries = report?.entries ?? EMPTY_ENTRIES;
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
        subtitle={<>{department.name} · Исполненные мероприятия за выбранный отчётный период.</>}
        actions={
          <>
            {canSubmit && <button type="button" className="btn icon-btn btn--primary report-submit report-action" aria-label={report ? 'Обновить отчёт' : 'Сформировать отчёт'} data-tip={report ? 'Обновить отчёт' : 'Сформировать отчёт'} disabled={!doneCount} onClick={() => dispatch({ type: 'submitReport', weekStart, periodEnd: weekEnd })}>{report ? <Icon.Refresh size={21} /> : <Icon.ReportCreate size={22} />}</button>}
            <button type="button" className="btn icon-btn report-action" aria-label="Выгрузить CSV" data-tip="Выгрузить CSV" onClick={download} disabled={!report || entries.length === 0}>
              <Icon.Download size={22} />
            </button>
            <button type="button" className="btn icon-btn report-action" aria-label="Документ" data-tip="Документ" onClick={() => setDocOpen(true)} disabled={!report || entries.length === 0}>
              <Icon.Word size={22} />
            </button>
            <button type="button" className="btn icon-btn btn--primary report-submit report-action" aria-label="Печать" data-tip="Печать" onClick={() => window.print()} disabled={!report || entries.length === 0}>
              <Icon.Print size={22} />
            </button>
          </>
        }
      />
      {docOpen && report && (
        <DocumentDialog
          templates={state.templates.filter((t) => t.scope === 'reports')}
          context={reportDocContext(report, state.planRows, weekStart, state.user)}
          fileBase={`otchet-${toDateKey(weekStart)}`}
          source="Текст собирается из отчёта за выбранный период в «Отчётности»"
          onCsv={download}
          onClose={() => setDocOpen(false)}
        />
      )}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <b>{department.name}.</b> Отчёт об исполнении мероприятий за период {fmtRange(weekStart, weekEnd)}.
      </div>
      <div className="filters no-print">
        <FilterCard label="Отчётный период">
          <Stepper
            label="Неделя"
            value={fmtRange(weekStart, weekEnd)}
            onPrev={() => setWeekStart(addDays(weekStart, -7))}
            onNext={() => setWeekStart(addDays(weekStart, 7))}
            onToday={() => setWeekStart(null)}
            todayLabel="Прошлая"
          />
        </FilterCard>
        {sent.length > 0 && <FilterCard label="Отправленные отчёты"><Select<string> label="Отправленные отчёты" value={report?.weekStart ?? ''} options={[{ value: '', label: 'Выбрать отчёт' }, ...sent.map((r) => ({ value: r.weekStart, label: `${fmtDate(fromDateKey(r.weekStart))} — ${fmtDate(reportEnd(r))}` }))]} onChange={(v) => setWeekStart(v ? fromDateKey(v) : null)} /></FilterCard>}
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
          <p className="empty" style={{ paddingBottom: 6 }}>{report ? 'Отчёт за этот период отправлен без исполненных задач.' : 'Отчёт за этот период ещё не отправлен.'}</p>
          <p className="help-note">
            Отметьте исполнение задач и нажмите «{report ? 'Обновить отчёт' : 'Сформировать отчёт'}» за нужный период здесь. В разделе <Link to="/planning">Планирование</Link> то же действие называется «Направить в отчёт».
            {sent.length > 0 && (
              <>
                {' '}Последний полученный отчёт — за{' '}
                <button type="button" className="text-action" style={{ minHeight: 0 }} onClick={() => setWeekStart(new Date(`${sent[0].weekStart}T00:00:00`))}>
                  {fmtRange(fromDateKey(sent[0].weekStart), reportEnd(sent[0]))}
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
