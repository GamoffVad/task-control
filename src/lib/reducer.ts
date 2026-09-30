// Изменение данных приложения. Чистые функции без React: тот же код работает в браузере и на сервере,
// поэтому права проверяются одинаково в обоих местах.
import { employeeById, planRows, sortedPlanRows } from './data';
import { ACCESS_VERSION, DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_SCORING, DEFAULT_USERS, effectiveUser, hasPermission, permissionsFor, withAddedAdminPermissions } from './access';
import { createSeed, DEFAULT_DICTIONARIES } from './seed';
import { normalizeAppearance } from './appearance';
import { buildReportEntries, clampScore, upsertReport, type TaskDraft } from './logic';
import { absenceAccess, isManager, taskAccess } from './permissions';
import { toDateKey } from './dates';
import type { AbsenceDraft } from './absences';
import type { Absence, AbsenceStatus, AppearanceSettings, AppState, ChatRead, AuthenticationMode, Data, DictionaryEntry, DictionaryKind, Entitlement, ManagedUser, Message, Permission, PlanRow, Role, RoleDefinition, ScoringSettings, Task, TemplateScope, Unit, UnitKind, User } from './types';
import { DEFAULT_UNIT_OF, DEFAULT_UNITS, PARENT_KIND } from './units';
import { DEFAULT_TEMPLATES, parseTemplate, templateScope } from './templates';

export type DictionaryDraft = {
  id?: string;
  dictionary: DictionaryKind;
  code: string;
  title: string;
  color?: string;
};

/** Цвет значения справочника: только #RRGGBB, иначе цвета нет. */
export const normalizeColor = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : undefined;

export type PlanRowDraft = {
  originalId?: string;
  id: string;
  title: string;
  isHeader: boolean;
  baseScore: number;
};

export type UnitDraft = { id?: string; parentId: string | null; kind: UnitKind; name: string };

export type Action =
  | { type: 'login'; email: string; employeeId: number; role: Role; permissions?: Permission[] }
  | { type: 'logout' }
  | { type: 'saveTask'; draft: TaskDraft; now?: Date }
  | { type: 'deleteTask'; id: string }
  | { type: 'submitReport'; weekStart: Date; now?: Date }
  | { type: 'sendMessage'; text: string; now?: Date }
  | { type: 'markChatRead'; now?: Date }
  | { type: 'saveAbsence'; draft: AbsenceDraft; now?: Date }
  | { type: 'deleteAbsence'; id: string }
  | { type: 'decideAbsence'; id: string; status: Exclude<AbsenceStatus, 'request'> }
  | { type: 'saveEntitlement'; entitlement: Entitlement }
  | { type: 'saveDictionary'; draft: DictionaryDraft }
  | { type: 'deleteDictionary'; id: string }
  | { type: 'savePlanRow'; draft: PlanRowDraft }
  | { type: 'deletePlanRow'; id: string }
  | { type: 'saveManagedUser'; employeeId: number; role: Role; active: boolean; windowsLogin?: string; unitId?: string; fullName?: string; position?: string; email?: string }
  | { type: 'saveUnit'; draft: UnitDraft }
  | { type: 'saveTemplate'; draft: { id?: string; name: string; body: string; scope: TemplateScope } }
  | { type: 'deleteTemplate'; id: string }
  | { type: 'deleteUnit'; id: string }
  | { type: 'addManagedUser'; account: ManagedUser }
  | { type: 'deleteManagedUser'; employeeId: number }
  | { type: 'saveRolePermissions'; role: Role; permissions: Permission[] }
  | { type: 'saveAuthentication'; mode: AuthenticationMode; allowEmergencyForm: boolean }
  | { type: 'saveScoring'; scoring: ScoringSettings }
  | { type: 'saveAppearance'; appearance: AppearanceSettings }
  | { type: 'reset'; now?: Date };

