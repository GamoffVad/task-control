// Оформление приложения: цвета, шрифты и размеры текста, настраиваемые в «Администрировании».
// Хранятся только отличия от дизайн-системы, поэтому её правки продолжают доходить до всех,
// у кого соответствующий токен не переопределён.

import type { Theme } from './theme';
import type { AppearancePreset, AppearanceSettings } from './types';

export type TokenKind = 'color' | 'size';

export type TokenDef = {
  /** Имя переменной CSS без «--». */
  name: string;
  label: string;
  /** Значения по умолчанию из дизайн-системы — показываются как исходные. */
  light: string;
  dark: string;
  kind?: TokenKind;
};

export type TokenGroup = { title: string; hint?: string; tokens: TokenDef[] };

/**
 * Настраиваемые цвета. Значения совпадают с дизайн-системой в src/index.css:
 * список открыт для правки администратором, поэтому держим его в одном месте.
 */
export const COLOR_GROUPS: TokenGroup[] = [
  {
    title: 'Основа',
    hint: 'Фон страницы, карточек и цвет текста.',
    tokens: [
      { name: 'paper', label: 'Фон страницы', light: '#F1EDE6', dark: '#1C2738' },
      { name: 'sheet', label: 'Фон карточек', light: '#FAF7F1', dark: '#28364A' },
      { name: 'ink', label: 'Основной текст', light: '#1F2B3A', dark: '#EAF0FA' },
      { name: 'ink-2', label: 'Текст потемнее', light: '#3E4859', dark: '#C7D3E5' },
      { name: 'ink-3', label: 'Пояснения', light: '#5D6575', dark: '#AABBD0' },
      { name: 'ink-4', label: 'Подсказки в полях', light: '#616B7A', dark: '#8294AA' },
    ],
  },
  {
    title: 'Линии и подложки',
    tokens: [
      { name: 'line', label: 'Сплошные линии', light: '#DDD9D0', dark: '#31475F' },
      { name: 'dash', label: 'Пунктирные линии', light: '#C9C6BD', dark: '#38516B' },
      { name: 'soft', label: 'Подложка', light: '#E8E3D9', dark: '#243347' },
      { name: 'soft-alt', label: 'Подложка при наведении', light: '#EAE5DC', dark: '#223043' },
      { name: 'soft-2', label: 'Подложка шапок', light: '#E1DBCF', dark: '#2E435A' },
    ],
  },
  {
    title: 'Акцент',
    hint: 'Кнопки, ссылки и выделение выбранного.',
    tokens: [
      { name: 'accent', label: 'Акцент', light: '#1F3A5F', dark: '#93B9F0' },
      { name: 'accent-2', label: 'Акцент дополнительный', light: '#2F5480', dark: '#6094D3' },
      { name: 'accent-hover', label: 'Акцент при наведении', light: '#16293F', dark: '#B6D0F6' },
      { name: 'accent-bg', label: 'Фон акцента', light: '#DCE4EF', dark: '#2A4566' },
    ],
  },
  {
    title: 'Состояния',
    tokens: [
      { name: 'ok', label: 'Исполнено', light: '#2C6B45', dark: '#75D8C9' },
      { name: 'ok-bg', label: 'Фон «исполнено»', light: '#E3EDE4', dark: '#17353A' },
      { name: 'danger', label: 'Просрочено, ошибка', light: '#A32D22', dark: '#FF847D' },
      { name: 'danger-bg', label: 'Фон ошибки', light: '#F3DEDB', dark: '#3B2731' },
      { name: 'amber', label: 'Предупреждение', light: '#7A5312', dark: '#E1B36A' },
    ],
  },
  {
    title: 'Календарь',
    tokens: [
      { name: 'cal-surface', label: 'Полотно календаря', light: '#FAF7F1', dark: '#121C2B' },
      { name: 'cal-head', label: 'Шапка дней', light: '#E1DBCF', dark: '#223247' },
      { name: 'cal-hours', label: 'Колонка часов', light: '#EAE5DC', dark: '#1F2E40' },
    ],
  },
  {
    title: 'Категории задач',
    hint: 'Цвет по умолчанию; у значения справочника цвет можно задать отдельно.',
    tokens: [
      { name: 'cat-reportDept', label: 'Доклад руководству отдела', light: '#2F5480', dark: '#8EB2DE' },
      { name: 'cat-reportDirectorate', label: 'Доклад руководству управления', light: '#6A4C93', dark: '#B89DE3' },
      { name: 'cat-reportAgency', label: 'Доклад руководству ведомства', light: '#983A6E', dark: '#E28DBC' },
      { name: 'cat-interim', label: 'Промежуточный контроль', light: '#1E7268', dark: '#6FC8B9' },
      { name: 'cat-none', label: 'Иное', light: '#8C816C', dark: '#A8A397' },
    ],
  },
  {
    title: 'Виды событий',
    hint: 'Цвет по умолчанию; в «Словарях» у вида можно задать свой.',
    tokens: [
      { name: 'abs-vacation', label: 'Отпуск', light: '#9A6B12', dark: '#D8A656' },
      { name: 'abs-trip', label: 'Командировка', light: '#2F5480', dark: '#8EB2DE' },
      { name: 'abs-dayoff', label: 'Отгул', light: '#6A4C93', dark: '#B89DE3' },
      { name: 'abs-sick', label: 'Больничный', light: '#983A6E', dark: '#E28DBC' },
      { name: 'abs-study', label: 'Учёба', light: '#1E7268', dark: '#6FC8B9' },
    ],
  },
  {
    title: 'Логотип',
    tokens: [
      { name: 'logo-dark', label: 'Тёмные кубики', light: '#1F2B3A', dark: '#6094D3' },
      { name: 'logo-1', label: 'Светлые кубики', light: '#1F3A5F', dark: '#93B9F0' },
    ],
  },
];

