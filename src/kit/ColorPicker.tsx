import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../components/Icons';
import { clamp, COLOR_SWATCHES, hexToHsv, hsvToHex, isHex, readableInk, type Hsv } from './color';

type AreaProps = { hsv: Hsv; onChange: (hsv: Hsv) => void };

/** Поле насыщенности и яркости: тянется указателем, двигается стрелками. */
const SaturationArea = ({ hsv, onChange }: AreaProps) => {
  const box = useRef<HTMLDivElement>(null);
  const apply = (e: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    onChange({ ...hsv, s: clamp((e.clientX - rect.left) / rect.width), v: clamp(1 - (e.clientY - rect.top) / rect.height) });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => onChange({ ...hsv, s: clamp(hsv.s - step) }),
      ArrowRight: () => onChange({ ...hsv, s: clamp(hsv.s + step) }),
      ArrowUp: () => onChange({ ...hsv, v: clamp(hsv.v + step) }),
      ArrowDown: () => onChange({ ...hsv, v: clamp(hsv.v - step) }),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
    }
  };
  return (
    <div
      ref={box}
      className="cp-area"
      role="slider"
      tabIndex={0}
      aria-label="Насыщенность и яркость"
      aria-valuetext={`насыщенность ${Math.round(hsv.s * 100)}%, яркость ${Math.round(hsv.v * 100)}%`}
      style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) apply(e);
      }}
      onKeyDown={onKey}
    >
      <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} aria-hidden />
    </div>
  );
};

/** Полоса тона: своя, а не <input type="range">, — как и остальные элементы приложения. */
const HueSlider = ({ hsv, onChange }: AreaProps) => {
  const bar = useRef<HTMLDivElement>(null);
  const apply = (e: PointerEvent<HTMLDivElement>) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect) return;
    onChange({ ...hsv, h: clamp((e.clientX - rect.left) / rect.width) * 360 });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange({ ...hsv, h: (hsv.h - step + 360) % 360 });
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange({ ...hsv, h: (hsv.h + step) % 360 });
    }
  };
  return (
    <div
      ref={bar}
      className="cp-hue"
      role="slider"
      tabIndex={0}
      aria-label="Тон"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) apply(e);
      }}
      onKeyDown={onKey}
    >
      <span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }} aria-hidden />
    </div>
  );
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Показывать ли код #RRGGBB рядом с образцом. */
  compact?: boolean;
};

/**
 * Выбор цвета вместо системного <input type="color">: образец с кодом открывает панель
 * с полем насыщенности, полосой тона, палитрой приложения и полем кода.
 */
export const ColorPicker = ({ value, onChange, label = 'Цвет', disabled, invalid, compact }: Props) => {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(isHex(value) ? value : '#8C816C'));
  const [text, setText] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const popId = useId();

  // Цвет могли изменить извне — например кнопкой «по умолчанию»: тогда отпускаем набранный код.
  if (seen !== value) {
    setSeen(value);
    if (isHex(value)) setHsv(hexToHsv(value));
    if (text && text.trim().toLowerCase() !== value.toLowerCase()) setText(null);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (next: Hsv) => {
    setHsv(next);
    setText(null);
    onChange(hsvToHex(next));
  };

  const shown = text ?? value;
  const valid = isHex(shown);

  return (
    <div className={`cp${open ? ' open' : ''}`} ref={root}>
      <button
        type="button"
        className="cp-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`${label}: ${value}`}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cp-chip" style={{ background: valid ? shown : 'transparent', color: readableInk(valid ? shown : '#8C816C') }}>
          {open && <Icon.Check size={11} />}
        </span>
        {!compact && <span className="cp-code num">{shown.toUpperCase()}</span>}
      </button>

      {open && (
        <div
          className="cp-pop"
          id={popId}
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Закрывается только панель, окно вокруг остаётся.
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              root.current?.querySelector<HTMLButtonElement>('.cp-trigger')?.focus();
            }
          }}
        >
          <SaturationArea hsv={hsv} onChange={pick} />
          <HueSlider hsv={hsv} onChange={pick} />
          <div className="cp-swatches" role="listbox" aria-label="Цвета приложения" onClick={(e) => e.preventDefault()}>
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={value.toUpperCase() === c}
                aria-label={c}
                data-tip={c}
                className="cp-swatch"
                style={{ background: c, color: readableInk(c) }}
                onClick={() => {
                  setHsv(hexToHsv(c));
                  setText(null);
                  onChange(c);
                }}
              >
                {value.toUpperCase() === c && <Icon.Check size={12} />}
              </button>
            ))}
          </div>
          <label className="cp-hex">
            <span className="caps">Код</span>
            <input
              className="input num"
              value={shown}
              maxLength={7}
              placeholder="#9A6B12"
              aria-label={`${label}: код`}
              aria-invalid={!valid || undefined}
              onChange={(e) => {
                const next = e.target.value.startsWith('#') || e.target.value === '' ? e.target.value : `#${e.target.value}`;
                setText(next);
                if (isHex(next)) {
                  setHsv(hexToHsv(next));
                  onChange(next.toLowerCase());
                }
              }}
              onBlur={() => setText(null)}
            />
          </label>
        </div>
      )}
    </div>
  );
};
