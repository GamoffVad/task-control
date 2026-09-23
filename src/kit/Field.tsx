import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

/** Поле формы: подпись капителью над элементом, ошибка или подсказка под ним. */
export const Field = ({
  label,
  children,
  error,
  hint,
  htmlFor,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  /** Если задан — подпись связывается с элементом по id, иначе поле оборачивается в label. */
  htmlFor?: string;
  className?: string;
}) => {
  const body = (
    <>
      {htmlFor ? (
        <label className="caps" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="caps">{label}</span>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </>
  );
  return htmlFor ? <div className={`field${className ? ` ${className}` : ''}`}>{body}</div> : <label className={`field${className ? ` ${className}` : ''}`}>{body}</label>;
};

export const FieldRow = ({ children }: { children: ReactNode }) => <div className="field-row">{children}</div>;

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type?: 'text' | 'email' | 'password';
  /** Моноширинный шрифт для номеров, дат и чисел. */
  mono?: boolean;
  invalid?: boolean;
};

/** Однострочное поле ввода. */
export const TextInput = forwardRef<HTMLInputElement, InputProps>(({ mono, invalid, className, type = 'text', ...rest }, ref) => (
  <input ref={ref} type={type} className={`input${mono ? ' num' : ''}${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} {...rest} />
));
TextInput.displayName = 'TextInput';

/** Многострочное поле. Высота меняется только по вертикали, ручка оформлена в стиле приложения. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ invalid, className, ...rest }, ref) => (
    <textarea ref={ref} className={`input${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} {...rest} />
  ),
);
TextArea.displayName = 'TextArea';