/** Сдвигает отметку «прочитано» сотрудника вперёд (назад не двигает). */
const markRead = (reads: ChatRead[], employeeId: number, at: string): ChatRead[] => {
  const prev = reads.find((r) => r.employeeId === employeeId);
  const readAt = prev && prev.readAt > at ? prev.readAt : at;
  return [...reads.filter((r) => r.employeeId !== employeeId), { employeeId, readAt }];
};

/** Действия, которые меняют общие данные и сохраняются в базе. */
export const PERSISTED: Action['type'][] = [
  'saveTask',
  'deleteTask',
  'submitReport',
  'sendMessage',
  'markChatRead',
  'saveAbsence',
  'deleteAbsence',
  'decideAbsence',
  'saveEntitlement',
  'saveDictionary',
  'deleteDictionary',
  'savePlanRow',
  'deletePlanRow',
  'saveManagedUser',
  'addManagedUser',
  'saveUnit',
  'deleteUnit',
  'saveTemplate',
  'deleteTemplate',
  'deleteManagedUser',
  'saveRolePermissions',
  'saveAuthentication',
  'saveScoring',
  'reset',
];

let counter = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Применяет правку с учётом прав: исполнитель меняет только поля исполнения своих задач. */
const applyDraft = (user: User | null, existing: Task | undefined, draft: TaskDraft): TaskDraft | null => {
  const access = taskAccess(user, existing ?? null);
  if (!existing) {
    if (!access.plan) return null;
    // Исполнитель создаёт задачу только для себя и без индивидуальных баллов.
    return isManager(user) ? draft : { ...draft, assigneeIds: [user!.employeeId], score: null };
  }
  if (access.plan) return { ...draft, score: access.score ? draft.score : existing.score };
  if (!access.execution) return null;
  const { id: _id, doneAt: _doneAt, ...base } = existing;
  return { ...base, id: existing.id, docName: draft.docName, docNumber: draft.docNumber, result: draft.result, done: draft.done };
};

