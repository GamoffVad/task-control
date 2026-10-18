import { useEffect, useMemo, useState, type ReactNode, type PointerEvent } from 'react';
import { useTaskEditor } from '../components/taskEditor';
import { EmployeeFilter } from '../components/ui';
import { FilterCard, MultiSelect, PageHeader, SearchField, Segmented, Stepper } from '../kit';
import { Icon } from '../components/Icons';
import { CATEGORIES, categoryLabel, shortName } from '../lib/data';
import { catColor, useCategoryOptions, type CatKey } from '../lib/categories';
import {
  addDays,
  addMonths,
  fmtDate,
  fmtDateTime,
  fmtDayMonth,
  fmtMonthYear,
  fmtRange,
  fmtTime,
  fmtWeekday,
  isSameDay,
  startOfDay,
  startOfWeek,
} from '../lib/dates';
import { isOverdue, searchTasks } from '../lib/logic';
import { FIRST_HOUR, LAST_HOUR, layoutDay, movedTaskDates } from '../lib/calendarLayout';
import { isManager, taskAccess } from '../lib/permissions';
import { useCalendarDrag, type CalendarDrop } from '../lib/useCalendarDrag';
import { loadCalendarView, storeCalendarView } from '../lib/calendarView';
import { useStore } from '../lib/store';
import { useClashes } from '../lib/useClashes';
import type { Clash } from '../lib/absences';
import type { CalendarView, Task } from '../lib/types';

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
];

const catStyle = (t: Pick<Task, 'category'>) => catColor(t.category ?? 'none');
const stateClass = (t: Task, now: Date) => (t.done ? ' done' : isOverdue(t, now) ? ' overdue' : '');
/** Исполнители мероприятия: в узком событии — первый и «+N», иначе все. */
const whoOf = (t: Task, short = false) => {
  const names = t.assigneeIds.map(shortName);
  return short && names.length > 1 ? `${names[0]} +${names.length - 1}` : names.join(', ');
};

/** Значок состояния: цвет события занят категорией, поэтому исполнение и просрочка — знаком. */
const StateMark = ({ task, now }: { task: Task; now: Date }) =>
  task.done ? (
    <span className="state ok" aria-label="исполнено">✓</span>
  ) : isOverdue(task, now) ? (
    <span className="state bad" aria-label="просрочено">!</span>
  ) : null;

/** Подсветка найденных слов в строке. */
const highlight = (text: string, query: string): ReactNode => {
  const words = query.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/gi, '[её]'));
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
};

