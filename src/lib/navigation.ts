/** Общий каталог разделов; права проверяются отдельно при построении меню. */
export const NAV: { to: string; label: string; managerOnly?: boolean; executorLabel?: string }[] = [
  { to: '/calendar', label: 'Календарь' },
  { to: '/planning', label: 'Планирование' },
  { to: '/reports', label: 'Отчётность', managerOnly: true },
  { to: '/control', label: 'Контроль' },
  { to: '/tetris', label: 'Тетрис' },
  { to: '/kpi', label: 'Показатели', managerOnly: true },
  { to: '/employees', label: 'Сотрудники', executorLabel: 'Моя карточка' },
  { to: '/chat', label: 'Переписка' },
  { to: '/info', label: 'Информация' },
];

/** Неизвестные и повторные пункты отбрасываются, новые разделы дополняют старые настройки. */
export const normalizeNavOrder = (raw: unknown): string[] => {
  const known = new Set(NAV.map((item) => item.to));
  const selected = Array.isArray(raw) ? raw.filter((to): to is string => typeof to === 'string' && known.has(to)) : [];
  return [...new Set([...selected, ...NAV.map((item) => item.to)])];
};

/** Перенос на позицию другой карточки; скрытые по роли пункты остаются в настройках. */
export const moveNavItem = (order: readonly string[], from: string, to: string): string[] => {
  const next = normalizeNavOrder(order);
  const source = next.indexOf(from), target = next.indexOf(to);
  if (source < 0 || target < 0 || source === target) return next;
  next.splice(source, 1);
  next.splice(target, 0, from);
  return next;
};
