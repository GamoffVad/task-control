import type { ReactNode } from 'react';

/** Заголовок страницы: название, пояснение и действия справа. */
export const PageHeader = ({ title, subtitle, toolbar, actions }: { title: string; subtitle?: ReactNode; toolbar?: ReactNode; actions?: ReactNode }) => (
  <div className="page-header">
    <div className="page-title">
      <h1>{title}</h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      {/* Панель управления в одной строке с названием — там, где у других разделов пояснение. */}
      {toolbar && <div className="page-toolbar">{toolbar}</div>}
    </div>
    {actions && <div className="page-actions no-print">{actions}</div>}
  </div>
);

/** Ячейка строки фильтров: подпись капителью и элемент управления. */
export const FilterCard = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => (
  <div className={`filter-card${wide ? ' filter-card--wide' : ''}`}>
    <span className="caps">{label}</span>
    {children}
  </div>
);

export const FilterBar = ({ children }: { children: ReactNode }) => <div className="filters">{children}</div>;