const saveAbsence = (state: AppState, draft: AbsenceDraft, now: Date): AppState => {
  const user = state.user;
  const existing = draft.id ? state.absences.find((a) => a.id === draft.id) : undefined;
  if (draft.id && !existing) return state;
  if (!absenceAccess(user, existing ?? null).edit) return state;
  const manager = hasPermission(user, 'absences.manage');
  const absence: Absence = {
    id: existing?.id ?? newId('abs'),
    // Исполнитель подаёт заявку только на себя; согласует её руководитель.
    employeeId: manager ? draft.employeeId : user!.employeeId,
    type: draft.type,
    from: draft.from,
    to: draft.type === 'sick' ? draft.to : (draft.to ?? draft.from),
    status: manager ? draft.status : 'request',
    note: draft.note.trim(),
    decidedBy: manager && draft.status !== 'request' ? user!.employeeId : null,
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  const absences = existing ? state.absences.map((a) => (a.id === absence.id ? absence : a)) : [...state.absences, absence];
  return { ...state, absences };
};

export const reducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'login':
      return { ...state, user: { email: action.email, employeeId: action.employeeId, role: action.role, permissions: action.permissions ?? permissionsFor(action.role, state.roles) } };
    case 'logout':
      return { ...state, user: null };
    case 'saveTask': {
      const now = action.now ?? new Date();
      const existing = action.draft.id ? state.tasks.find((t) => t.id === action.draft.id) : undefined;
      const allowed = applyDraft(state.user, existing, action.draft);
      if (!allowed) return state;
      const { id: _id, ...rest } = allowed;
      const doneAt = rest.done ? (existing?.done && existing.doneAt ? existing.doneAt : now.toISOString()) : null;
      const score = rest.score === null ? null : clampScore(rest.score);
      const task: Task = { ...rest, score, id: existing?.id ?? newId('task'), doneAt };
      const tasks = existing ? state.tasks.map((t) => (t.id === task.id ? task : t)) : [...state.tasks, task];
      return { ...state, tasks };
    }
    case 'deleteTask':
      if (!hasPermission(state.user, 'tasks.delete')) return state;
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case 'submitReport': {
      if (!hasPermission(state.user, 'reports.view') || !hasPermission(state.user, 'tasks.plan')) return state;
      const now = action.now ?? new Date();
      const report = {
        weekStart: toDateKey(action.weekStart),
        submittedAt: now.toISOString(),
        entries: buildReportEntries(state, action.weekStart),
      };
      return { ...state, reports: upsertReport(state.reports, report) };
    }
    case 'sendMessage': {
      const text = action.text.trim().slice(0, 1000);
      if (!text || !state.user) return state;
      const message: Message = {
        id: newId('msg'),
        authorId: state.user.employeeId,
        text,
        sentAt: (action.now ?? new Date()).toISOString(),
      };
      return { ...state, messages: [...state.messages, message], chatReads: markRead(state.chatReads, state.user.employeeId, message.sentAt) };
    }
    case 'markChatRead':
      // Отметка «прочитано» только для себя; время — серверное, поэтому состояние всегда новое.
      if (!state.user) return state;
      return { ...state, chatReads: markRead(state.chatReads, state.user.employeeId, (action.now ?? new Date()).toISOString()) };
    case 'saveAbsence':
      return saveAbsence(state, action.draft, action.now ?? new Date());
    case 'deleteAbsence': {
      const a = state.absences.find((x) => x.id === action.id);
      if (!a || !absenceAccess(state.user, a).delete) return state;
      return { ...state, absences: state.absences.filter((x) => x.id !== action.id) };
    }
    case 'decideAbsence': {
      if (!hasPermission(state.user, 'absences.manage')) return state;
      const absences = state.absences.map((a) =>
        a.id === action.id ? { ...a, status: action.status, decidedBy: state.user!.employeeId } : a,
      );
      return { ...state, absences };
    }
    case 'saveEntitlement': {
      if (!hasPermission(state.user, 'entitlements.manage')) return state;
      const e = action.entitlement;
      const clean: Entitlement = {
        employeeId: e.employeeId,
        year: e.year,
        vacationDays: Math.max(0, Math.round(e.vacationDays)),
        carriedOver: Math.max(0, Math.round(e.carriedOver)),
        dayoffAccrued: Math.max(0, Math.round(e.dayoffAccrued)),
      };
      const rest = state.entitlements.filter((x) => !(x.employeeId === clean.employeeId && x.year === clean.year));
      return { ...state, entitlements: [...rest, clean] };
    }
    case 'saveDictionary': {
      if (!hasPermission(state.user, 'dictionaries.manage')) return state;
      const draft = action.draft;
      const code = draft.code.trim().replace(/\s+/g, '-').slice(0, 48);
      const title = draft.title.trim().slice(0, 160);
      if (!code || !title) return state;
      const existing = draft.id ? state.dictionaries.find((entry) => entry.id === draft.id) : undefined;
      if (draft.id && !existing) return state;
      const duplicate = state.dictionaries.some((entry) =>
        entry.id !== existing?.id && entry.dictionary === draft.dictionary && entry.code.toLowerCase() === code.toLowerCase(),
      );
      if (duplicate) return state;
      const color = draft.dictionary === 'absenceType' || draft.dictionary === 'taskCategory' ? normalizeColor(draft.color) : undefined;
      const entry: DictionaryEntry = { id: existing?.id ?? newId('dict'), dictionary: draft.dictionary, code, title, ...(color ? { color } : {}) };
      const dictionaries = existing
        ? state.dictionaries.map((item) => (item.id === entry.id ? entry : item))
        : [...state.dictionaries, entry];
      return { ...state, dictionaries };
    }
    case 'deleteDictionary': {
      if (!hasPermission(state.user, 'dictionaries.manage') || !state.dictionaries.some((entry) => entry.id === action.id)) return state;
      return { ...state, dictionaries: state.dictionaries.filter((entry) => entry.id !== action.id) };
    }
    case 'savePlanRow': {
      if (!hasPermission(state.user, 'planRows.manage')) return state;
      const originalId = action.draft.originalId;
      const id = action.draft.id.trim().slice(0, 48);
      const title = action.draft.title.trim().slice(0, 200);
      const validId = /^[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*$/u.test(id);
      const existing = originalId ? state.planRows.find((row) => row.id === originalId) : undefined;
      if (!validId || !title || (originalId && !existing)) return state;
      if (existing && action.draft.isHeader && state.tasks.some((task) => task.rowId === existing.id)) return state;
      // Родитель — раздел плана; позицию нельзя вложить в неё саму или в её потомка.
      const parentId = id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null;
      if (parentId && !state.planRows.some((row) => row.id === parentId && row.isHeader && row.id !== originalId)) return state;
      if (originalId && (id === originalId || id.startsWith(`${originalId}.`)) && id !== originalId) return state;
      // При смене кода вложенные позиции переезжают вместе с разделом, задачи — вместе с позициями.
      const moved = new Map<string, string>();
      if (originalId && originalId !== id) {
        moved.set(originalId, id);
        for (const item of state.planRows) if (item.id.startsWith(`${originalId}.`)) moved.set(item.id, id + item.id.slice(originalId.length));
      }
      const lower = (value: string) => value.toLocaleLowerCase('ru');
      const targets = new Set([...moved.values(), id].map(lower));
      if (state.planRows.some((row) => !moved.has(row.id) && row.id !== originalId && targets.has(lower(row.id)))) return state;
      if (!action.draft.isHeader && state.planRows.some((row) => row.id.startsWith(`${originalId ?? id}.`))) return state;
      const baseScore = action.draft.isHeader ? 0 : clampScore(action.draft.baseScore);
      const row: PlanRow = { id, title, isHeader: action.draft.isHeader, baseScore };
      const rows = existing
        ? state.planRows.map((item) => (item.id === originalId ? row : moved.has(item.id) ? { ...item, id: moved.get(item.id)! } : item))
        : [...state.planRows, row];
      const tasks = moved.size ? state.tasks.map((task) => (task.rowId && moved.has(task.rowId) ? { ...task, rowId: moved.get(task.rowId)! } : task)) : state.tasks;
      return { ...state, tasks, planRows: sortedPlanRows(rows) };
    }
    case 'deletePlanRow': {
      if (!hasPermission(state.user, 'planRows.manage') || !state.planRows.some((row) => row.id === action.id)) return state;
      if (state.tasks.some((task) => task.rowId === action.id)) return state;
      return { ...state, planRows: state.planRows.filter((row) => row.id !== action.id) };
    }
    case 'saveManagedUser': {
      if (!hasPermission(state.user, 'users.manage')) return state;
      const current = state.users.find((item) => item.employeeId === action.employeeId);
      if (!current) return state;
      const windowsLogin = (action.windowsLogin ?? current.windowsLogin).trim().slice(0, 128);
      if (!windowsLogin || state.users.some((item) => item.employeeId !== action.employeeId && item.windowsLogin.toLowerCase() === windowsLogin.toLowerCase())) return state;
      if (action.unitId !== undefined && action.unitId !== '' && !state.units.some((u) => u.id === action.unitId)) return state;
      const unitId = action.unitId === undefined ? current.unitId : action.unitId || undefined;
      // ФИО, должность и почта правятся здесь же: данные сотрудника ведёт администратор,
      // независимо от способа входа и наличия Active Directory.
      const fullName = (action.fullName ?? current.fullName).trim().slice(0, 200);
      const position = (action.position ?? current.position).trim().slice(0, 200);
      const email = (action.email ?? current.email).trim().toLowerCase().slice(0, 200);
      if (!fullName || !email) return state;
      if (state.users.some((item) => item.employeeId !== action.employeeId && item.email.toLowerCase() === email)) return state;
      const users = state.users.map((item) => item.employeeId === action.employeeId ? { ...item, role: action.role, active: action.active, windowsLogin, unitId, fullName, position, email } : item);
      const hasAdmin = users.some((item) => item.active && ['admin.access', 'users.manage', 'roles.manage'].every((permission) => permissionsFor(item.role, state.roles).includes(permission as Permission)));
      if (!hasAdmin) return state;
      const user = effectiveUser(state.user, users, state.roles);
      return { ...state, users, user };
    }
    case 'addManagedUser': {
      if (!hasPermission(state.user, 'users.manage')) return state;
      const account = action.account;
      const login = account.windowsLogin.trim().slice(0, 128);
      const fullName = account.fullName.trim().slice(0, 200);
      const email = account.email.trim().toLowerCase().slice(0, 200);
      if (!fullName || !login || !Number.isInteger(account.employeeId) || account.employeeId < 1) return state;
      if (state.users.some((item) => item.employeeId === account.employeeId || item.windowsLogin.toLowerCase() === login.toLowerCase())) return state;
      if (account.unitId && !state.units.some((u) => u.id === account.unitId)) return state;
      const users = [...state.users, { ...account, fullName, email, windowsLogin: login, position: account.position.trim().slice(0, 200) }];
      return { ...state, users };
    }
    case 'saveUnit': {
      // Подразделения: организация → управление → отдел → отделение, родитель — строго уровнем выше.
      if (!hasPermission(state.user, 'units.manage')) return state;
      const d = action.draft;
      const name = d.name.trim().slice(0, 200);
      if (!name || !(d.kind in PARENT_KIND)) return state;
      const existing = d.id ? state.units.find((u) => u.id === d.id) : undefined;
      if (d.id && !existing) return state;
      const parentKind = PARENT_KIND[d.kind];
      const parent = d.parentId ? state.units.find((u) => u.id === d.parentId) : undefined;
      if (parentKind ? parent?.kind !== parentKind : d.parentId !== null) return state;
      // Смена уровня у подразделения с вложенными нарушила бы иерархию.
      if (existing && existing.kind !== d.kind && state.units.some((u) => u.parentId === existing.id)) return state;
      const unit: Unit = { id: existing?.id ?? newId('unit'), parentId: parentKind ? d.parentId : null, kind: d.kind, name };
      const units = existing ? state.units.map((u) => (u.id === unit.id ? unit : u)) : [...state.units, unit];
      return { ...state, units };
    }
    case 'saveTemplate': {
      // Шаблоны документов: название и текст с подстановками; неразбираемый шаблон не сохраняется.
      if (!hasPermission(state.user, 'templates.manage')) return state;
      const name = action.draft.name.trim().slice(0, 160);
      const body = action.draft.body.slice(0, 20000);
      if (!name || !body.trim()) return state;
      try {
        parseTemplate(body);
      } catch {
        return state;
      }
      const existing = action.draft.id ? state.templates.find((t) => t.id === action.draft.id) : undefined;
      if (action.draft.id && !existing) return state;
      const template = { id: existing?.id ?? newId('tpl'), name, body, scope: templateScope(action.draft) };
      const templates = existing ? state.templates.map((t) => (t.id === template.id ? template : t)) : [...state.templates, template];
      return { ...state, templates };
    }
    case 'deleteTemplate': {
      if (!hasPermission(state.user, 'templates.manage') || !state.templates.some((t) => t.id === action.id)) return state;
      return { ...state, templates: state.templates.filter((t) => t.id !== action.id) };
    }
    case 'deleteUnit': {
      if (!hasPermission(state.user, 'units.manage')) return state;
      if (!state.units.some((u) => u.id === action.id)) return state;
      // Удалить можно только пустое подразделение: без вложенных и без сотрудников.
      if (state.units.some((u) => u.parentId === action.id) || state.users.some((u) => (u.unitId ?? DEFAULT_UNIT_OF[u.employeeId]) === action.id)) return state;
      return { ...state, units: state.units.filter((u) => u.id !== action.id) };
    }
    case 'deleteManagedUser': {
      if (!hasPermission(state.user, 'users.manage') || state.user?.employeeId === action.employeeId) return state;
      if (!state.users.some((item) => item.employeeId === action.employeeId)) return state;
      const users = state.users.filter((item) => item.employeeId !== action.employeeId);
      const hasAdmin = users.some((item) => item.active && ['admin.access', 'users.manage', 'roles.manage'].every((permission) => permissionsFor(item.role, state.roles).includes(permission as Permission)));
      return hasAdmin ? { ...state, users } : state;
    }
    case 'saveRolePermissions': {
      if (!hasPermission(state.user, 'roles.manage')) return state;
      const allowed = new Set<Permission>([
        'admin.access', 'users.manage', 'roles.manage', 'dictionaries.manage', 'reports.view', 'tasks.plan', 'tasks.execute',
        'tasks.score', 'tasks.delete', 'absences.manage', 'absences.request', 'entitlements.manage', 'data.reset', 'authentication.manage',
      ]);
      const permissions = [...new Set(action.permissions.filter((permission) => allowed.has(permission)))];
      const roles = state.roles.map((item) => item.role === action.role ? { ...item, permissions } : item);
      const hasAdmin = state.users.some((item) => item.active && ['admin.access', 'users.manage', 'roles.manage'].every((permission) => permissionsFor(item.role, roles).includes(permission as Permission)));
      if (!hasAdmin) return state;
      const user = effectiveUser(state.user, state.users, roles);
      return { ...state, roles, user };
    }
    case 'saveAuthentication':
      if (!hasPermission(state.user, 'authentication.manage')) return state;
      return { ...state, authentication: { mode: action.mode, allowEmergencyForm: action.allowEmergencyForm } };
    case 'saveScoring': {
      if (!hasPermission(state.user, 'scoring.manage')) return state;
      const { excludedUnitIds, excludedEmployeeIds, averageBase, byDirection } = action.scoring;
      // Исключения хранятся без повторов: список приходит из флажков и может содержать дубли.
      return {
        ...state,
        scoring: {
          excludedUnitIds: [...new Set(excludedUnitIds)],
          excludedEmployeeIds: [...new Set(excludedEmployeeIds)],
          averageBase,
          byDirection,
        },
      };
    }
    case 'saveAppearance':
      // Оформление у каждого своё и хранится в браузере, поэтому отдельного разрешения не требует.
      return { ...state, appearance: normalizeAppearance(action.appearance) };
    case 'reset':
      if (!hasPermission(state.user, 'data.reset')) return state;
      return { ...createSeed(action.now), user: effectiveUser(state.user, DEFAULT_USERS, DEFAULT_ROLES) };
  }
};

