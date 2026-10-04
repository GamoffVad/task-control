import { useCallback, useRef, useState, type ReactNode } from 'react';
import { employees, shortName } from '../lib/data';
import { useCategorySelectOptions } from '../lib/categories';
import { fmtNum, fromInputDateTime, toInputDateTime } from '../lib/dates';
import { baseScore, MAX_SCORE, MIN_SCORE, validateTask, type TaskDraft, type TaskErrors } from '../lib/logic';
import { taskAccess } from '../lib/permissions';
import { useStore } from '../lib/store';
import { useScopeEmployees } from '../lib/useScope';
import { covers, fmtSpan, isActive } from '../lib/absences';
import { absenceType } from '../lib/data';
import type { Category, User } from '../lib/types';
import { EditorContext, type OpenArgs } from './taskEditor';
import { Checkbox, DateTimeField, Dialog, Select, TextArea, TextInput } from '../kit';
import { Icon } from './Icons';
import { AssigneePicker } from './AssigneePicker';

const emptyDraft = (user: User | null, defaults: Partial<TaskDraft> = {}): TaskDraft => {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 3600_000);
  const draft: TaskDraft = {
    title: '',
    rowId: null,
    category: null,
    assigneeIds: [],
    start: start.toISOString(),
    end: end.toISOString(),
    docName: '',
    docNumber: '',
    result: '',
    done: false,
    score: null,
    ...defaults,
  };
  // Исполнитель заводит задачи только себе.
  if (user?.role === 'executor') draft.assigneeIds = [user.employeeId];
  return draft;
};

export const TaskEditorProvider = ({ children }: { children: ReactNode }) => {
  const [args, setArgs] = useState<OpenArgs | null>(null);
  const openTask = useCallback((a: OpenArgs) => setArgs(a), []);
  return (
    <EditorContext.Provider value={{ openTask }}>
      {children}
      {args && <TaskModal key={args.task?.id ?? 'new'} {...args} onClose={() => setArgs(null)} />}
    </EditorContext.Provider>
  );
};

const parseScore = (text: string): number | null => {
  const n = parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
};