export const COLOR_TOKENS = COLOR_GROUPS.flatMap((g) => g.tokens);

/** Токены, у которых есть спутник «-rgb»: их приложение пересчитывает само. */
export const RGB_TOKENS = new Set([
  'paper',
  'ink',
  'ink-3',
  'line',
  'accent',
  'amber',
  'danger',
  'cat-none',
  'cat-reportDept',
  'cat-reportDirectorate',
  'cat-reportAgency',
  'cat-interim',
  'abs-vacation',
  'abs-trip',
  'abs-dayoff',
  'abs-sick',
  'abs-study',
]);

/** Наборы шрифтов: только те, что есть в системе, — приложение ничего не загружает из интернета. */
export const FONT_STACKS: { value: string; label: string }[] = [
  { value: "'Segoe UI', Arial, sans-serif", label: 'Segoe UI — как в Windows' },
  { value: "'Golos Text', 'Segoe UI', sans-serif", label: 'Golos Text' },
  { value: "Arial, Helvetica, sans-serif", label: 'Arial' },
  { value: "Tahoma, 'Segoe UI', sans-serif", label: 'Tahoma' },
  { value: "Verdana, Geneva, sans-serif", label: 'Verdana' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia — с засечками' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
];

export const MONO_STACKS: { value: string; label: string }[] = [
  { value: "'Cascadia Mono', Consolas, ui-monospace, monospace", label: 'Cascadia Mono' },
  { value: "Consolas, 'Courier New', monospace", label: 'Consolas' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
];

/** Размеры текста в пикселях: границы не дают сделать интерфейс нечитаемым или ломающим вёрстку. */
export const SIZE_TOKENS: { name: keyof AppearanceSettings['sizes']; label: string; hint: string; sample: string; min: number; max: number; base: number }[] = [
  { name: 'base', label: 'Основной текст', hint: 'Размер большей части надписей.', sample: 'Согласовать бюджет и обновить смету', min: 12, max: 20, base: 14 },
  { name: 'heading', label: 'Заголовки разделов', hint: 'Заголовки карточек и окон.', sample: 'Баллы по направлениям', min: 14, max: 24, base: 16 },
  { name: 'caps', label: 'Подписи над полями', hint: 'Мелкие прописные надписи.', sample: 'Исполнитель', min: 9, max: 14, base: 11 },
  { name: 'subtitle', label: 'Пояснения под заголовками', hint: 'Описания разделов и карточек.', sample: 'Задачи отдела во времени', min: 11, max: 18, base: 14 },
];

/**
 * Готовые цветовые темы. Каждая задаёт поверхности и акцент одной темы;
 * цвет текста не трогают, поэтому контраст остаётся прежним.
 */
export const BUILTIN_PRESETS: AppearancePreset[] = [
  { id: 'light-chalk', name: 'Тёплый мел', theme: 'light', colors: {} },
  {
    id: 'light-sand',
    name: 'Песочная',
    theme: 'light',
    colors: {
      paper: '#efe8db', sheet: '#f8f2e7', soft: '#e6ddcb', 'soft-alt': '#ebe3d3', 'soft-2': '#ded3bd',
      line: '#d8cfba', dash: '#c4b9a1', 'cal-surface': '#f8f2e7', 'cal-head': '#ded3bd', 'cal-hours': '#ebe3d3',
      accent: '#6b4a16', 'accent-2': '#8a6323', 'accent-hover': '#4f360f', 'accent-bg': '#e8dcc4',
    },
  },
  {
    id: 'light-north',
    name: 'Северная',
    theme: 'light',
    colors: {
      paper: '#eceef2', sheet: '#f7f8fa', soft: '#e1e6ee', 'soft-alt': '#e6eaf1', 'soft-2': '#d7dde8',
      line: '#d2d8e2', dash: '#bcc4d1', 'cal-surface': '#f7f8fa', 'cal-head': '#d7dde8', 'cal-hours': '#e6eaf1',
      accent: '#1f3a5f', 'accent-2': '#2f5480', 'accent-hover': '#16293f', 'accent-bg': '#d8e1ef',
    },
  },
  {
    id: 'light-pine',
    name: 'Хвойная',
    theme: 'light',
    colors: {
      paper: '#ecefe9', sheet: '#f7f9f4', soft: '#dfe6da', 'soft-alt': '#e5ebe0', 'soft-2': '#d4ddcd',
      line: '#d2dacb', dash: '#bcc7b3', 'cal-surface': '#f7f9f4', 'cal-head': '#d4ddcd', 'cal-hours': '#e5ebe0',
      accent: '#1e5f4b', 'accent-2': '#2c7a61', 'accent-hover': '#164536', 'accent-bg': '#d7e7df',
    },
  },
  { id: 'dark-chalk', name: 'Ночной мел', theme: 'dark', colors: {} },
  {
    id: 'dark-indigo',
    name: 'Индиго',
    theme: 'dark',
    colors: {
      paper: '#171e33', sheet: '#222a44', soft: '#1e2740', 'soft-alt': '#1b2439', 'soft-2': '#2b3555',
      line: '#334066', dash: '#3c4a72', 'cal-surface': '#111729', 'cal-head': '#1f2841', 'cal-hours': '#1a2237',
      accent: '#9bb4f5', 'accent-2': '#6f8fdd', 'accent-hover': '#bccbfa', 'accent-bg': '#2a3a63',
    },
  },
  {
    id: 'dark-coal',
    name: 'Уголь',
    theme: 'dark',
    colors: {
      paper: '#1e2124', sheet: '#292d31', soft: '#24282c', 'soft-alt': '#212528', 'soft-2': '#323740',
      line: '#3a4046', dash: '#454c53', 'cal-surface': '#16191c', 'cal-head': '#272c31', 'cal-hours': '#202427',
      accent: '#8fb6d9', 'accent-2': '#6d93b5', 'accent-hover': '#b0cee8', 'accent-bg': '#2c3a45',
    },
  },
  {
    id: 'dark-taiga',
    name: 'Тайга',
    theme: 'dark',
    colors: {
      paper: '#17221f', sheet: '#22302c', soft: '#1d2926', 'soft-alt': '#1a2522', 'soft-2': '#293b35',
      line: '#2f4740', dash: '#38534b', 'cal-surface': '#101a17', 'cal-head': '#1f2d29', 'cal-hours': '#1a2724',
      accent: '#7fd3b6', 'accent-2': '#5cae93', 'accent-hover': '#a3e5cd', 'accent-bg': '#234038',
    },
  },
];

/** Сколько своих тем можно сохранить: список выбора должен оставаться обозримым. */
export const MAX_PRESETS = 24;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  light: {},
  dark: {},
  presets: [],
  fontBody: FONT_STACKS[0].value,
  fontMono: MONO_STACKS[0].value,
  sizes: { base: 14, heading: 16, caps: 11, subtitle: 14 },
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const isColor = (value: string): boolean => HEX.test(value.trim());

/** «#2F5480» → «47 84 128» для rgb(var(--…-rgb) / доля): color-mix() не поддерживает Chrome 109. */
export const rgbChannels = (hex: string): string => {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(' ');
};

const clampSize = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value * 10) / 10));

