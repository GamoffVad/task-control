import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & { type?: 'button' | 'submit' };

/** Кнопка: основная (заливка акцентом), обычная (пунктирная рамка) или опасная. */
export const Button = ({
  variant = 'default',
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: Native & { variant?: 'primary' | 'default' | 'danger'; icon?: ReactNode }) => (
  <button type={type} className={`btn${variant === 'default' ? '' : ` btn--${variant}`}${className ? ` ${className}` : ''}`} {...rest}>
    {icon}
    {children}
  </button>
);

/** Квадратная кнопка с иконкой; подпись обязательна — она же подсказка. */
export const IconButton = ({
  label,
  children,
  badge,
  className,
  tip = true,
  ...rest
}: Omit<Native, 'aria-label'> & { label: string; badge?: ReactNode; tip?: boolean }) => (
  <button type="button" className={`icon-btn${className ? ` ${className}` : ''}`} aria-label={label} data-tip={tip ? label : undefined} {...rest}>
    {children}
    {badge != null && badge !== false && <span className="badge">{badge}</span>}
  </button>
);

/** Текстовое действие с пунктирным подчёркиванием: «Сбросить», «Показать на графике». */
export const TextButton = ({ tone, className, children, ...rest }: Native & { tone?: 'danger' | 'ok' }) => (
  <button type="button" className={`text-action${tone ? ` ${tone}` : ''}${className ? ` ${className}` : ''}`} {...rest}>
    {children}
  </button>
);
