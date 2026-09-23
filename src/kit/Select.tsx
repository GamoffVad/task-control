import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type Option<T extends string | number> = { value: T; label: string };

type Props<T extends string | number> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  variant?: 'plain' | 'light';
  label: string;
  id?: string;
  disabled?: boolean;
};

/** Выпадающий список: закрывается по Escape и клику вне, управляется стрелками. */
export function Select<T extends string | number>({ value, options, onChange, variant = 'plain', label, id, disabled }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openList = () => {
    setFocus(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!open) return;
      // Открытый список закрывается сам, окно вокруг — нет.
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => Math.min(options.length - 1, f + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => Math.max(0, f - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(options[focus].value);
    }
  };

  return (
    <div className={`dd dd--${variant}`} ref={root} onKeyDown={onKey}>
      <button
        type="button"
        id={id}
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${current?.label ?? ''}`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className="value">{current?.label ?? '—'}</span>
        <span className="arrow" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="dd-list" role="listbox" id={listId} aria-label={label}>
          {options.map((o, i) => (
            <li key={String(o.value)}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={i === focus ? 'focus' : undefined}
                onMouseEnter={() => setFocus(i)}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
