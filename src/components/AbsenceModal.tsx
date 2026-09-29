import { useState } from 'react';
import {
  absenceDays,
  balanceFor,
  covers,
  fmtSpan,
  validateAbsence,
  type AbsenceDraft,
  type AbsenceErrors,
} from '../lib/absences';
import { ABSENCE_STATUS_LABELS, ABSENCE_TYPES, absenceType, employees, fullName, shortName } from '../lib/data';
import { fmtDate, fromDateKey, plural, toDateKey } from '../lib/dates';
import { absenceAccess, isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import type { Absence, AbsenceStatus, AbsenceType } from '../lib/types';
import { Checkbox, DateField, Dialog, Segmented, Select, TextInput } from '../kit';
import { Icon } from './Icons';

type Props = { absence?: Absence; defaults?: Partial<AbsenceDraft>; onClose: () => void };

const STATUS_OPTIONS: { value: AbsenceStatus; label: string }[] = [
  { value: 'request', label: 'Заявка' },
  { value: 'approved', label: 'Согласовано' },
  { value: 'rejected', label: 'Отклонено' },
];

/** Создание, изменение и согласование отсутствия. */
export const AbsenceModal = ({ absence, defaults, onClose }: Props) => {
  const { state, dispatch } = useStore();
  const user = state.user;
  const manager = isManager(user);
  const access = absenceAccess(user, absence ?? null);
  const today = new Date();
  const [draft, setDraft] = useState<AbsenceDraft>(() =>
    absence
      ? { id: absence.id, employeeId: absence.employeeId, type: absence.type, from: absence.from, to: absence.to, status: absence.status, note: absence.note }
      : {
          employeeId: user?.employeeId ?? 1,
          type: 'vacation',
          from: toDateKey(today),
          to: toDateKey(today),
          status: manager ? 'approved' : 'request',
          note: '',
          ...defaults,
          ...(manager ? {} : { employeeId: user?.employeeId ?? 1, status: 'request' as const }),
        },
  );
  const [errors, setErrors] = useState<AbsenceErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = !access.edit;

  const set = <K extends keyof AbsenceDraft>(k: K, v: AbsenceDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    // Ошибка по датам показывается сразу, а не только при сохранении.
    if (k === 'from' || k === 'to') setErrors((prev) => ({ ...prev, from: undefined, to: undefined, overlap: undefined }));
  };

  /** Перенос первого дня сдвигает последний, сохраняя длительность: иначе можно получить «по» раньше «с». */
  const setFrom = (value: string) =>
    setDraft((d) => {
      if (d.to === null || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(d.from)) return { ...d, from: value };
      const days = Math.round((fromDateKey(d.to).getTime() - fromDateKey(d.from).getTime()) / 86_400_000);
      const to = new Date(fromDateKey(value).getTime() + Math.max(days, 0) * 86_400_000);
      return { ...d, from: value, to: toDateKey(to) };
    });

  const probe: Absence = { ...draft, id: draft.id ?? 'new', createdAt: '', decidedBy: null };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(draft.from) && (draft.to === null || draft.to >= draft.from);
  const days = valid ? absenceDays(probe, today) : 0;
  const year = valid ? fromDateKey(draft.from).getFullYear() : today.getFullYear();
  // Остаток без этого отсутствия и после него.
  const others = state.absences.filter((a) => a.id !== draft.id);
  const before = balanceFor(others, state.entitlements, draft.employeeId, year, today);
  const withThis = draft.status === 'rejected' ? before : balanceFor([...others, { ...probe, status: 'approved' }], state.entitlements, draft.employeeId, year, today);
  const counted = draft.type === 'vacation' ? 'vacation' : draft.type === 'dayoff' ? 'dayoff' : null;
  const leftNow = counted === 'vacation' ? before.vacation.left : counted === 'dayoff' ? before.dayoff.left : null;
  const leftAfter = counted === 'vacation' ? withThis.vacation.left : counted === 'dayoff' ? withThis.dayoff.left : null;

  const clashing = valid ? state.tasks.filter((t) => !t.done && t.assigneeIds.includes(draft.employeeId) && covers(probe, new Date(t.end), today)) : [];

  const save = (status?: AbsenceStatus) => {
    const next = status ? { ...draft, status } : draft;
    const errs = validateAbsence(next, state.absences, today);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    dispatch({ type: 'saveAbsence', draft: next });
    onClose();
  };

  const decide = (status: 'approved' | 'rejected') => {
    if (!absence) return save(status);
    dispatch({ type: 'decideAbsence', id: absence.id, status });
    onClose();
  };

  const remove = () => {
    if (!absence) return;
    if (!confirmDelete) return setConfirmDelete(true);
    dispatch({ type: 'deleteAbsence', id: absence.id });
    onClose();
  };

  const typeOptions = ABSENCE_TYPES.map((t) => ({ value: t.key, label: t.full }));
  const title = absence ? (readOnly ? 'Событие' : 'Изменить событие') : manager ? 'Новое событие' : 'Заявка на событие';

  return (
    <Dialog
      title={title}
      context={
        absence ? (
          <>
            {fullName(absence.employeeId)} · <span className={`status-tag ${absence.status}`}>{ABSENCE_STATUS_LABELS[absence.status]}</span>
            {absence.decidedBy && absence.status !== 'request' && ` · решение: ${shortName(absence.decidedBy)}`}
          </>
        ) : undefined
      }
      onClose={onClose}
    >
        <form
          className="form-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!readOnly) save();
          }}
        >
          {readOnly && (
            <p className="readonly-note" role="note">
              <Icon.Lock size={14} />
              {absence?.employeeId === user?.employeeId ? 'Согласованное событие меняет руководитель.' : 'Событие другого сотрудника: доступен только просмотр.'}
            </p>
          )}
          {!manager && !absence && (
            <p className="help-note" style={{ margin: 0 }}>Заявка уйдёт руководителю на согласование. До решения она не уменьшает остаток.</p>
          )}

          <div className="field-row">
            <div className="field">
              <span className="caps">Сотрудник</span>
              {manager && !readOnly ? (
                <Select<number>
                  variant="light"
                  label="Сотрудник"
                  value={draft.employeeId}
                  options={employees.map((e) => ({ value: e.id, label: shortName(e.id) }))}
                  onChange={(v) => set('employeeId', v)}
                />
              ) : (
                <div className="input">{shortName(draft.employeeId)}</div>
              )}
            </div>
            <div className="field">
              <span className="caps">Вид</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <i aria-hidden style={{ width: 10, height: 10, flex: 'none', background: `var(--abs-${draft.type})` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Select<AbsenceType>
                    variant="light"
                    label="Вид события"
                    value={draft.type}
                    options={typeOptions}
                    disabled={readOnly}
                    onChange={(v) => setDraft((d) => ({ ...d, type: v, to: v === 'sick' ? d.to : (d.to ?? d.from) }))}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="caps">С</span>
              <DateField value={draft.from} readOnly={readOnly} invalid={!!errors.from} onChange={setFrom} />
            </label>
            <label className="field">
              <span className="caps">По (включительно)</span>
<DateField
                value={draft.to ?? ''}
                disabled={draft.to === null}
                placeholder={draft.to === null ? 'не известна' : undefined}
                readOnly={readOnly}
                invalid={!!errors.to}
                onChange={(v) => set('to', v)}
              />
            </label>
          </div>
          {draft.type === 'sick' && !readOnly && (
            <Checkbox checked={draft.to === null} onChange={(open) => set('to', open ? null : draft.from)}>
              Дата окончания не известна (больничный открыт)
            </Checkbox>
          )}
          {(errors.from || errors.to || errors.overlap || (!valid && draft.to !== null)) && (
            <span className="field-error">{errors.from ?? errors.to ?? errors.overlap ?? 'Последний день раньше первого: исправьте даты.'}</span>
          )}

          <div className="abs-calc" aria-live="polite">
            <div>
              <b>{days}</b>
              <small>
                {draft.type === 'dayoff' ? plural(days, 'рабочий день', 'рабочих дня', 'рабочих дней') : plural(days, 'календарный день', 'календарных дня', 'календарных дней')}
                {draft.to === null && ' (по сегодня +3)'}
              </small>
            </div>
            {leftNow !== null ? (
              <>
                <div>
                  <b>{leftNow}</b>
                  <small>{counted === 'vacation' ? 'дней отпуска сейчас' : 'отгулов сейчас'}</small>
                </div>
                <div>
                  <b className={leftAfter! < 0 ? 'bad' : ''}>{leftAfter}</b>
                  <small>{leftAfter! < 0 ? 'превышение остатка' : 'останется'}</small>
                </div>
              </>
            ) : (
              <div style={{ gridColumn: 'span 2' }}>
                <small>{absenceType(draft.type).full} не уменьшает остаток отпуска и отгулов.</small>
              </div>
            )}
          </div>

          {clashing.length > 0 && (
            <div className="warn-note" role="note">
              <b>Пересекается со сроками {clashing.length} {plural(clashing.length, 'задачи', 'задач', 'задач')}.</b> Их стоит перенести или передать:
              <ul>
                {clashing.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    «{t.title}» — срок {fmtDate(new Date(t.end))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="field">
            <span className="caps">Комментарий</span>
            <TextInput value={draft.note} readOnly={readOnly} maxLength={500} placeholder="Основание, номер приказа или листа" onChange={(e) => set('note', e.target.value)} />
          </label>

          {manager && !readOnly && (
            <div className="field">
              <span className="caps">Статус</span>
              <Segmented label="Статус события" value={draft.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
            </div>
          )}

          <div className="form-actions">
            {/* Удаление — слева, основные действия — справа. */}
            {absence && access.delete && (
              <button type="button" className="btn btn--danger" onClick={remove}>
                <Icon.Trash size={15} /> {confirmDelete ? 'Точно удалить?' : manager ? 'Удалить' : 'Отозвать'}
              </button>
            )}
            <span className="spacer" />
            {readOnly ? (
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Закрыть
              </button>
            ) : (
              <>
                <button type="submit" className="btn btn--primary">
                  <Icon.Save size={15} /> {manager ? 'Сохранить' : absence ? 'Сохранить заявку' : 'Подать заявку'}
                </button>
                {manager && absence?.status === 'request' && (
                  <>
                    <button type="button" className="btn" style={{ color: 'var(--ok)' }} onClick={() => decide('approved')}>
                      <Icon.Check size={15} /> Согласовать
                    </button>
                    <button type="button" className="btn btn--danger" onClick={() => decide('rejected')}>
                      Отклонить
                    </button>
                  </>
                )}
                <button type="button" className="btn" onClick={onClose}>
                  Отмена
                </button>
              </>
            )}
          </div>
          {absence && (
            <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
              {fmtSpan(absence)} · создано {fmtDate(new Date(absence.createdAt))}
            </p>
          )}
        </form>
    </Dialog>
  );
};

