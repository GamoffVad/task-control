import { DEFAULT_USERS } from './access';
import { DEFAULT_UNIT_OF, DEFAULT_UNITS, MAIN_DEPARTMENT_ID, unitWithDescendants } from './units';
import type { AbsenceStatus, AbsenceType, Category, Department, Employee, ManagedUser, PlanRow, Role, Unit } from './types';

// Сотрудники приложения — это пользователи из базы (Администрирование → Пользователи),
// а группы в фильтрах — отделения основного отдела (Администрирование → Подразделения).
// Списки ниже живые: syncStaff обновляет их на месте при загрузке данных на клиенте и на сервере,
// поэтому все экраны и проверки видят актуальный состав без передачи через пропсы.

export const employees: Employee[] = [];
export const employeeById = new Map<number, Employee>();
export const department: Department = { id: MAIN_DEPARTMENT_ID, name: '', groups: [] };

/** Сотрудник из пользователя: ФИО делится на фамилию, имя и отчество. */
const toEmployee = (u: ManagedUser): Employee => {
  const [lastname = '', name = '', ...rest] = u.fullName.trim().split(/\s+/);
  return { id: u.employeeId, role: u.role, lastname, name, patronymic: rest.join(' '), position: u.position };
};

/** Подразделение пользователя: сохранённое или, для старых записей, по умолчанию. */
export const unitOf = (u: Pick<ManagedUser, 'employeeId' | 'unitId'>): string | undefined => u.unitId ?? DEFAULT_UNIT_OF[u.employeeId];

let staffKey = '';
export const syncStaff = (users: ManagedUser[], units: Unit[]) => {
  const key = JSON.stringify([users.map((u) => [u.employeeId, u.fullName, u.position, u.role, u.active, unitOf(u)]), units]);
  if (key === staffKey) return;
  staffKey = key;
  const list = [...users].sort((x, y) => x.employeeId - y.employeeId).map(toEmployee);
  employees.splice(0, employees.length, ...list);
  employeeById.clear();
  for (const e of list) employeeById.set(e.id, e);
  // Группы — отделения основного отдела (или первого отдела, если основной удалён).
  const dept = units.find((u) => u.id === MAIN_DEPARTMENT_ID) ?? units.find((u) => u.kind === 'department');
  department.id = dept?.id ?? MAIN_DEPARTMENT_ID;
  department.name = dept?.name ?? 'Отдел';
  const sections = units.filter((u) => u.parentId === dept?.id).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
  // Порядок отделений: как в справочнике по умолчанию, новые — по алфавиту в конце.
  const order = (id: string) => { const i = DEFAULT_UNITS.findIndex((u) => u.id === id); return i < 0 ? 999 : i; };
  sections.sort((x, y) => order(x.id) - order(y.id));
  const groups = sections.map((sec) => {
    const inside = unitWithDescendants(units, sec.id);
    return { id: sec.id, name: sec.name, employeeIds: users.filter((u) => inside.has(unitOf(u) ?? '')).map((u) => u.employeeId).sort((x, y) => x - y) };
  });
  const grouped = new Set(groups.flatMap((g) => g.employeeIds));
  const rest = users.filter((u) => !grouped.has(u.employeeId)).map((u) => u.employeeId).sort((x, y) => x - y);
  if (rest.length) groups.push({ id: 'unit-none', name: 'Без отделения', employeeIds: rest });
  department.groups = groups.filter((g) => g.employeeIds.length > 0);
};
syncStaff(DEFAULT_USERS, DEFAULT_UNITS);

/** Демонстрационные сотрудники 1–7 (с задачами и учётными записями с паролем). */
export const isCoreEmployee = (id: number) => id < 100;

/** Сотрудники группы отдела; 'all' — весь отдел. */
export const groupMembers = (group: string): Employee[] =>
  group === 'all' ? employees : employees.filter((e) => department.groups.find((g) => g.id === group)?.employeeIds.includes(e.id));

/** Учётные записи прототипа. Пароль хранится открыто: сервера нет. Роль берётся из карточки сотрудника. */
export const accounts: { email: string; password: string; employeeId: number }[] = [
  { email: 'user@example.com', password: '123456', employeeId: 1 },
  { email: 'petrov@example.com', password: '123456', employeeId: 2 },
  { email: 'sidorov@example.com', password: '123456', employeeId: 3 },
  { email: 'smirnova@example.com', password: '123456', employeeId: 7 },
];

export const ROLE_LABELS: Record<Role, string> = {
  administrator: 'администратор',
  manager: 'руководитель',
  executor: 'исполнитель',
};

/** Задачи вне основных категорий: обычная работа, в том числе вне плана. */
export const OTHER_CATEGORY = 'Иное';

