import type { Unit, UnitKind } from './types';

/** Уровни подразделений сверху вниз и их названия. */
export const UNIT_KINDS: { kind: UnitKind; label: string; plural: string }[] = [
  { kind: 'organization', label: 'Организация', plural: 'Организации' },
  { kind: 'directorate', label: 'Управление', plural: 'Управления' },
  { kind: 'department', label: 'Отдел', plural: 'Отделы' },
  { kind: 'section', label: 'Отделение', plural: 'Отделения' },
];

export const unitKindLabel = (kind: UnitKind) => UNIT_KINDS.find((k) => k.kind === kind)?.label ?? kind;

/** Каким может быть родитель: организация — корень, дальше строго по уровням. */
export const PARENT_KIND: Record<UnitKind, UnitKind | null> = {
  organization: null,
  directorate: 'organization',
  department: 'directorate',
  section: 'department',
};

/** Отдел, в котором работает приложение: его отделения — группы в фильтрах. */
export const MAIN_DEPARTMENT_ID = 'u-dept-dev';

export const DEFAULT_UNITS: Unit[] = [
  { id: 'u-org', parentId: null, kind: 'organization', name: 'Ведомство' },
  { id: 'u-dir-it', parentId: 'u-org', kind: 'directorate', name: 'Управление информационных технологий' },
  { id: MAIN_DEPARTMENT_ID, parentId: 'u-dir-it', kind: 'department', name: 'Отдел разработки' },
  { id: 'g-1', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Руководство' },
  { id: 'g-2', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Проектная группа 1' },
  { id: 'g-3', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Проектная группа 2' },
  { id: 'g-4', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Группа документооборота' },
  { id: 's-dev', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Отделение разработки' },
  { id: 's-support', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Отделение сопровождения' },
  { id: 's-analytics', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Отделение аналитики' },
  { id: 's-qa', parentId: MAIN_DEPARTMENT_ID, kind: 'section', name: 'Отделение тестирования' },
];

/** Подразделение по умолчанию для демонстрационных сотрудников 1–7. */
export const DEFAULT_UNIT_OF: Record<number, string> = { 1: 'g-1', 2: 'g-1', 3: 'g-2', 4: 'g-2', 5: 'g-3', 6: 'g-3', 7: 'g-4' };

/** Подразделение и все вложенные в него. */
export const unitWithDescendants = (units: Unit[], id: string): Set<string> => {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
};

/** Путь от организации до подразделения: «Ведомство › Управление › Отдел». */
export const unitPath = (units: Unit[], id: string | undefined): Unit[] => {
  const byId = new Map(units.map((u) => [u.id, u]));
  const path: Unit[] = [];
  for (let u = id ? byId.get(id) : undefined; u && path.length < 10; u = u.parentId ? byId.get(u.parentId) : undefined) path.unshift(u);
  return path;
};

/** Подразделения деревом: родитель, затем дети по названию. */
export const unitTree = (units: Unit[]): { unit: Unit; depth: number }[] => {
  const out: { unit: Unit; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) =>
    units
      .filter((u) => u.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .forEach((u) => {
        out.push({ unit: u, depth });
        walk(u.id, depth + 1);
      });
  walk(null, 0);
  return out;
};
