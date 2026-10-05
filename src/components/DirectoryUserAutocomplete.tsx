import { useEffect, useId, useRef, useState } from 'react';
import { TextInput } from '../kit';
import { useStore } from '../lib/store';
import type { DirectoryUser } from '../lib/types';

export const DirectoryUserAutocomplete = ({ value, onChange, onSelect, invalid }: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (user: DirectoryUser) => void;
  invalid?: boolean;
}) => {
  const { searchDirectory, directoryAvailable } = useStore();
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const timer = useRef<number | null>(null);
  const request = useRef(0);
  const listId = useId();

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const search = (query: string) => {
    onChange(query);
    setActive(-1);
    setError('');
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (query.trim().length < 2 || !directoryAvailable) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++request.current;
    timer.current = window.setTimeout(async () => {
      try {
        const users = await searchDirectory(query);
        if (id !== request.current) return;
        setResults(users);
        setOpen(true);
        setError('');
      } catch (reason) {
        if (id !== request.current) return;
        setResults([]);
        setOpen(true);
        setError(reason instanceof Error ? reason.message : 'Не удалось выполнить поиск в Active Directory.');
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, 260);
  };

  const choose = (user: DirectoryUser) => {
    onSelect(user);
    setResults([]);
    setOpen(false);
    setActive(-1);
  };

  return <div className="directory-autocomplete">
    <TextInput
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      autoComplete="off"
      value={value}
      invalid={invalid}
      disabled={!directoryAvailable}
      placeholder={directoryAvailable ? 'Начните вводить фамилию' : 'Active Directory не настроен'}
      onChange={(event) => search(event.target.value)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onFocus={() => results.length && setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setOpen(true); setActive((current) => Math.min(current + 1, results.length - 1)); }
        if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
        if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(results[active]!); }
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      }}
    />
    {loading && <span className="directory-search-state" role="status">Поиск…</span>}
    {open && <div className="directory-options" id={listId} role="listbox" onClick={(event) => event.preventDefault()}>
      {error && <p className="directory-message" role="alert">{error}</p>}
      {!error && !loading && results.length === 0 && <p className="directory-message">Сотрудники не найдены.</p>}
      {results.map((user, index) => <button
        key={`${user.login}-${index}`}
        id={`${listId}-${index}`}
        type="button"
        role="option"
        aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(user)}
      >
        <strong>{user.fullName}</strong>
        <span>{user.position || 'Должность не указана'} · <span className="num">{user.login}</span></span>
      </button>)}
    </div>}
  </div>;
};
