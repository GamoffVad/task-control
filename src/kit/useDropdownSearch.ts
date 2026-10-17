import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** Общие поиск, фокус и клавиатура для всех выпадающих списков. */
export function useDropdownSearch<T extends { label: string }>(options: T[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filtered = options.filter((option) => terms.every((term) => normalize(option.label).includes(term)));

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onDoc = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const show = () => {
    setQuery('');
    setFocus(-1);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const search = (next: string) => {
    setQuery(next);
    setFocus(-1);
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
  };

  const onKey = (event: KeyboardEvent, count: number, choose: (index: number) => void) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      if (!count) return;
      const next = event.key === 'ArrowDown' ? Math.min(focus + 1, count - 1) : focus < 0 ? count - 1 : Math.max(0, focus - 1);
      setFocus(next);
      root.current?.querySelector<HTMLElement>(`[id="${listId}-${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
    } else if (open && (event.key === 'Enter' || (event.key === ' ' && !(event.target instanceof HTMLInputElement)))) {
      if (event.target instanceof HTMLElement && event.target.closest('.clear')) return;
      // Пробел в поиске вводит текст, Enter не отправляет окружающую форму.
      event.preventDefault();
      if (count) choose(Math.min(Math.max(focus, 0), count - 1));
    }
  };

  return { open, query, focus, setFocus, root, trigger, listId, filtered, show, close, search, onKey, setOpen };
}
