import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/Icons';
import { addMonths, fromDateKey, isSameDay, toDateKey } from '../lib/dates';

// Выбор даты и времени вместо системного календаря браузера.
// Значения — как у стандартных полей: дата «2026-09-17», дата и время «2026-09-17T10:00».

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const pad = (n: number) => String(n).padStart(2, '0');

type Mode = 'date' | 'datetime';

const display = (value: string, mode: Mode): string => {
  if (!value) return '';
  const [d, t] = value.split('T');
  const [y, m, day] = d.split('-');
  return mode === 'datetime' && t ? `${day}.${m}.${y} ${t}` : `${day}.${m}.${y}`;
};

/** Разбор введённого текста: «17.09.2026», «17.9.2026 9:30», «2026-09-17», «2026-09-17T09:30». */
const parse = (text: string, mode: Mode, fallbackTime: string): string | null => {
  const s = text.trim();
  let y: number, m: number, d: number, hh: number | null = null, mm: number | null = null;
  let r = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (r) [d, m, y] = [+r[1], +r[2], +r[3]];
  else {
    r = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(s);
    if (!r) return null;
    [y, m, d] = [+r[1], +r[2], +r[3]];
  }
  if (r[4] != null) [hh, mm] = [+r[4], +r[5]];
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (mode === 'date') return toDateKey(date);
  if (hh == null) return `${toDateKey(date)}T${fallbackTime}`;
  if (hh > 23 || (mm ?? 0) > 59) return null;
  return `${toDateKey(date)}T${pad(hh)}:${pad(mm ?? 0)}`;
};

const monthGrid = (month: Date): Date[] => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - shift + i));
};

const TIMES = (step: number) => Array.from({ length: (24 * 60) / step }, (_, i) => `${pad(Math.floor((i * step) / 60))}:${pad((i * step) % 60)}`);

type Props = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  placeholder?: string;
  /** Шаг времени в минутах для списка времени. */
  step?: number;
};

function DateInput({ mode, value, onChange, id, disabled, readOnly, invalid, placeholder, step = 30 }: Props & { mode: Mode }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? fromDateKey(value.slice(0, 10)) : null;
  const time = value.slice(11, 16) || '09:00';
  const [month, setMonth] = useState(() => selected ?? new Date());
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date());
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const timeList = useRef<HTMLDivElement>(null);
  const popId = useId();
  const today = new Date();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Фокус держим на выбранном дне, а выбранное время прокручиваем в видимую часть списка.
  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLButtonElement>('[data-cursor="true"]')?.focus();
  }, [open, cursor]);
  useEffect(() => {
    if (!open || mode !== 'datetime') return;
    const list = timeList.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 2 + el.clientHeight / 2;
  }, [open, mode]);

  const show = () => {
    const base = selected ?? new Date();
    setMonth(base);
    setCursor(base);
    setOpen(true);
  };

  const pickDay = (d: Date) => {
    onChange(mode === 'date' ? toDateKey(d) : `${toDateKey(d)}T${time}`);
    setText(null);
    if (mode === 'date') setOpen(false);
    else setCursor(d);
  };

  const pickTime = (t: string) => {
    onChange(`${toDateKey(selected ?? cursor)}T${t}`);
    setText(null);
    setOpen(false);
  };

  const moveCursor = (days: number, months = 0) => {
    const next = months ? addMonths(cursor, months) : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + days);
    setCursor(next);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(next);
  };

  const onGridKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => moveCursor(-1),
      ArrowRight: () => moveCursor(1),
      ArrowUp: () => moveCursor(-7),
      ArrowDown: () => moveCursor(7),
      PageUp: () => moveCursor(0, -1),
      PageDown: () => moveCursor(0, 1),
      Home: () => moveCursor(-((cursor.getDay() + 6) % 7)),
      End: () => moveCursor(6 - ((cursor.getDay() + 6) % 7)),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
    }
  };

  const onPopKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Закрывается только календарь, окно вокруг остаётся.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector('input')?.focus();
    }
  };

  const commitText = (raw: string) => {
    const parsed = parse(raw, mode, time);
    if (parsed) onChange(parsed);
    return parsed;
  };

  const days = monthGrid(month);
  return (
    <div className={`datefield${open ? ' open' : ''}`} ref={root}>
      <input
        id={id}
        className="input num"
        inputMode="numeric"
        autoComplete="off"
        value={text ?? display(value, mode)}
        placeholder={placeholder ?? (mode === 'date' ? 'дд.мм.гггг' : 'дд.мм.гггг чч:мм')}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          // Полная дата применяется сразу, неполная — при уходе из поля.
          commitText(e.target.value);
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text != null) {
            e.preventDefault();
            commitText(text);
            setText(null);
          } else if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            show();
          }
        }}
      />
      {!readOnly && (
        <button
          type="button"
          className="datefield-btn"
          aria-label={mode === 'date' ? 'Выбрать дату в календаре' : 'Выбрать дату и время'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : show())}
        >
          <Icon.Calendar size={15} />
        </button>
      )}
      {open && (
        <div className={`datepop${mode === 'datetime' ? ' with-time' : ''}`} role="dialog" aria-label={mode === 'date' ? 'Выбор даты' : 'Выбор даты и времени'} id={popId} onKeyDown={onPopKey}>
          <div className="datepop-cal">
            <div className="datepop-head">
              <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setMonth((m) => addMonths(m, -1))}>
                <Icon.ChevronLeft size={14} />
              </button>
              <b aria-live="polite">
                {MONTHS[month.getMonth()]} {month.getFullYear()}
              </b>
              <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={() => setMonth((m) => addMonths(m, 1))}>
                <Icon.Chevron size={14} />
              </button>
            </div>
            <div className="datepop-grid" role="grid" ref={grid} onKeyDown={onGridKey}>
              {WEEKDAYS.map((w, i) => (
                <span key={w} className={`wd${i > 4 ? ' we' : ''}`} role="columnheader">
                  {w}
                </span>
              ))}
              {days.map((d) => {
                const other = d.getMonth() !== month.getMonth();
                const isSel = !!selected && isSameDay(d, selected);
                const isCur = isSameDay(d, cursor);
                return (
                  <button
                    key={d.getTime()}
                    type="button"
                    role="gridcell"
                    className={`day${other ? ' other' : ''}${[0, 6].includes(d.getDay()) ? ' we' : ''}${isSameDay(d, today) ? ' today' : ''}`}
                    aria-selected={isSel}
                    aria-label={`${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`}
                    tabIndex={isCur ? 0 : -1}
                    data-cursor={isCur}
                    onClick={() => pickDay(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="datepop-foot">
              <button type="button" className="text-action" onClick={() => pickDay(today)}>
                Сегодня
              </button>
              {value && <span className="num faint">{display(value, mode)}</span>}
            </div>
          </div>
          {mode === 'datetime' && (
            <div className="datepop-time" role="listbox" aria-label="Время" ref={timeList}>
              {TIMES(step).map((t) => (
                <button key={t} type="button" role="option" aria-selected={t === time} onClick={() => pickTime(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Поле даты с календарём в стиле приложения. */
export const DateField = (props: Props) => <DateInput mode="date" {...props} />;

/** Поле даты и времени: календарь и список времени с шагом step минут. */
export const DateTimeField = (props: Props) => <DateInput mode="datetime" {...props} />;