const TaskModal = ({ task, defaults, context, onClose }: OpenArgs & { onClose: () => void }) => {
  const { state, dispatch } = useStore();
  const categoryOptions = useCategorySelectOptions();
  const user = state.user;
  const access = taskAccess(user, task ?? null);
  const [draft, setDraft] = useState<TaskDraft>(() => (task ? { ...task } : emptyDraft(user, defaults)));
  const [scoreText, setScoreText] = useState<string | null>(null);
  const [errors, setErrors] = useState<TaskErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const isNew = !task;
  const readOnly = !access.plan && !access.execution;
  const rowOptions = [
    { value: '', label: 'Вне плана' },
    ...state.planRows.map((r) => ({
      value: r.id,
      label: `${'   '.repeat(r.id.split('.').length - 1)}${r.isHeader ? '' : '– '}${r.id}  ${r.title}`,
    })),
  ];

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const setDate = (key: 'start' | 'end', value: string) => {
    const d = fromInputDateTime(value);
    if (!d) return;
    setDraft((prev) => {
      const next = { ...prev, [key]: d.toISOString() };
      // Перенос начала сдвигает окончание, сохраняя длительность.
      if (key === 'start') {
        const dur = new Date(prev.end).getTime() - new Date(prev.start).getTime();
        next.end = new Date(d.getTime() + Math.max(dur, 0)).toISOString();
      }
      // Ошибка по срокам показывается сразу, а не только при сохранении.
      setErrors((errs) => ({ ...errs, end: new Date(next.end) < new Date(next.start) ? 'Окончание раньше начала: исправьте дату или время.' : undefined }));
      return next;
    });
  };

  const setResult = (value: string) => setDraft((d) => ({ ...d, result: value, done: value.trim() ? d.done : false }));

  const base = baseScore(draft.rowId, state.planRows);
  const effectiveScore = draft.score ?? base;
  const scoreChanged = draft.score !== null && draft.score !== base;

  const onScoreText = (text: string) => {
    setScoreText(text);
    const n = text.trim() === '' ? null : parseScore(text);
    // Значение, равное базовому, хранится как «базовое», чтобы следовать справочнику.
    set('score', n === null || n === base ? null : n);
  };

  const resetScore = () => {
    setScoreText(null);
    set('score', null);
  };

  const save = () => {
    const errs = validateTask(draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    dispatch({ type: 'saveTask', draft: { ...draft, title: draft.title.trim(), result: draft.result.trim() } });
    onClose();
  };

  const remove = () => {
    if (!task) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    dispatch({ type: 'deleteTask', id: task.id });
    onClose();
  };

  // Кто из исполнителей отсутствует в день срока.
  const absentees = draft.done
    ? []
    : draft.assigneeIds.flatMap((id) => {
        const a = state.absences.find((x) => x.employeeId === id && isActive(x) && covers(x, new Date(draft.end)));
        return a ? [{ id, a }] : [];
      });

  const row = draft.rowId ? state.planRows.find((item) => item.id === draft.rowId) : null;
  const rowIsHeader = !!row?.isHeader;
  // Исполнитель назначает только себя, руководитель — тех, чьи задачи ему видны; уже назначенные остаются в списке.
  const visibleEmployees = useScopeEmployees();
  const assigneeChoices = access.plan && user?.role === 'executor'
    ? employees.filter((e) => e.id === user.employeeId)
    : employees.filter((e) => visibleEmployees.some((v) => v.id === e.id) || draft.assigneeIds.includes(e.id));

  return (
    <Dialog
      wide
      title={isNew ? 'Новая задача' : 'Задача'}
      context={context ?? (task ? task.assigneeIds.map(shortName).join(', ') : undefined)}
      onClose={onClose}
      initialFocus={access.plan ? titleRef : undefined}
    >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!readOnly) save();
          }}
          noValidate
        >
          {!access.plan && (
            <p className="readonly-note" role="note">
              <Icon.Lock size={14} />
              {readOnly
                ? 'Задача назначена другому сотруднику: доступен только просмотр.'
                : 'Содержание и сроки задачи определяет руководитель. Вы можете указать документ, результат и отметить исполнение.'}
            </p>
          )}

          <div className="task-grid">
            <div className="task-col">
              {/* Многострочное название: растягивается на свободную высоту колонки, чтобы вставлять формулировки из плана. */}
              <div className="field task-title-field">
                <label className="caps" htmlFor="task-title">Название</label>
                <TextArea
                  id="task-title"
                  ref={titleRef}
                  rows={3}
                  value={draft.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Что нужно сделать"
                  invalid={!!errors.title}
                  aria-describedby={errors.title ? 'task-title-error' : undefined}
                  readOnly={!access.plan}
                />
                {errors.title && <span className="field-error" id="task-title-error">{errors.title}</span>}
              </div>

              <div className="field-row">
                <label className="field">
                  <span className="caps">Начало</span>
                  <DateTimeField value={toInputDateTime(new Date(draft.start))} onChange={(v) => setDate('start', v)} readOnly={!access.plan} step={15} />
                </label>
                <label className="field">
                  <span className="caps">Окончание (срок)</span>
    <DateTimeField
                    value={toInputDateTime(new Date(draft.end))}
                    onChange={(v) => setDate('end', v)}
                    invalid={!!errors.end}
                    readOnly={!access.plan}
                    step={15}
                  />
                </label>
              </div>
              {errors.end && <span className="field-error">{errors.end}</span>}
              {absentees.length > 0 && (
                <p className="warn-note" role="note">
                  <b>Срок приходится на отсутствие исполнителя.</b>{' '}
                  {absentees.map(({ id, a }) => `${shortName(id)} — ${absenceType(a.type).label.toLowerCase()} ${fmtSpan(a)}${a.status === 'request' ? ' (заявка)' : ''}`).join('; ')}.
                  {access.plan && ' Перенесите срок или передайте задачу.'}
                </p>
              )}

              <div className="field-row">
                <div className="field">
                  <span className="caps">Раздел планирования</span>
                  <Select<string> variant="light" label="Раздел планирования" value={draft.rowId ?? ''} options={rowOptions} onChange={(v) => set('rowId', v || null)} disabled={!access.plan} />
                </div>
                <div className="field">
                  <span className="caps">Категория</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span aria-hidden style={{ width: 10, height: 10, flex: 'none', borderRadius: 1, background: `var(--cat-${draft.category ?? 'none'}, var(--cat-none))` }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Select<Category | ''>
                        variant="light"
                        label="Категория"
                        value={draft.category ?? ''}
                        options={categoryOptions}
                        onChange={(v) => set('category', v || null)}
                        disabled={!access.plan}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {rowIsHeader && <span className="field-error">Это раздел плана. Выберите позицию внутри раздела, иначе задача не попадёт в матрицу и отчёт.</span>}
              {row && !row.isHeader && <span className="muted" style={{ fontSize: 12, marginTop: -6 }}>Задача появится в матрице «Планирования» и после исполнения попадёт в отчёт.</span>}

              <div className="field-row">
                <label className="field">
                  <span className="caps">Документ</span>
                  <TextInput value={draft.docName} onChange={(e) => set('docName', e.target.value)} placeholder="Наименование" readOnly={!access.execution} />
                </label>
                <label className="field">
                  <span className="caps">Номер документа</span>
                  <TextInput mono value={draft.docNumber} onChange={(e) => set('docNumber', e.target.value)} placeholder="№" readOnly={!access.execution} />
                </label>
              </div>
            </div>
            <div className="task-col">
              <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend className="caps" style={{ padding: 0, marginBottom: 4 }}>Исполнители</legend>
                <AssigneePicker
                  choices={assigneeChoices}
                  selected={draft.assigneeIds}
                  onChange={(update) => setDraft((d) => ({ ...d, assigneeIds: update(d.assigneeIds) }))}
                  readOnly={!access.plan || user?.role === 'executor'}
                  absence={(id) => {
                    if (draft.done) return null;
                    const a = state.absences.find((x) => x.employeeId === id && isActive(x) && covers(x, new Date(draft.end)));
                    return a ? absenceType(a.type).label.toLowerCase() + (a.status === 'request' ? ' (заявка)' : '') : null;
                  }}
                />
                {errors.assigneeIds && <span className="field-error">{errors.assigneeIds}</span>}
              </fieldset>

              <div className={`done-box${draft.done ? ' on' : ''}`}>
                <div className="field">
                  <label className="caps" htmlFor="task-result">Результат исполнения</label>
                  <TextArea
                    id="task-result"
                    rows={2}
                    value={draft.result}
                    onChange={(e) => setResult(e.target.value)}
                    placeholder="Что фактически сделано"
                    readOnly={!access.execution}
                  />
                </div>
                <Checkbox tone="ok" checked={draft.done} disabled={!access.execution || !draft.result.trim()} onChange={(v) => set('done', v)}>
                  {draft.result.trim() ? (draft.done ? 'Исполнено' : 'Отметить как исполненное') : 'Отметка доступна после описания результата'}
                </Checkbox>
                {errors.done && <span className="field-error">{errors.done}</span>}
                {/* Баллы видит и меняет только руководитель; исполнитель видит свои баллы в карточке сотрудника. */}
                {access.score && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label className="caps" htmlFor="task-score">Баллы за исполнение</label>
                    {base === null ? (
                      // Вне плана веса нет: поле пустое и неактивно, чтобы было видно, почему баллов нет.
                      <div className="score-row">
                        <TextInput id="task-score" value="" disabled placeholder="—" aria-describedby="task-score-base" />
                        <span className="base" id="task-score-base">
                          Базовый вес позиции указывается только за задачи из основных категорий.
                        </span>
                      </div>
                    ) : (
                      <div className="score-row">
                        <TextInput
                          id="task-score"
                          inputMode="decimal"
                          value={scoreText ?? fmtNum(effectiveScore ?? 0)}
                          onChange={(e) => onScoreText(e.target.value)}
                          onBlur={() => setScoreText(null)}
                          invalid={!!errors.score}
                          aria-describedby="task-score-base"
                        />
                        <button type="button" className="text-action" onClick={resetScore} disabled={!scoreChanged}>
                          ↺ Сбросить к базовому
                        </button>
                        <span className="base" id="task-score-base">
                          базовый вес позиции: <span className="num">{fmtNum(base)}</span>
                          {scoreChanged && <span className="amber"> · изменено</span>}
                        </span>
                      </div>
                    )}
                    {errors.score && <span className="field-error">{errors.score}</span>}
                    {base !== null && (
                      <span className="faint" style={{ fontSize: 11.5 }}>
                        От {fmtNum(MIN_SCORE)} до {fmtNum(MAX_SCORE)}. Баллы начисляются исполнителю, когда задача попадёт в отчёт по кнопке «Направить в отчёт».
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="form-actions">
            {/* Удаление — слева, основные действия — справа. */}
            {!isNew && access.delete && (
              <button type="button" className="btn btn--danger" onClick={remove}>
                <Icon.Trash size={15} /> {confirmDelete ? 'Точно удалить?' : 'Удалить'}
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
                  <Icon.Save size={15} /> Сохранить
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  Отмена
                </button>
              </>
            )}
          </div>
        </form>
    </Dialog>
  );
};
