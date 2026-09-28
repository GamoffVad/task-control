import { useStore } from '../lib/store';

/** Справочник → CSS-переменная: виды отсутствий красят --abs-<код>, категории задач — --cat-<код>. */
const VARS = { absenceType: 'abs', taskCategory: 'cat' } as const;

/** #RRGGBB → каналы «R G B» для записи rgb(var(--…-rgb) / доля). */
const channels = (hex: string): [number, number, number] => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};

/** Осветление к белому: в тёмной теме цвет справочника должен читаться на графите. */
const lighten = (hex: string, share: number) => {
  const mixed = channels(hex).map((c) => Math.round(c * share + 255 * (1 - share)));
  return { hex: `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`, rgb: mixed.join(' ') };
};

/**
 * Цвета из справочников (Администрирование → Словари) поверх цветов темы:
 * в светлой теме — как задано, в тёмной — высветленными. Смешивание считается здесь,
 * потому что color-mix() не поддерживает Chrome 109 — последний для Windows 7.
 */
export const DictionaryColors = () => {
  const { state } = useStore();
  const colored = state.dictionaries.filter((e) => (e.dictionary === 'absenceType' || e.dictionary === 'taskCategory') && e.color && /^[\w-]+$/.test(e.code));
  if (colored.length === 0) return null;
  const name = (e: (typeof colored)[number]) => `--${VARS[e.dictionary as keyof typeof VARS]}-${e.code}`;
  const light = colored.map((e) => `${name(e)}: ${e.color}; ${name(e)}-rgb: ${channels(e.color!).join(' ')};`).join(' ');
  const dark = colored
    .map((e) => {
      const { hex, rgb } = lighten(e.color!, 0.58);
      return `${name(e)}: ${hex}; ${name(e)}-rgb: ${rgb};`;
    })
    .join(' ');
  return <style>{`:root { ${light} } :root[data-theme='dark'] { ${dark} }`}</style>;
};