/** Сохранённые данные прежних версий (1 и 2) приводятся к текущей модели. */
type Stored = {
  version: number;
  tasks: (Partial<Task> & Omit<Task, 'category' | 'score'>)[];
  reports: AppState['reports'];
  messages: AppState['messages'];
  chatReads?: AppState['chatReads'];
  absences?: Absence[];
  entitlements?: Entitlement[];
  planRows?: PlanRow[];
  dictionaries?: DictionaryEntry[];
  users?: ManagedUser[];
  roles?: RoleDefinition[];
  units?: Unit[];
  templates?: AppState['templates'];
  authentication?: AppState['authentication'];
  user: (Omit<User, 'role'> & { role?: Role }) | null;
  scores?: Record<string, number>;
};

export const isStored = (v: unknown): v is Stored =>
  typeof v === 'object' &&
  v !== null &&
  [1, 2, 3, 4, 5].includes((v as Stored).version) &&
  Array.isArray((v as Stored).tasks) &&
  Array.isArray((v as Stored).reports) &&
  Array.isArray((v as Stored).messages);

export const migrate = (s: Stored): AppState => {
  const scores = s.scores ?? {};
  const roleOf = (id: number): Role => employeeById.get(id)?.role ?? 'executor';
  const users = (s.users ?? DEFAULT_USERS).map((user) => {
    const employee = employeeById.get(user.employeeId);
    return { ...user, windowsLogin: user.windowsLogin || user.email.split('@')[0], fullName: user.fullName || (employee ? `${employee.lastname} ${employee.name} ${employee.patronymic}` : user.windowsLogin), position: user.position || employee?.position || '', unitId: user.unitId ?? DEFAULT_UNIT_OF[user.employeeId] };
  });
  const roles = (s.roles ?? DEFAULT_ROLES).map((role) => s.version < 4 && role.role === 'administrator' && !role.permissions.includes('authentication.manage')
    ? { ...role, permissions: [...role.permissions, 'authentication.manage' as Permission] }
    : role);
  const state: AppState = {
    version: 5,
    tasks: s.tasks.map((t) => ({
      ...t,
      category: t.category ?? null,
      // Изменённый в версии 1 вес строки переносится в задачи этой строки.
      score: t.score !== undefined ? t.score : t.rowId && scores[t.rowId] !== undefined ? scores[t.rowId] : null,
    })),
    reports: s.reports,
    messages: s.messages,
    chatReads: s.chatReads ?? [],
    absences: s.absences ?? [],
    entitlements: s.entitlements ?? [],
    planRows: sortedPlanRows(s.planRows ?? planRows),
    dictionaries: s.dictionaries ?? DEFAULT_DICTIONARIES,
    users,
    roles,
    authentication: s.authentication ?? { ...DEFAULT_AUTHENTICATION },
    scoring: { ...DEFAULT_SCORING },
    appearance: normalizeAppearance(undefined),
    units: s.units ?? DEFAULT_UNITS.map((u) => ({ ...u })),
    templates: (s.templates ?? DEFAULT_TEMPLATES).map((t) => ({ ...t, scope: templateScope(t) })),
    user: null,
  };
  const legacyUser = s.user ? { ...s.user, role: s.user.role ?? roleOf(s.user.employeeId) } : null;
  return { ...state, user: effectiveUser(legacyUser, users, roles) };
};

