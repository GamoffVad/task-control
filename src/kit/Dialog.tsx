import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { Icon } from '../components/Icons';

/**
 * Модальное окно: затемнение, заголовок с пояснением, кнопка закрытия.
 * Закрывается по Escape (если его не перехватил вложенный список или календарь) и кликом по фону.
 * Фокус переводится в окно и не уходит из него по Tab.
 */
export function Dialog({
  title,
  context,
  onClose,
  children,
  initialFocus,
  wide,
  className,
}: {
  title: ReactNode;
  context?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Куда поставить фокус при открытии; по умолчанию — на само окно. */
  initialFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
  /** Дополнительный класс окна — например, для просмотра рисунка во всю ширину. */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
    // Фокус ставится один раз при открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {context && <div className="ctx">{context}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon.Close size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
