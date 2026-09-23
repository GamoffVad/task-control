import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
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
import { FIRST_HOUR, LAST_HOUR, layoutDay } from '../lib/calendarLayout';
import { isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import { useClashes } from '../lib/useClashes';
import type { Clash } from '../lib/absences';
import type { CalendarView, Task } from '../lib/types';

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'workWeek', label: 'Рабочая неделя' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
];

const catStyle = (t: Pick<Task, 'category'>) => catColor(t.category ?? 'none');
const stateClass = (t: Task, now: Date) => (t.done ? ' done' : isOverdue(t, now) ? ' overdue' : '');

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
  const { state } = useStore();
  const { openTask } = useTaskEditor();
  const manager = isManager(state.user);
  const [view, setView] = useState<CalendarView>('workWeek');
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
    return Array.from({ length: view === 'workWeek' ? 5 : 7 }, (_, i) => addDays(monday, i));
  }, [view, cursor]);

  const step = (dir: 1 | -1) => {
    if (view === 'day') setCursor((c) => addDays(c, dir));
    else if (view === 'month') setCursor((c) => addMonths(c, dir));
    else setCursor((c) => addDays(c, 7 * dir));
  };

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
    <div className="calendar-layout">
      <PageHeader
        title="Календарь"
        subtitle="Задачи отдела во времени. Свободное время — новая задача, задача — открыть."
        actions={
          <>
            <button type="button" className="btn btn--primary" onClick={() => create(nextQuarter())}>
              <Icon.Plus size={15} /> Новая задача
            </button>
          </>
        }
      />
      <div className="filters">
        <FilterCard label="Период">
          <Stepper label="Период" value={title} onPrev={() => step(-1)} onNext={() => step(1)} onToday={() => setCursor(startOfDay(new Date()))} />
        </FilterCard>
        <FilterCard label="Вид">
          <Segmented label="Вид календаря" value={view} options={VIEWS} onChange={setView} />
        </FilterCard>
        <FilterCard label="Исполнитель">
          <EmployeeFilter value={employee} onChange={setEmployee} />
        </FilterCard>
        <FilterCard label="Поиск по содержанию">
          <SearchField value={query} onChange={setQuery} placeholder="Название, результат, документ…" label="Поиск мероприятий по содержанию" />
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
      </div>


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
        <MonthView cursor={cursor} tasks={tasks} now={now} onCreate={(d) => { const s = new Date(d); s.setHours(10, 0, 0, 0); create(s); }} onOpen={(t) => openTask({ task: t })} />
      ) : (
        <div className="cal">
          <div className="cal-scroll">
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
                <DayColumn key={d.toISOString()} day={d} tasks={tasks} now={now} clashes={clashes} onCreate={create} onOpen={(t) => openTask({ task: t })} />
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="legend" style={{ marginTop: 12 }}>
        {CATEGORIES.map((c) => (
          <span key={c.key}><i className="cat" style={catColor(c.key)} />{c.short}</span>
        ))}
        <span><i className="cat" style={{ '--c': 'var(--cat-none)' } as CSSProperties} />иное</span>
        <span><span className="state ok">✓</span>исполнено</span>
        <span><span className="state bad">!</span>просрочено (красная рамка)</span>
      </div>
    </div>
  );
};

const nextQuarter = () => {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
};

const DayColumn = ({ day, tasks, now, clashes, onCreate, onOpen }: {
  day: Date;
  tasks: Task[];
  now: Date;
  clashes: Clash[];
  onCreate: (start: Date) => void;
  onOpen: (t: Task) => void;
}) => {
  const placed = useMemo(() => layoutDay(tasks, day), [tasks, day]);
  const today = isSameDay(day, now);
  const nowOffset = now.getHours() + now.getMinutes() / 60 - FIRST_HOUR;
  return (
    <div className={`cal-day${today ? ' today' : ''}`}>
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
          className={`cal-event cat${stateClass(task, now)}${clashes.some((c) => c.task.id === task.id) ? ' absent' : ''}`}
          style={{
            ...catStyle(task),
            top: `calc(var(--hour) * ${top})`,
            height: `calc(var(--hour) * ${height} - 2px)`,
            left: `calc(${(lane / lanes) * 100}% + 3px)`,
            width: `calc(${100 / lanes}% - 6px)`,
            right: 'auto',
          }}
          onClick={() => onOpen(task)}
          data-tip={`${fmtTime(new Date(task.start))}–${fmtTime(new Date(task.end))} ${task.title}${task.category ? ` — ${categoryLabel(task.category)}` : ''}${clashes.some((c) => c.task.id === task.id) ? '. Исполнитель отсутствует в день срока' : ''}`}
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
          {height >= 1.4 && <span className="who">{task.assigneeIds.map(shortName).join(', ')}</span>}
        </button>
      ))}
      {today && nowOffset >= 0 && nowOffset <= LAST_HOUR - FIRST_HOUR && (
        <div className="cal-now" style={{ top: `calc(var(--hour) * ${nowOffset})` }} aria-hidden />
      )}
    </div>
  );
};

const MonthView = ({ cursor, tasks, now, onCreate, onOpen }: {
  cursor: Date;
  tasks: Task[];
  now: Date;
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
    <div className="table-scroll cal cal--month">
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
              className={`month-cell${other ? ' other' : ''}${isSameDay(d, now) ? ' today' : ''}`}
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
                    className={`chip cat${stateClass(t, now)}`}
                    style={catStyle(t)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(t);
                    }}
                    data-tip={`${t.title}${t.category ? ` — ${categoryLabel(t.category)}` : ''}`}
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
