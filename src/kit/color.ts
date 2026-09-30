// Цветовая математика для выбора цвета: HSV нужен полю насыщенности и полосе тона.

export type Hsv = { h: number; s: number; v: number };

/** Приглушённые цвета в духе «Тёплого мела»: читаются на светлой бумаге и после высветления — в тёмной теме. */
export const COLOR_SWATCHES = [
  '#9A6B12', '#A35A1F', '#A32D22', '#983A6E', '#6A4C93', '#2F5480',
  '#1F3A5F', '#1E6A8A', '#1E7268', '#2C6B45', '#5C6B1F', '#8C816C',
];

const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value: string) => HEX.test(value.trim());

/** Ограничение доли: поле насыщенности и полоса тона тянутся за границы элемента. */
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const hexToHsv = (hex: string): Hsv => {
  const raw = hex.trim().replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
};

export const hsvToHex = ({ h, s, v }: Hsv): string => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = table[Math.min(5, Math.floor(h / 60))];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
};

/** Чёрный или белый текст поверх цвета — по воспринимаемой яркости. */
export const readableInk = (hex: string): string => {
  const raw = hex.trim().replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1F2B3A' : '#FFFFFF';
};
