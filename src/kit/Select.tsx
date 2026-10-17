import { DropdownPanel } from './DropdownSearch';
import { useDropdownSearch } from './useDropdownSearch';

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

/** Выпадающий список с поиском, стрелками, Enter и Escape. */
export function Select<T extends string | number>({ value, options, onChange, variant = 'plain', label, id, disabled }: Props<T>) {
  const { open, query, focus, setFocus, root, trigger, listId, filtered, show, close, search, onKey, setOpen } = useDropdownSearch(options);
  const current = options.find((option) => option.value === value);
  const active = focus < filtered.length ? focus : -1;
  const choose = (index: number) => {
    const option = filtered[index];
    if (!option || disabled) return;
    onChange(option.value);
    close();
  };

  return (
    <div className={`dd dd--${variant}`} ref={root}
      onKeyDown={(event) => !disabled && onKey(event, filtered.length, choose)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button type="button" id={id} ref={trigger} className="dd-btn"
        aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open && !disabled ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? ''}`} disabled={disabled}
        onClick={() => open ? close() : show()}>
        <span className="value">{current?.label ?? '—'}</span>
        <span className="arrow" aria-hidden>▾</span>
      </button>
      {open && !disabled && (
        <DropdownPanel label={label} listId={listId} query={query} onSearch={search} active={active}>
          {/* Не пересылаем клик внешней подписи label: иначе список откроется повторно. */}
          <ul className="dd-list" role="listbox" id={listId} aria-label={label} onClick={(event) => event.preventDefault()}>
            {filtered.map((option, index) => (
              <li key={String(option.value)} role="presentation">
                <button type="button" role="option" id={`${listId}-${index}`} tabIndex={-1}
                  aria-selected={option.value === value} className={index === active ? 'focus' : undefined}
                  onMouseEnter={() => setFocus(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
                  {option.label}
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
