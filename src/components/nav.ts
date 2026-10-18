import { hasPermission } from '../lib/access';
import { isManager } from '../lib/permissions';
import type { User } from '../lib/types';
import { NAV, normalizeNavOrder } from '../lib/navigation';

export { NAV } from '../lib/navigation';

export const navFor = (user: User | null, order?: readonly string[]) =>
  normalizeNavOrder(order).map((to) => NAV.find((item) => item.to === to)!).filter((n) => !n.managerOnly || hasPermission(user, 'reports.view')).map((n) => ({
    to: n.to,
    label: !isManager(user) && n.executorLabel ? n.executorLabel : n.label,
  }));
