// Категории берутся из справочника (Администрирование → Словари) и меняются на ходу,
// поэтому списки для фильтров и окна задачи строятся при отрисовке, а не один раз при загрузке модуля.

import { useMemo, type CSSProperties } from 'react';
import { CATEGORIES, OTHER_CATEGORY } from './data';
import type { MultiOption } from '../kit';
import type { Category } from './types';

/** Ключ фильтра: код категории или «none» — задачи без категории. */
export type CatKey = Category | 'none';

/** Цвет категории; для добавленной без цвета — цвет «Иного». --c-rgb — тот же цвет тройкой r, g, b для полупрозрачных оттенков. */
export const catColor = (key: CatKey) => ({ '--c': `var(--cat-${key}, var(--cat-none))`, '--c-rgb': `var(--cat-${key}-rgb, var(--cat-none-rgb))` }) as CSSProperties;

/** Отпечаток справочника «код:название|…»: по нему пересчитываются списки. */
const categoriesKey = () => CATEGORIES.map((c) => `${c.key}:${c.label}`).join('|');
const parse = (key: string) =>
  key
    .split('|')
    .filter(Boolean)
    .map((pair) => ({ key: pair.slice(0, pair.indexOf(':')), label: pair.slice(pair.indexOf(':') + 1) }));

/** Ключи и пункты списка с цветными квадратами — для фильтров «Календаря» и «Контроля». */
export const useCategoryOptions = (): { keys: CatKey[]; options: MultiOption<CatKey>[] } => {
  const key = categoriesKey();
  return useMemo(() => {
    const options: MultiOption<CatKey>[] = [
      ...parse(key).map((c) => ({ value: c.key as CatKey, label: c.label, style: catColor(c.key) })),
      { value: 'none' as CatKey, label: OTHER_CATEGORY, style: catColor('none') },
    ];
    return { keys: options.map((o) => o.value), options };
  }, [key]);
};

/** Пункты выпадающего списка категории в окне задачи: пустое значение — «Иное». */
export const useCategorySelectOptions = (): { value: Category | ''; label: string }[] => {
  const key = categoriesKey();
  return useMemo(() => [{ value: '' as Category | '', label: OTHER_CATEGORY }, ...parse(key).map((c) => ({ value: c.key, label: c.label }))], [key]);
};