export const Calendar = () => {
  const { state, dispatch } = useStore();
  const { openTask } = useTaskEditor();
  const manager = isManager(state.user);
  const employeeId = state.user?.employeeId;
  // Вид запоминается за сотрудником: при следующем заходе календарь открывается в том же виде.
  const [view, setViewState] = useState<CalendarView>(() => loadCalendarView(employeeId));
  const setView = (next: CalendarView) => {
    setViewState(next);
    storeCalendarView(next, employeeId);
  };
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  // Исполнитель по умолчанию видит свои задачи, но может посмотреть и весь отдел.
  const [employee, setEmployee] = useState<number | null>(manager ? null : (state.user?.employeeId ?? null));
  const [query, setQuery] = useState('');
  const { keys: allCats, options: catOptions } = useCategoryOptions();
  // Снятые категории хранятся отдельно: добавленная в словаре категория сразу показывается.
  const [hiddenCats, setHiddenCats] = useState<Set<CatKey>>(() => new Set());
  const cats = useMemo(() => new Set(allCats.filter((k) => !hiddenCats.has(k))), [allCats, hiddenCats]);
  const [now, setNow] = useState(() => new Date());
  const clashes = useClashes();
  const [moveMessage, setMoveMessage] = useState('');
  const canMove = (task: Task) => taskAccess(state.user, task).plan;
  const moveTask = (task: Task, start: Date) => {
    if (!canMove(task) || start.getTime() === new Date(task.start).getTime()) return;
    dispatch({ type: 'saveTask', draft: { ...task, ...movedTaskDates(task, start) } });
    setMoveMessage(`Перенесено: ${task.title} — ${fmtDateTime(start)}`);
  };
  const step = (dir: 1 | -1) => {
    if (view === 'day') setCursor((c) => addDays(c, dir));
    else if (view === 'month') setCursor((c) => addMonths(c, dir));
    else setCursor((c) => addDays(c, 7 * dir));
  };
  const { root, draggingId, drop, edgeDirection, onStart, ...dragEvents } = useCalendarDrag(state.tasks, canMove, moveTask, {
    onNavigate: step,
    periodKey: `${view}:${cursor.toISOString()}`,
  });
  const drag = { draggingId, drop, onStart, canMove };

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const tasks = useMemo(() => {
    const byFilters = state.tasks.filter(
      (t) => (employee === null || t.assigneeIds.includes(employee)) && cats.has(t.category ?? 'none'),
    );
    return searchTasks(byFilters, query, state.planRows);
  }, [state.tasks, state.planRows, employee, cats, query]);

  const found = useMemo(() => (query.trim() ? [...tasks].sort((a, b) => a.start.localeCompare(b.start)) : []), [tasks, query]);

  const days = useMemo(() => {
    if (view === 'day') return [cursor];
    const monday = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [view, cursor]);

  const title =
    view === 'day'
      ? `${fmtWeekday(cursor)}, ${fmtDayMonth(cursor)}`
      : view === 'month'
        ? fmtMonthYear(cursor)
        : fmtRange(days[0], days[days.length - 1]);

  const create = (start: Date, minutes = 60) =>
    openTask({
      defaults: {
        start: start.toISOString(),
        end: new Date(start.getTime() + minutes * 60_000).toISOString(),
        assigneeIds: employee ? [employee] : [],
      },
    });


  const goTo = (t: Task) => {
    setCursor(startOfDay(new Date(t.start)));
    openTask({ task: t });
  };

  return (
    <div className={`calendar-layout${draggingId ? ' calendar-dragging' : ''}`} ref={root} tabIndex={-1} {...dragEvents}>
      {/* Заголовок и фильтры закреплены под шапкой приложения: при прокрутке они остаются на месте. */}
      <div className="sticky-head">
      <PageHeader
        title="Календарь"
        toolbar={
          <>
            <div className="tool">
              <span className="caps">Период</span>
              <Stepper label="Период" value={title} onPrev={() => step(-1)} onNext={() => step(1)} onToday={() => setCursor(startOfDay(new Date()))} />
            </div>
            <div className="tool tool--calendar-view">
              <span className="caps">Вид</span>
              <Segmented label="Вид календаря" value={view} options={VIEWS} onChange={setView} />
            </div>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn--primary" onClick={() => create(nextQuarter())}>
              <Icon.Plus size={15} /> Новая задача
            </button>
          </>
        }
      />
      <div className="filters">
        <FilterCard label="Исполнитель">
          <EmployeeFilter value={employee} onChange={setEmployee} />
        </FilterCard>
        <FilterCard label="Категории">
          <MultiSelect<CatKey>
            label="Категории мероприятий"
            allLabel="все категории"
            options={catOptions}
            value={allCats.filter((k) => cats.has(k))}
            onChange={(shown) => setHiddenCats(new Set(allCats.filter((k) => !shown.includes(k))))}
          />
        </FilterCard>
        <FilterCard label="Поиск">
          <SearchField value={query} onChange={setQuery} placeholder="Название, результат, документ…" label="Поиск мероприятий по содержанию" />
        </FilterCard>
      </div>
      </div>
      {manager && <p className="calendar-move-note" role="status">{moveMessage || 'Перетащите задачу в другой день или интервал. Удерживайте у края календаря для смены дня, недели или месяца. Alt+←/→ — день, Alt+↑/↓ — 30 минут. Escape — отмена переноса.'}</p>}
      {edgeDirection && <div className={`calendar-edge-hint calendar-edge-hint--${edgeDirection < 0 ? 'left' : 'right'}`} role="status">
        {edgeDirection < 0 ? '← ' : ''}{view === 'day' ? (edgeDirection < 0 ? 'Предыдущий день' : 'Следующий день') : view === 'month' ? (edgeDirection < 0 ? 'Предыдущий месяц' : 'Следующий месяц') : (edgeDirection < 0 ? 'Предыдущая неделя' : 'Следующая неделя')}{edgeDirection > 0 ? ' →' : ''}
      </div>}

      {query.trim() && (
        <section className="search-results" aria-label="Результаты поиска">
          <p className="caps" style={{ margin: '4px 0 6px' }} role="status">
            {found.length ? `Найдено: ${found.length}. Нажмите, чтобы перейти к дню и открыть задачу` : 'Ничего не найдено. Измените запрос или включите все категории.'}
          </p>
          {found.length > 0 && (
            <ul>
              {found.slice(0, 50).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => goTo(t)} style={catStyle(t)}>
                    <span className="num" style={{ color: 'var(--ink-3)', fontSize: 12 }}>{fmtDate(new Date(t.start))}</span>
                    <i aria-hidden data-tip={categoryLabel(t.category)} />
                    <span>
                      <StateMark task={t} now={now} />
                      {highlight(t.title, query)}
                      <span className="faint" style={{ fontSize: 12 }}> · {t.assigneeIds.map(shortName).join(', ')}</span>
                      {t.result && <span className="faint" style={{ display: 'block', fontSize: 12 }}>{highlight(t.result, query)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view === 'month' ? (
        <MonthView cursor={cursor} tasks={tasks} now={now} clashes={clashes} drag={drag} onCreate={(d) => { const s = new Date(d); s.setHours(10, 0, 0, 0); create(s); }} onOpen={(t) => openTask({ task: t })} />
      ) : (
        <div className="cal">
          <div className="cal-scroll" data-calendar-surface>
            <div className="cal-grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(${view === 'day' ? 240 : 110}px, 1fr))` }}>
              <div className="cal-corner" />
              {days.map((d) => (
                <div key={d.toISOString()} className={`cal-head${isSameDay(d, now) ? ' today' : ''}`}>
                  <span className="wd">{fmtWeekday(d)}</span>
                  <span className="d">{d.getDate()}</span>
                </div>
              ))}
              <div className="cal-hours" aria-hidden>
                {HOURS.map((h) => (
                  <div key={h} className="cal-hour">{h > FIRST_HOUR ? `${String(h).padStart(2, '0')}:00` : ''}</div>
                ))}
              </div>
              {days.map((d) => (
                <DayColumn key={d.toISOString()} day={d} tasks={tasks} now={now} clashes={clashes} drag={drag} onCreate={create} onOpen={(t) => openTask({ task: t })} />
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="legend" style={{ marginTop: 12 }}>
        {CATEGORIES.map((c) => (
          <span key={c.key}><i className="cat" style={catColor(c.key)} />{c.short}</span>
        ))}
        <span><i className="cat" style={catColor('none')} />иное</span>
        <span><span className="state ok">✓</span>исполнено (зелёная полоса справа)</span>
        <span><span className="state bad">!</span>просрочено (красная полоса и рамка)</span>
        <span><i className="legend-bar" aria-hidden />отсутствует в день срока</span>
      </div>
    </div>
  );
};

const nextQuarter = () => {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
};

type CalendarDrag = {
  draggingId: string | null;
  drop: CalendarDrop | null;
  onStart: (event: PointerEvent<HTMLButtonElement>, task: Task) => void;
  canMove: (task: Task) => boolean;
};

const DayColumn = ({ day, tasks, now, clashes, drag, onCreate, onOpen }: {
  day: Date;
  tasks: Task[];
  now: Date;
  clashes: Clash[];
  drag: CalendarDrag;
  onCreate: (start: Date) => void;
  onOpen: (t: Task) => void;
}) => {
  const placed = useMemo(() => layoutDay(tasks, day), [tasks, day]);
  const today = isSameDay(day, now);
  const nowOffset = now.getHours() + now.getMinutes() / 60 - FIRST_HOUR;
  const previewTask = drag.drop?.day === day.toISOString() ? tasks.find((task) => task.id === drag.drop?.taskId) : null;
  const preview = previewTask && drag.drop ? layoutDay([{ ...previewTask, ...movedTaskDates(previewTask, drag.drop.start) }], day)[0] : null;
  return (
    <div className={`cal-day${today ? ' today' : ''}`} data-calendar-day={day.toISOString()} data-calendar-mode="time">
      {HOURS.flatMap((h) =>
        [0, 30].map((m) => {
          const s = new Date(day);
          s.setHours(h, m, 0, 0);
          return (
            <button
              key={`${h}:${m}`}
              type="button"
              className="cal-slot"
              aria-label={`Создать задачу: ${fmtDayMonth(day)}, ${fmtTime(s)}`}
              onClick={() => onCreate(s)}
            />
          );
        }),
      )}
      {placed.map(({ task, top, height, lane, lanes }) => (
        <button
          key={task.id}
          type="button"
          className={`cal-event cat${stateClass(task, now)}${clashes.some((c) => c.task.id === task.id) ? ' absent' : ''}${drag.canMove(task) ? ' calendar-movable' : ''}${drag.draggingId === task.id ? ' calendar-moving' : ''}`}
          data-calendar-task={task.id}
          draggable={false}
          onPointerDown={(event) => drag.onStart(event, task)}
          style={{
            ...catStyle(task),
            top: `calc(var(--hour) * ${top})`,
            height: `calc(var(--hour) * ${height} - 2px)`,
            left: `calc(${(lane / lanes) * 100}% + 3px)`,
            width: `calc(${100 / lanes}% - 6px)`,
            right: 'auto',
          }}
          onClick={() => onOpen(task)}
          data-tip={`${fmtTime(new Date(task.start))}–${fmtTime(new Date(task.end))} ${task.title}${task.category ? ` — ${categoryLabel(task.category)}` : ''} · ${whoOf(task)}${task.done ? '. Исполнено' : isOverdue(task, now) ? '. Просрочено' : ''}${clashes.some((c) => c.task.id === task.id) ? '. Исполнитель отсутствует в день срока' : ''}`}
        >
          {/* В коротком событии время стоит в строке с названием, чтобы название поместилось. */}
          <span className="ti">
            {height < 1.25 ? (
              <span className="t inline">{fmtTime(new Date(task.start))}</span>
            ) : (
              <span className="t">
                {fmtTime(new Date(task.start))}–{fmtTime(new Date(task.end))}
              </span>
            )}
            <StateMark task={task} now={now} />
            {task.title}
          </span>
          {/* Исполнитель виден всегда: в низком событии — в одну строку с названием. */}
          {height >= 1.4 ? <span className="who">{whoOf(task)}</span> : <span className="who inline"> · {whoOf(task, true)}</span>}
        </button>
      ))}
      {preview && <div className="cal-drop-preview" aria-hidden style={{ top: `calc(var(--hour) * ${preview.top})`, height: `calc(var(--hour) * ${preview.height} - 2px)` }}>
        <b>{fmtTime(new Date(preview.task.start))}–{fmtTime(new Date(preview.task.end))}</b><span>{preview.task.title}</span>
      </div>}
      {today && nowOffset >= 0 && nowOffset <= LAST_HOUR - FIRST_HOUR && (
        <div className="cal-now" style={{ top: `calc(var(--hour) * ${nowOffset})` }} aria-hidden />
      )}
    </div>
  );
};

const MonthView = ({ cursor, tasks, now, clashes, drag, onCreate, onOpen }: {
  cursor: Date;
  tasks: Task[];
  now: Date;
  clashes: Clash[];
  drag: CalendarDrag;
  onCreate: (d: Date) => void;
  onOpen: (t: Task) => void;
}) => {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = startOfDay(new Date(t.start)).toDateString();
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [tasks]);

  return (
    <div className="table-scroll cal cal--month" data-calendar-surface>
      <div className="month-grid">
        {cells.slice(0, 7).map((d) => (
          <div key={`wd-${d.getDay()}`} className="wd caps">{fmtWeekday(d)}</div>
        ))}
        {cells.map((d) => {
          const list = byDay.get(d.toDateString()) ?? [];
          const other = d.getMonth() !== cursor.getMonth();
          return (
            <div
              key={d.toISOString()}
              className={`month-cell${other ? ' other' : ''}${isSameDay(d, now) ? ' today' : ''}${drag.drop?.day === d.toISOString() ? ' calendar-drop-day' : ''}`}
              data-calendar-day={d.toISOString()}
              data-calendar-mode="month"
              onClick={() => onCreate(d)}
              role="button"
              tabIndex={0}
              aria-label={`${fmtDayMonth(d)}: задач ${list.length}. Создать задачу`}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onCreate(d);
                }
              }}
            >
              <span className="d">{d.getDate()}</span>
              <div className="month-tasks">
                {list.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip cat${stateClass(t, now)}${clashes.some((c) => c.task.id === t.id) ? ' absent' : ''}${drag.canMove(t) ? ' calendar-movable' : ''}${drag.draggingId === t.id ? ' calendar-moving' : ''}`}
                    data-calendar-task={t.id}
                    draggable={false}
                    onPointerDown={(event) => drag.onStart(event, t)}
                    style={catStyle(t)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(t);
                    }}
                    data-tip={`${t.title}${t.category ? ` — ${categoryLabel(t.category)}` : ''} · ${whoOf(t)}${t.done ? '. Исполнено' : isOverdue(t, now) ? '. Просрочено' : ''}${clashes.some((c) => c.task.id === t.id) ? '. Исполнитель отсутствует в день срока' : ''}`}
                  >
                    <span className="num" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginRight: 4 }}>{fmtTime(new Date(t.start))}</span>
                    <StateMark task={t} now={now} />
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
