import type { CSSProperties } from 'react';
import { DropdownPanel } from './DropdownSearch';
import { useDropdownSearch } from './useDropdownSearch';

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

/** Поиск не сбрасывает отметки; первая строка выбирает или снимает всё, независимо от поиска. */
export function MultiSelect<T extends string>({ options, value, onChange, label, allLabel, variant = 'plain' }: Props<T>) {
  const { open, query, focus, setFocus, root, trigger, listId, filtered, show, close, search, onKey, setOpen } = useDropdownSearch(options);
  const selected = new Set(value);
  const all = options.length > 0 && options.every((option) => selected.has(option.value));
  const summary = all ? allLabel : value.length === 0 ? 'ничего' : value.length <= 2 ? options.filter((option) => selected.has(option.value)).map((option) => option.label).join(', ') : `${value.length} из ${options.length}`;
  const toggle = (v: T) => onChange(options.map((option) => option.value).filter((x) => x === v ? !selected.has(x) : selected.has(x)));
  const toggleAll = () => onChange(all ? [] : options.map((option) => option.value));
  const active = focus <= filtered.length ? focus : -1;
  const act = (index: number) => {
    if (focus < 0 && query.trim()) index = 1;
    if (index === 0) toggleAll();
    else if (filtered[index - 1]) toggle(filtered[index - 1].value);
  };

  return (
    <div className={`dd dd--${variant} dd--multi`} ref={root}
      onKeyDown={(event) => onKey(event, filtered.length + 1, act)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button type="button" className="dd-btn" ref={trigger} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-label={`${label}: ${summary}`} onClick={() => open ? close() : show()}>
        <span className="value">{summary}</span>
        <span className="arrow" aria-hidden>▾</span>
      </button>
      {open && (
        <DropdownPanel label={label} listId={listId} query={query} onSearch={search} active={active}>
          <ul className="dd-list" role="listbox" aria-multiselectable="true" id={listId} aria-label={label} onClick={(event) => event.preventDefault()}>
            <li role="presentation">
              <button type="button" role="option" id={`${listId}-0`} tabIndex={-1} aria-selected={all}
                className={`dd-multi-all${active === 0 ? ' focus' : ''}`} onMouseEnter={() => setFocus(0)}
                onMouseDown={(event) => event.preventDefault()} onClick={toggleAll}>
                <i className="dd-check" aria-hidden />{allLabel}
              </button>
            </li>
            {filtered.map((option, index) => (
              <li key={option.value} role="presentation">
                <button type="button" role="option" id={`${listId}-${index + 1}`} tabIndex={-1} aria-selected={selected.has(option.value)}
                  className={active === index + 1 ? 'focus' : undefined} style={option.style} onMouseEnter={() => setFocus(index + 1)}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(option.value)}>
                  <i className="dd-check" aria-hidden />{option.style && <i className="dd-swatch" aria-hidden />}{option.label}
                </button>
              </li>
            ))}
          </ul>
          {!filtered.length && <p className="dd-empty" role="status">Ничего не найдено</p>}
        </DropdownPanel>
      )}
    </div>
  );
}
