import { useStore } from '../lib/store';

/** Справочник → CSS-переменная: виды отсутствий красят --abs-<код>, категории задач — --cat-<код>. */
const VARS = { absenceType: 'abs', taskCategory: 'cat' } as const;

/** #RRGGBB → [r, g, b]. */
const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Цвета из справочников (Администрирование → Словари) поверх цветов темы:
 * в светлой теме — как задано, в тёмной — высветленными (58% цвета и 42% белого), чтобы читались на графите.
 * Рядом с каждым цветом — «двойник» --…-rgb для полупрозрачных оттенков; смешение считается здесь,
 * а не через color-mix(): его не знает Chrome 109 (последний для Windows 7).
 */
export const DictionaryColors = () => {
  const { state } = useStore();
  const colored = state.dictionaries.filter((e) => (e.dictionary === 'absenceType' || e.dictionary === 'taskCategory') && e.color && /^#[0-9a-f]{6}$/i.test(e.color) && /^[\w-]+$/.test(e.code));
  if (colored.length === 0) return null;
  const name = (e: (typeof colored)[number]) => `--${VARS[e.dictionary as keyof typeof VARS]}-${e.code}`;
  const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const declare = (e: (typeof colored)[number], rgb: number[]) => `${name(e)}: ${hex(rgb)}; ${name(e)}-rgb: ${rgb.join(', ')};`;
  const light = colored.map((e) => declare(e, channels(e.color!))).join(' ');
  const dark = colored.map((e) => declare(e, channels(e.color!).map((c) => Math.round(c * 0.58 + 255 * 0.42)))).join(' ');
  return <style>{`:root { ${light} } :root[data-theme='dark'] { ${dark} }`}</style>;
};