/** Категории мероприятий. Цвет задаётся CSS-переменной --cat-<key> для каждой темы. */
export const CATEGORIES: { key: Category; label: string; short: string }[] = [
  { key: 'reportDept', label: 'Доклад руководству отдела', short: 'Доклад отдела' },
  { key: 'reportDirectorate', label: 'Доклад руководству управления и службы', short: 'Доклад управления' },
  { key: 'reportAgency', label: 'Доклад руководству ведомства', short: 'Доклад ведомства' },
  { key: 'interim', label: 'Промежуточный контроль', short: 'Промежуточный контроль' },
];

export const categoryLabel = (c: Category | null): string =>
  CATEGORIES.find((x) => x.key === c)?.label ?? OTHER_CATEGORY;

const row = (id: string, title: string, isHeader: boolean, baseScore = 0): PlanRow => ({ id, title, isHeader, baseScore });
const rng = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const planRows: PlanRow[] = [
  row('1', 'Организационные мероприятия', true),
  row('1.1', 'Подготовка аналитических материалов', false, 5),
  row('1.2', 'Проведение совещаний и планёрок', false, 5),
  row('1.3', 'Согласование документов с подразделениями', false, 5),
  row('2', 'Финансово-хозяйственная деятельность', true),
  row('2.1', 'Бюджетирование и сметы', false, 5),
  row('2.2', 'Закупки и договорная работа', false, 5),
  row('3', 'Проектная деятельность', true),
  row('3.1', 'Разработка программных модулей', true),
  ...rng(1, 13).map((i) => row(`3.1.${i}`, `Модуль ${i}: разработка и сопровождение`, false, 2)),
  row('3.2', 'Тестирование и внедрение', true),
  ...rng(1, 8).map((i) => row(`3.2.${i}`, `Этап внедрения ${i}`, false, 2)),
  row('3.3', 'Техническая документация', true),
  row('3.3.1', 'Технические задания', false, 2),
  row('3.3.2', 'Руководства пользователя', false, 2),
  row('3.4', 'Сопровождение пользователей', true),
  row('3.4.1', 'Обработка обращений', false, 2),
  row('3.4.2', 'Обучение сотрудников', false, 2),
  row('3.4.3', 'Консультации', false, 2),
  row('3.5', 'Информационная безопасность', false, 5),
  row('3.6', 'Резервное копирование', false, 5),
  row('3.7', 'Развитие инфраструктуры', true),
  row('3.7.1', 'Серверное оборудование', false, 2),
  row('3.7.2', 'Сетевая инфраструктура', false, 2),
  row('3.7.3', 'Рабочие места', false, 2),
  row('4', 'Документооборот', true),
  row('4.1', 'Регистрация входящих и исходящих документов', false, 5),
  row('4.2', 'Контроль поручений', false, 5),
];

/** Иерархический порядок кодов: 3.1.2 идёт раньше 3.1.10. */
export const comparePlanRows = (a: Pick<PlanRow, 'id'>, b: Pick<PlanRow, 'id'>): number => {
  const left = a.id.split('.');
  const right = b.id.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const ln = Number(left[i]);
    const rn = Number(right[i]);
    const result = Number.isFinite(ln) && Number.isFinite(rn) ? ln - rn : left[i].localeCompare(right[i], 'ru', { numeric: true });
    if (result) return result;
  }
  return 0;
};

export const sortedPlanRows = (rows: PlanRow[]): PlanRow[] => [...rows].sort(comparePlanRows);

export const planRowById = new Map(planRows.map((r) => [r.id, r]));


/** «Иванов А.Б.» */
export const shortName = (id: number | null | undefined): string => {
  if (id == null) return '—';
  const e = employeeById.get(id);
  return e ? `${e.lastname} ${e.name[0]}.${e.patronymic[0]}.` : 'Неизвестен';
};

export const fullName = (id: number): string => {
  const e = employeeById.get(id);
  return e ? `${e.lastname} ${e.name} ${e.patronymic}` : 'Неизвестен';
};

export const initials = (id: number): string => {
  const e = employeeById.get(id);
  return e ? `${e.lastname[0]}${e.name[0]}` : '??';
};

/** Виды отсутствий. Цвет — CSS-переменная --abs-<key>. Отгул считается в рабочих днях, остальное — в календарных. */
export const ABSENCE_TYPES: { key: AbsenceType; label: string; full: string }[] = [
  { key: 'vacation', label: 'Отпуск', full: 'Ежегодный отпуск' },
  { key: 'trip', label: 'Командировка', full: 'Командировка' },
  { key: 'dayoff', label: 'Отгул', full: 'Отгул' },
  { key: 'sick', label: 'Больничный', full: 'Больничный' },
  { key: 'study', label: 'Учёба', full: 'Обучение, курсы' },
];

export const absenceType = (key: AbsenceType) => ABSENCE_TYPES.find((t) => t.key === key)!;

export const ABSENCE_STATUS_LABELS: Record<AbsenceStatus, string> = {
  request: 'заявка',
  approved: 'согласовано',
  rejected: 'отклонено',
};
