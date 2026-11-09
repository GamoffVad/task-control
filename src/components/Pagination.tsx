import { useEffect, useState } from 'react';

const PAGE_SIZE = 30;

/** Номер страницы автоматически ограничивается при изменении размера списка. */
export const usePagination = <T,>(items: T[]) => {
  const [requestedPage, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  useEffect(() => { setPage((current) => Math.min(current, pages)); }, [pages]);
  return { page, pages, setPage, items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
};

export const Pagination = ({ label, page, pages, onChange }: { label: string; page: number; pages: number; onChange: (page: number) => void }) => {
  if (pages <= 1) return null;
  return <nav className="list-pagination" aria-label={label}>
    <button type="button" className="btn" disabled={page === 1} onClick={() => onChange(page - 1)}>Назад</button>
    <span className="num" aria-live="polite">Страница {page} из {pages}</span>
    <button type="button" className="btn" disabled={page === pages} onClick={() => onChange(page + 1)}>Вперёд</button>
  </nav>;
};
