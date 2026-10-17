import type { ReactNode } from 'react';
import { SearchField } from './SearchField';

/** Поиск находится вне listbox, чтобы не становиться вариантом выбора. */
export function DropdownPanel({ label, listId, query, onSearch, active, children }: {
  label: string;
  listId: string;
  query: string;
  onSearch: (query: string) => void;
  active: number;
  children: ReactNode;
}) {
  return <div className="dd-pop">
    <div className="dd-search">
      <SearchField value={query} onChange={onSearch} label={`Поиск: ${label}`} placeholder="Поиск…"
        role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
        onKeyDown={() => { /* Escape обрабатывается самим списком. */ }} />
    </div>
    {children}
  </div>;
}