/** Приводит настройки к допустимым: чужие токены, неверные цвета и размеры вне границ отбрасываются. */
export const normalizeAppearance = (raw: Partial<AppearanceSettings> | undefined): AppearanceSettings => {
  const known = new Set(COLOR_TOKENS.map((t) => t.name));
  const colors = (source: Record<string, string> | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(source ?? {})) {
      if (known.has(name) && typeof value === 'string' && isColor(value)) out[name] = value.trim().toLowerCase();
    }
    return out;
  };
  const sizes = { ...DEFAULT_APPEARANCE.sizes };
  for (const item of SIZE_TOKENS) {
    const value = raw?.sizes?.[item.name];
    if (typeof value === 'number' && Number.isFinite(value)) sizes[item.name] = clampSize(value, item.min, item.max);
  }
  const font = (value: string | undefined, list: { value: string }[], fallback: string) =>
    list.some((item) => item.value === value) ? value! : fallback;
  // Свои темы: имя обязательно, цвета проверяются как и остальные, повторные имена допустимы.
  const seen = new Set<string>();
  const presets = (raw?.presets ?? [])
    .filter((preset): preset is AppearancePreset => !!preset && typeof preset === 'object')
    .map((preset) => ({
      id: String(preset.id ?? '').slice(0, 64),
      name: String(preset.name ?? '').trim().slice(0, 40),
      theme: preset.theme === 'dark' ? ('dark' as const) : ('light' as const),
      colors: colors(preset.colors),
    }))
    .filter((preset) => {
      if (!preset.id || !preset.name || seen.has(preset.id)) return false;
      seen.add(preset.id);
      return true;
    })
    .slice(0, MAX_PRESETS);
  return {
    light: colors(raw?.light),
    dark: colors(raw?.dark),
    presets,
    fontBody: font(raw?.fontBody, FONT_STACKS, DEFAULT_APPEARANCE.fontBody),
    fontMono: font(raw?.fontMono, MONO_STACKS, DEFAULT_APPEARANCE.fontMono),
    sizes,
  };
};

