import type { InputHTMLAttributes } from 'react';
import { Icon } from '../components/Icons';

/** Поле поиска: лупа слева, крестик очистки справа; Escape очищает, не закрывая окно вокруг. */
export const SearchField = ({
  value,
  onChange,
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string; onChange: (v: string) => void; label: string }) => (
  <div className={`search${className ? ` ${className}` : ''}`}>
    <Icon.Search size={15} />
    <input
      type="search"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !value) return;
        e.preventDefault();
        e.stopPropagation();
        onChange('');
      }}
      {...rest}
    />
    {value && (
      <button type="button" className="clear" aria-label="Очистить поиск" onClick={() => onChange('')}>
        <Icon.Close size={13} />
      </button>
    )}
  </div>
);
