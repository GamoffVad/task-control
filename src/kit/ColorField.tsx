import { useState } from 'react';
import { Icon } from '../components/Icons';

/** Приглушённые цвета в духе «Тёплого мела»: читаются на светлой бумаге и после высветления — в тёмной теме. */
const COLOR_SWATCHES = [
  '#9A6B12', '#A35A1F', '#A32D22', '#983A6E', '#6A4C93', '#2F5480',
  '#1F3A5F', '#1E6A8A', '#1E7268', '#2C6B45', '#5C6B1F', '#8C816C',
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Выбор цвета вместо системного <input type="color">: палитра, код #RRGGBB и образец. */
export const ColorField = ({ value, onChange, label = 'Цвет' }: { value: string; onChange: (value: string) => void; label?: string }) => {
  // Пока пользователь печатает код — показываем его текст, иначе текущее значение.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const valid = HEX.test(text.trim());
  return (
    <div className="colorfield">
      <div className="colorfield-swatches" role="radiogroup" aria-label={label}>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.toUpperCase() === c}
            aria-label={c}
            data-tip={c}
            className="colorfield-swatch"
            style={{ background: c }}
            onClick={() => { setDraft(null); onChange(c); }}
          >
            {value.toUpperCase() === c && <Icon.Check size={12} />}
          </button>
        ))}
      </div>
      <div className="colorfield-input">
        <span className="colorfield-preview" style={{ background: valid ? text.trim() : 'transparent' }} aria-hidden />
        <input
          className="input num"
          value={text}
          maxLength={7}
          placeholder="#9A6B12"
          aria-label={`${label}: код`}
          aria-invalid={!valid || undefined}
          onChange={(e) => {
            const next = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setDraft(next);
            if (HEX.test(next)) onChange(next.toUpperCase());
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  );
};