const declarations = (overrides: Record<string, string>): string =>
  Object.entries(overrides)
    .flatMap(([name, value]) => [`--${name}: ${value};`, ...(RGB_TOKENS.has(name) ? [`--${name}-rgb: ${rgbChannels(value)};`] : [])])
    .join(' ');

/** Стили поверх дизайн-системы. Пустая строка — когда всё оставлено по умолчанию. */
export const appearanceCss = (settings: AppearanceSettings): string => {
  const rules: string[] = [];
  const base: string[] = [];
  if (settings.fontBody !== DEFAULT_APPEARANCE.fontBody) base.push(`--font-body: ${settings.fontBody};`);
  if (settings.fontMono !== DEFAULT_APPEARANCE.fontMono) base.push(`--font-mono: ${settings.fontMono};`);
  for (const item of SIZE_TOKENS) {
    const value = settings.sizes[item.name];
    if (value !== item.base) base.push(`--size-${item.name}: ${value}px;`);
  }
  const light = declarations(settings.light);
  if (base.length || light) rules.push(`:root { ${[...base, light].filter(Boolean).join(' ')} }`);
  const dark = declarations(settings.dark);
  // Тёмная тема — и по выбору пользователя, и по настройке системы.
  if (dark) rules.push(`:root[data-theme='dark'] { ${dark} }`);
  return rules.join('\n');
};

/** Готовые и сохранённые темы для выбранной темы страницы; готовые идут первыми. */
export const presetsFor = (settings: AppearanceSettings, theme: Theme): (AppearancePreset & { builtin: boolean })[] => [
  ...BUILTIN_PRESETS.filter((preset) => preset.theme === theme).map((preset) => ({ ...preset, builtin: true })),
  ...settings.presets.filter((preset) => preset.theme === theme).map((preset) => ({ ...preset, builtin: false })),
];

/** Цвета набора совпадают с текущими — значит эта тема и выбрана. */
export const isPresetActive = (settings: AppearanceSettings, preset: AppearancePreset): boolean => {
  const current = settings[preset.theme];
  const keys = new Set([...Object.keys(current), ...Object.keys(preset.colors)]);
  return [...keys].every((key) => (current[key] ?? '') === (preset.colors[key] ?? ''));
};

/** Значение токена с учётом настроек — для образцов в редакторе. */
export const tokenValue = (settings: AppearanceSettings, token: TokenDef, theme: Theme): string =>
  settings[theme][token.name] ?? token[theme];
