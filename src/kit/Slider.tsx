import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

type Props = {
  value: number;
  min: number;
  max: number;
  /** Шаг стрелками и при перетаскивании. */
  step?: number;
  onChange: (value: number) => void;
  label: string;
  /** Подпись значения справа, например «14 px». */
  format?: (value: number) => string;
  disabled?: boolean;
};

const round = (value: number, step: number, min: number, max: number) => {
  const snapped = Math.round((value - min) / step) * step + min;
  // Шаг бывает дробным (0,5), поэтому убираем накопленную погрешность.
  return Math.min(max, Math.max(min, Math.round(snapped * 100) / 100));
};

/** Ползунок вместо системного <input type="range">: перетаскивается указателем, двигается стрелками. */
export const Slider = ({ value, min, max, step = 1, onChange, label, format, disabled }: Props) => {
  const track = useRef<HTMLDivElement>(null);
  const share = (value - min) / (max - min);

  const apply = (e: PointerEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    onChange(round(min + ((e.clientX - rect.left) / rect.width) * (max - min), step, min, max));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = step * 5;
    const moves: Record<string, number | 'min' | 'max'> = {
      ArrowLeft: -step,
      ArrowDown: -step,
      ArrowRight: step,
      ArrowUp: step,
      PageDown: -big,
      PageUp: big,
      Home: 'min',
      End: 'max',
    };
    const move = moves[e.key];
    if (move === undefined) return;
    e.preventDefault();
    onChange(move === 'min' ? min : move === 'max' ? max : round(value + move, step, min, max));
  };

  return (
    <div className={`slider${disabled ? ' slider--off' : ''}`}>
      <div
        ref={track}
        className="slider-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format ? format(value) : String(value)}
        aria-disabled={disabled || undefined}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          apply(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) apply(e);
        }}
        onKeyDown={onKey}
      >
        <span className="slider-fill" style={{ width: `${share * 100}%` }} aria-hidden />
        <span className="slider-thumb" style={{ left: `${share * 100}%` }} aria-hidden />
      </div>
      <span className="slider-value num" aria-hidden>{format ? format(value) : value}</span>
    </div>
  );
};
