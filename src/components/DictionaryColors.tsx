import { useStore } from '../lib/store';

/** Справочник → CSS-переменная: виды отсутствий красят --abs-<код>, категории задач — --cat-<код>. */
const VARS = { absenceType: 'abs', taskCategory: 'cat' } as const;

/**
 * Цвета из справочников (Администрирование → Словари) поверх цветов темы:
 * в светлой теме — как задано, в тёмной — высветленными, чтобы читались на графите.
 */
export const DictionaryColors = () => {
  const { state } = useStore();
  const colored = state.dictionaries.filter((e) => (e.dictionary === 'absenceType' || e.dictionary === 'taskCategory') && e.color && /^[\w-]+$/.test(e.code));
  if (colored.length === 0) return null;
  const name = (e: (typeof colored)[number]) => `--${VARS[e.dictionary as keyof typeof VARS]}-${e.code}`;
  const light = colored.map((e) => `${name(e)}: ${e.color};`).join(' ');
  const dark = colored.map((e) => `${name(e)}: color-mix(in srgb, ${e.color} 58%, #ffffff);`).join(' ');
  return <style>{`:root { ${light} } :root[data-theme='dark'] { ${dark} }`}</style>;
};
