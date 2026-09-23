import type { ReactNode } from 'react';
import { Icon } from '../components/Icons';

/** Листалка периода: назад, вперёд, текущее значение и возврат к сегодняшнему. */
export const Stepper = ({
  label,
  value,
  onPrev,
  onNext,
  onToday,
  todayLabel = 'Сегодня',
}: {
  label: string;
  value: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onToday?: () => void;
  todayLabel?: string;
}) => (
  <div className="stepper">
    <button type="button" className="icon-btn" onClick={onPrev} aria-label={`${label}: назад`}>
      <Icon.ChevronLeft size={15} />
    </button>
    <button type="button" className="icon-btn" onClick={onNext} aria-label={`${label}: вперёд`}>
      <Icon.Chevron size={15} />
    </button>
    <span className="value" aria-live="polite">{value}</span>
    {onToday && (
      <button type="button" className="text-action" onClick={onToday}>
        {todayLabel}
      </button>
    )}
  </div>
);

/** Сегментный переключатель из нескольких вариантов. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Флажок: квадрат с галочкой и подпись; tone="ok" — зелёный для отметок об исполнении. */
export const Checkbox = ({
  checked,
  onChange,
  children,
  disabled,
  tone,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  tone?: 'ok';
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    disabled={disabled}
    className={`check${tone === 'ok' ? ' ok-check' : ''}`}
    onClick={() => onChange(!checked)}
  >
    <span className="box">{checked && <Icon.Check size={11} />}</span>
    <span>{children}</span>
  </button>
);
