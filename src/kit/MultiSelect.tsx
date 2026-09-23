import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

export type MultiOption<T extends string> = { value: T; label: string; style?: CSSProperties };

type Props<T extends string> = {
  options: MultiOption<T>[];
  /** Отмеченные значения. */
  value: T[];
  onChange: (value: T[]) => void;
  label: string;
  /** Подпись, когда отмечено всё. */
  allLabel: string;
  variant?: 'plain' | 'light';
};

/**
 * Выпадающий список с несколькими отметками: список не закрывается при выборе,
 * первая строка отмечает или снимает всё. Закрывается по Escape и клику вне; стрелки, Enter и пробел работают.
 */
export function MultiSelect<T extends string>({ options, value, onChange, label, allLabel, variant = 'plain' }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = new Set(value);
  const all = options.every((o) => selected.has(o.value));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const summary = all ? allLabel : value.length === 0 ? 'ничего' : value.length <= 2 ? options.filter((o) => selected.has(o.value)).map((o) => o.label).join(', ') : `${value.length} из ${options.length}`;
  const toggle = (v: T) => onChange(options.map((o) => o.value).filter((x) => (x === v ? !selected.has(x) : selected.has(x))));
  const toggleAll = () => onChange(all ? [] : options.map((o) => o.value));
  // Строка 0 — «все», дальше — значения.
  const act = (i: number) => (i === 0 ? toggleAll() : toggle(options[i - 1].value));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setFocus(0);
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => Math.min(options.length, f + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => Math.max(0, f - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act(focus);
    }
  };

  return (
    <div className={`dd dd--${variant} dd--multi`} ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="value">{summary}</span>
        <span className="arrow" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="dd-list" role="listbox" aria-multiselectable="true" id={listId} aria-label={label}>
          <li>
            <button type="button" role="option" aria-selected={all} className={`dd-multi-all${focus === 0 ? ' focus' : ''}`} onMouseEnter={() => setFocus(0)} onClick={toggleAll}>
              <i className="dd-check" aria-hidden />
              {allLabel}
            </button>
          </li>
          {options.map((o, i) => (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={selected.has(o.value)} className={focus === i + 1 ? 'focus' : undefined} style={o.style} onMouseEnter={() => setFocus(i + 1)} onClick={() => toggle(o.value)}>
                <i className="dd-check" aria-hidden />
                {o.style && <i className="dd-swatch" aria-hidden />}
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
