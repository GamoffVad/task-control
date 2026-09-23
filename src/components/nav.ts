import { hasPermission } from '../lib/access';
import { isManager } from '../lib/permissions';
import type { User } from '../lib/types';

/** Разделы верхней навигации. Отчётность и показатели отдела видит только руководитель. */
export const NAV = [
  { to: '/calendar', label: 'Календарь' },
  { to: '/planning', label: 'Планирование' },
  { to: '/control', label: 'Контроль' },
  { to: '/tetris', label: 'Тетрис' },
  { to: '/reports', label: 'Отчётность', managerOnly: true },
  { to: '/kpi', label: 'Показатели', managerOnly: true },
  { to: '/employees', label: 'Сотрудники', executorLabel: 'Моя карточка' },
  { to: '/chat', label: 'Переписка' },
  { to: '/info', label: 'Информация' },
];

export const navFor = (user: User | null) =>
  NAV.filter((n) => !n.managerOnly || hasPermission(user, 'reports.view')).map((n) => ({
    to: n.to,
    label: !isManager(user) && n.executorLabel ? n.executorLabel : n.label,
  }));