export const toData = (s: AppState): Data => ({
  tasks: s.tasks,
  reports: s.reports,
  messages: s.messages,
  chatReads: s.chatReads,
  absences: s.absences,
  entitlements: s.entitlements,
  planRows: s.planRows,
  dictionaries: s.dictionaries,
  users: s.users,
  roles: s.roles,
  units: s.units,
  templates: s.templates,
  authentication: s.authentication,
  scoring: s.scoring,
  accessVersion: ACCESS_VERSION,
});

export const fromData = (d: Data, user: User | null): AppState => {
  const users = d.users ?? DEFAULT_USERS;
  // Отметка версии прав: если она отстала, администратору дописываются права, добавленные позже.
  // В PostgreSQL и SQL Server ту же роль играет access-version в tc_meta.
  const roles = d.accessVersion === ACCESS_VERSION ? (d.roles ?? DEFAULT_ROLES) : withAddedAdminPermissions(d.roles ?? DEFAULT_ROLES);
  const normalizedUsers = users.map((account) => {
    const employee = employeeById.get(account.employeeId);
    return { ...account, windowsLogin: account.windowsLogin || account.email.split('@')[0], fullName: account.fullName || (employee ? `${employee.lastname} ${employee.name} ${employee.patronymic}` : account.windowsLogin), position: account.position || employee?.position || '', unitId: account.unitId ?? DEFAULT_UNIT_OF[account.employeeId] };
  });
  const { notices: _notices, accessVersion: _accessVersion, ...rest } = d;
  return { version: 5, ...rest, chatReads: d.chatReads ?? [], units: d.units ?? DEFAULT_UNITS.map((u) => ({ ...u })), templates: (d.templates ?? DEFAULT_TEMPLATES).map((t) => ({ ...t, scope: templateScope(t) })), planRows: sortedPlanRows(d.planRows ?? planRows), dictionaries: d.dictionaries ?? DEFAULT_DICTIONARIES, users: normalizedUsers, roles, authentication: d.authentication ?? { ...DEFAULT_AUTHENTICATION }, scoring: d.scoring ?? { ...DEFAULT_SCORING }, appearance: normalizeAppearance(undefined), user: effectiveUser(user, normalizedUsers, roles) };
};
