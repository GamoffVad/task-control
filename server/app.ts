// HTTP API приложения. Работает и как функция Vercel, и внутри сервера разработки Vite.
//   POST /api/login   { email, password }  → { token, user }
//   GET  /api/state                        → { data }
//   POST /api/action  { action }           → { data }
//   GET  /api/health                       → { ok, storage } либо 503, если база не отвечает
//   GET  /api/notices?since=ISO            → { notices, now } — новые уведомления вошедшего сотрудника
//   GET  /api/windows-check                → что сервер видит в запросе для входа через Windows (администратору)
// Изменения выполняет тот же редьюсер, что и в браузере, с пользователем из подписанного токена,
// поэтому права проверяются на сервере независимо от интерфейса.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateAbsence, type AbsenceDraft } from '../src/lib/absences';
import { authenticate } from '../src/lib/auth';
import { DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_USERS, effectiveUser, hasPermission, sessionUser } from '../src/lib/access';
import { CATEGORIES, employeeById, planRows, syncCategories, syncStaff } from '../src/lib/data';
import { DEFAULT_UNITS } from '../src/lib/units';
import { validateTask, type TaskDraft } from '../src/lib/logic';
import { fromData, PERSISTED, reducer, toData, type Action } from '../src/lib/reducer';
import { createSeed, DEFAULT_DICTIONARIES } from '../src/lib/seed';
import type { Data, DictionaryKind, Entitlement, ManagedUser, Permission, Role, UnitKind, User } from '../src/lib/types';
import { signToken, verifyToken } from './auth';
import type { Repo } from './repo';
import type { ActiveDirectory } from './activeDirectory';
import type { WindowsAuthCheck } from './windowsAuth';
import { dayKey, detectEvents, hourOf, overdueNotice, type NoticeEvent } from '../src/lib/notify';
import { newId } from '../src/lib/reducer';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  repo: Repo;
  secret: string;
  now?: () => Date;
  /** Returns an identity only after a trusted proxy has completed Windows authentication. */
  windowsIdentity?: (req: IncomingMessage) => string | null;
  /** Разбор запроса для страницы проверки Windows-входа в администрировании. */
  windowsCheck?: (req: IncomingMessage) => WindowsAuthCheck;
  directory?: ActiveDirectory;
};

const MAX_BODY = 256 * 1024;

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос.');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Тело запроса — не JSON.');
  }
};

// ——— Проверка входящих данных: редьюсер доверяет форме объектов, поэтому мусор отсекается здесь. ———

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 2000) => typeof v === 'string' && v.length <= max;
const isoDate = (v: unknown) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const dateKey = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const bad = (what: string): never => {
  throw new HttpError(400, `Неверные данные: ${what}.`);
};

const checkTaskDraft = (d: unknown, data: Data): TaskDraft => {
  if (!isObj(d)) return bad('задача');
  if (d.id !== undefined && !str(d.id, 100)) bad('идентификатор задачи');
  if (!str(d.title, 300)) bad('название');
  const rows = data.planRows ?? planRows;
  if (d.rowId !== null && !(typeof d.rowId === 'string' && rows.some((row) => row.id === d.rowId))) bad('позиция плана');
  if (d.category !== null && !CATEGORIES.some((c) => c.key === d.category)) bad('категория');
  if (!Array.isArray(d.assigneeIds) || d.assigneeIds.length > 20 || !d.assigneeIds.every((a) => typeof a === 'number' && employeeById.has(a))) bad('исполнители');
  if (!isoDate(d.start) || !isoDate(d.end)) bad('сроки');
  if (!str(d.docName, 300) || !str(d.docNumber, 100) || !str(d.result, 4000)) bad('документ или результат');
  if (typeof d.done !== 'boolean') bad('отметка об исполнении');
  if (d.score !== null && typeof d.score !== 'number') bad('баллы');
  const draft: TaskDraft = {
    ...(d.id ? { id: d.id as string } : {}),
    title: d.title as string,
    rowId: d.rowId as string | null,
    category: d.category as TaskDraft['category'],
    assigneeIds: d.assigneeIds as number[],
    start: new Date(d.start as string).toISOString(),
    end: new Date(d.end as string).toISOString(),
    docName: d.docName as string,
    docNumber: d.docNumber as string,
    result: d.result as string,
    done: d.done as boolean,
    score: d.score as number | null,
  };
  const errors = Object.values(validateTask(draft));
  if (errors.length) throw new HttpError(400, errors[0]!);
  return draft;
};

const checkAbsenceDraft = (d: unknown, data: Data, now: Date): AbsenceDraft => {
  if (!isObj(d)) return bad('отсутствие');
  if (d.id !== undefined && !str(d.id, 100)) bad('идентификатор отсутствия');
  if (typeof d.employeeId !== 'number' || !employeeById.has(d.employeeId)) bad('сотрудник');
  if (!['vacation', 'trip', 'dayoff', 'sick', 'study'].includes(d.type as string)) bad('вид отсутствия');
  if (!dateKey(d.from) || (d.to !== null && !dateKey(d.to))) bad('даты');
  if (!['request', 'approved', 'rejected'].includes(d.status as string)) bad('статус');
  if (!str(d.note, 500)) bad('комментарий');
  const draft: AbsenceDraft = {
    ...(d.id ? { id: d.id as string } : {}),
    employeeId: d.employeeId as number,
    type: d.type as AbsenceDraft['type'],
    from: d.from as string,
    to: d.to as string | null,
    status: d.status as AbsenceDraft['status'],
    note: d.note as string,
  };
  const errors = Object.values(validateAbsence(draft, data.absences, now));
  if (errors.length) throw new HttpError(400, errors[0]!);
  return draft;
};

/** Проверяет форму действия и подставляет серверное время. */
export const parseAction = (raw: unknown, data: Data, now: Date): Action => {
  if (!isObj(raw) || typeof raw.type !== 'string' || !PERSISTED.includes(raw.type as Action['type'])) bad('действие');
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'saveTask':
      return { type: 'saveTask', draft: checkTaskDraft(a.draft, data), now };
    case 'deleteTask':
      if (!str(a.id, 100)) bad('идентификатор задачи');
      return { type: 'deleteTask', id: a.id as string };
    case 'submitReport':
      if (!isoDate(a.weekStart)) bad('неделя отчёта');
      return { type: 'submitReport', weekStart: new Date(a.weekStart as string), now };
    case 'markChatRead':
      return { type: 'markChatRead', now };
    case 'sendMessage':
      if (!str(a.text, 1000)) bad('сообщение');
      return { type: 'sendMessage', text: a.text as string, now };
    case 'saveAbsence':
      return { type: 'saveAbsence', draft: checkAbsenceDraft(a.draft, data, now), now };
    case 'deleteAbsence':
      if (!str(a.id, 100)) bad('идентификатор отсутствия');
      return { type: 'deleteAbsence', id: a.id as string };
    case 'decideAbsence':
      if (!str(a.id, 100) || (a.status !== 'approved' && a.status !== 'rejected')) bad('решение по заявке');
      return { type: 'decideAbsence', id: a.id as string, status: a.status as 'approved' | 'rejected' };
    case 'saveEntitlement': {
      const e = a.entitlement;
      if (!isObj(e) || typeof e.employeeId !== 'number' || !employeeById.has(e.employeeId)) bad('нормы сотрудника');
      const n = e as Record<string, unknown>;
      const nums = ['year', 'vacationDays', 'carriedOver', 'dayoffAccrued'].every(
        (k) => typeof n[k] === 'number' && Number.isFinite(n[k]) && (n[k] as number) >= 0 && (n[k] as number) <= 3000,
      );
      if (!nums) bad('нормы сотрудника');
      return { type: 'saveEntitlement', entitlement: e as unknown as Entitlement };
    }
    case 'saveDictionary': {
      const draft = a.draft;
      if (!isObj(draft)) bad('значение справочника');
      const entry = draft as Record<string, unknown>;
      if (entry.id !== undefined && !str(entry.id, 100)) bad('идентификатор значения');
      if (!['taskCategory', 'absenceType', 'taskStatus'].includes(entry.dictionary as string)) bad('справочник');
      if (entry.color !== undefined && (typeof entry.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry.color))) bad('цвет значения');
      if (!str(entry.code, 48) || !str(entry.title, 160)) bad('код или название значения');
      return {
        type: 'saveDictionary',
        draft: {
          ...(entry.id ? { id: entry.id as string } : {}),
          dictionary: entry.dictionary as DictionaryKind,
          code: entry.code as string,
          title: entry.title as string,
          ...(typeof entry.color === 'string' ? { color: entry.color } : {}),
        },
      };
    }
    case 'deleteDictionary':
      if (!str(a.id, 100)) bad('идентификатор значения');
      return { type: 'deleteDictionary', id: a.id as string };
    case 'savePlanRow': {
      if (!isObj(a.draft)) bad('позиция плана');
      const draft = a.draft as Record<string, unknown>;
      if (draft.originalId !== undefined && !str(draft.originalId, 48)) bad('исходный код позиции');
      if (!str(draft.id, 48) || !String(draft.id).trim() || !str(draft.title, 200) || !String(draft.title).trim()) bad('код или название позиции');
      if (typeof draft.isHeader !== 'boolean' || typeof draft.baseScore !== 'number' || !Number.isFinite(draft.baseScore)) bad('тип или вес позиции');
      return { type: 'savePlanRow', draft: { ...(draft.originalId ? { originalId: draft.originalId as string } : {}), id: draft.id as string, title: draft.title as string, isHeader: draft.isHeader as boolean, baseScore: draft.baseScore as number } };
    }
    case 'deletePlanRow':
      if (!str(a.id, 48)) bad('код позиции плана');
      return { type: 'deletePlanRow', id: a.id as string };
    case 'saveManagedUser':
      if (typeof a.employeeId !== 'number' || !data.users.some((user) => user.employeeId === a.employeeId)) bad('пользователь');
      if (!['administrator', 'manager', 'executor'].includes(a.role as string) || typeof a.active !== 'boolean' || (a.windowsLogin !== undefined && (!str(a.windowsLogin, 128) || !(a.windowsLogin as string).trim()))) bad('роль или Windows-логин пользователя');
      if (a.unitId !== undefined && (typeof a.unitId !== 'string' || (a.unitId !== '' && !(data.units ?? DEFAULT_UNITS).some((u) => u.id === a.unitId)))) bad('подразделение пользователя');
      if (a.fullName !== undefined && (!str(a.fullName, 200) || !String(a.fullName).trim())) bad('ФИО сотрудника');
      if (a.position !== undefined && !str(a.position, 200)) bad('должность сотрудника');
      if (a.email !== undefined && (!str(a.email, 200) || !String(a.email).trim())) bad('электронную почту сотрудника');
      return {
        type: 'saveManagedUser',
        employeeId: a.employeeId as number,
        role: a.role as Role,
        active: a.active as boolean,
        ...(a.windowsLogin !== undefined ? { windowsLogin: a.windowsLogin as string } : {}),
        ...(a.unitId !== undefined ? { unitId: a.unitId as string } : {}),
        ...(a.fullName !== undefined ? { fullName: a.fullName as string } : {}),
        ...(a.position !== undefined ? { position: a.position as string } : {}),
        ...(a.email !== undefined ? { email: a.email as string } : {}),
      };
    case 'addManagedUser': {
      if (!isObj(a.account)) bad('пользователь');
      const account = a.account as Record<string, unknown>;
      if (typeof account.employeeId !== 'number' || !Number.isInteger(account.employeeId) || account.employeeId < 1) bad('идентификатор пользователя');
      if (!str(account.fullName, 200) || !String(account.fullName).trim() || !str(account.position, 200) || !str(account.email, 200) || !str(account.windowsLogin, 128) || !String(account.windowsLogin).trim()) bad('данные пользователя');
      if (!['administrator', 'manager', 'executor'].includes(account.role as string) || typeof account.active !== 'boolean') bad('роль пользователя');
      if (account.unitId !== undefined && (typeof account.unitId !== 'string' || !(data.units ?? DEFAULT_UNITS).some((u) => u.id === account.unitId))) bad('подразделение пользователя');
      return { type: 'addManagedUser', account: account as unknown as ManagedUser };
    }
    case 'saveUnit': {
      if (!isObj(a.draft)) bad('подразделение');
      const d = a.draft as Record<string, unknown>;
      if (d.id !== undefined && !str(d.id, 100)) bad('идентификатор подразделения');
      if (!['organization', 'directorate', 'department', 'section'].includes(d.kind as string)) bad('уровень подразделения');
      if (!str(d.name, 200) || !String(d.name).trim()) bad('название подразделения');
      if (d.parentId !== null && !str(d.parentId, 100)) bad('вышестоящее подразделение');
      return { type: 'saveUnit', draft: { ...(d.id ? { id: d.id as string } : {}), parentId: d.parentId as string | null, kind: d.kind as UnitKind, name: d.name as string } };
    }
    case 'saveTemplate': {
      if (!isObj(a.draft)) bad('шаблон');
      const d = a.draft as Record<string, unknown>;
      if (d.id !== undefined && !str(d.id, 100)) bad('идентификатор шаблона');
      if (!str(d.name, 160) || !String(d.name).trim() || !str(d.body, 20000) || !String(d.body).trim()) bad('название или текст шаблона');
      if (d.scope !== 'planning' && d.scope !== 'reports') bad('раздел шаблона');
      return { type: 'saveTemplate', draft: { ...(d.id ? { id: d.id as string } : {}), name: d.name as string, body: d.body as string, scope: d.scope as 'planning' | 'reports' } };
    }
    case 'deleteTemplate':
      if (!str(a.id, 100)) bad('шаблон');
      return { type: 'deleteTemplate', id: a.id as string };
    case 'deleteUnit':
      if (!str(a.id, 100)) bad('подразделение');
      return { type: 'deleteUnit', id: a.id as string };
    case 'deleteManagedUser':
      if (typeof a.employeeId !== 'number' || !data.users.some((user) => user.employeeId === a.employeeId)) bad('пользователь');
      return { type: 'deleteManagedUser', employeeId: a.employeeId as number };
    case 'saveRolePermissions': {
      if (!['administrator', 'manager', 'executor'].includes(a.role as string) || !Array.isArray(a.permissions)) bad('роль');
      const allowed: Permission[] = ['admin.access', 'authentication.manage', 'users.manage', 'roles.manage', 'dictionaries.manage', 'reports.view', 'tasks.plan', 'tasks.execute', 'tasks.score', 'tasks.delete', 'absences.manage', 'absences.request', 'entitlements.manage', 'data.reset'];
      const permissions = a.permissions as unknown[];
      if (!permissions.every((permission) => typeof permission === 'string' && allowed.includes(permission as Permission))) bad('разрешения');
      return { type: 'saveRolePermissions', role: a.role as Role, permissions: a.permissions as Permission[] };
    }
    case 'saveAuthentication':
      if (!['form', 'windows'].includes(a.mode as string) || typeof a.allowEmergencyForm !== 'boolean') bad('способ входа');
      return { type: 'saveAuthentication', mode: a.mode as 'form' | 'windows', allowEmergencyForm: a.allowEmergencyForm as boolean };
    case 'reset':
      return { type: 'reset', now };
  }
  return bad('действие');
};

const bearer = (req: IncomingMessage) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

/** Доменный логин в разных видах: «DOMAIN\ivanov», «ivanov@corp.local» и просто «ivanov». */
const identityKeys = (value: string): string[] => {
  const normalized = value.trim().toLowerCase();
  const slash = normalized.lastIndexOf('\\');
  const short = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const at = short.indexOf('@');
  return [...new Set([normalized, short, at > 0 ? short.slice(0, at) : short])];
};

const normalizeUsers = (users: ManagedUser[]): ManagedUser[] => users.map((user) => {
  const employee = employeeById.get(user.employeeId);
  return {
    ...user,
    windowsLogin: user.windowsLogin || user.email.split('@')[0],
    fullName: user.fullName || (employee ? `${employee.lastname} ${employee.name} ${employee.patronymic}` : user.windowsLogin),
    position: user.position || employee?.position || '',
  };
});

const REQUIRED_ADMIN_PERMISSIONS: Permission[] = ['admin.access', 'users.manage', 'roles.manage'];

/** Не оставляет приложение без входа администратора после неполной миграции или повреждения таблицы доступа. */
const recoverAdministrativeAccess = (users: ManagedUser[], roles: Data['roles'], ensureFormAdministrator: boolean): { users: ManagedUser[]; roles: Data['roles'] } => {
  const defaultAdminRole = DEFAULT_ROLES.find((item) => item.role === 'administrator')!;
  const roleCanAdminister = (role: Role, definitions = roles) => {
    const permissions = definitions.find((item) => item.role === role)?.permissions ?? [];
    return REQUIRED_ADMIN_PERMISSIONS.every((permission) => permissions.includes(permission));
  };
  const safeRoles = roles.some((role) => roleCanAdminister(role.role))
    ? roles
    : [...roles.filter((role) => role.role !== 'administrator'), { ...defaultAdminRole, permissions: [...defaultAdminRole.permissions] }];
  const fallback = { ...DEFAULT_USERS[0] };
  const fallbackReady = users.some((user) =>
    user.employeeId === fallback.employeeId
    && user.email.toLowerCase() === fallback.email.toLowerCase()
    && user.windowsLogin.toLowerCase() === fallback.windowsLogin.toLowerCase()
    && user.active
    && roleCanAdminister(user.role, safeRoles),
  );
  if (ensureFormAdministrator && fallbackReady) return { users, roles: safeRoles };
  if (!ensureFormAdministrator && users.some((user) => user.active && roleCanAdminister(user.role, safeRoles))) return { users, roles: safeRoles };
  const safeUsers = [fallback, ...users.filter((user) =>
    user.employeeId !== fallback.employeeId
    && user.email.toLowerCase() !== fallback.email.toLowerCase()
    && user.windowsLogin.toLowerCase() !== fallback.windowsLogin.toLowerCase(),
  )];
  return { users: safeUsers, roles: safeRoles };
};

/** Действия, о которых сообщают уведомлениями (восстановление демоданных и администрирование — нет). */
const NOTIFYING = new Set(['saveTask', 'sendMessage', 'saveAbsence', 'decideAbsence', 'submitReport']);

/** Уведомления хранятся неделю. */
const NOTICE_TTL_MS = 7 * 24 * 3600 * 1000;
/** Напоминание о просрочке — не раньше этого часа по времени отдела. */
const OVERDUE_HOUR = 9;
const toNotices = (events: NoticeEvent[], at: Date) => events.map((e) => ({ id: newId('ntc'), at: at.toISOString(), ...e }));
const fresh = (data: Data, now: Date) => (data.notices ?? []).filter((n) => now.getTime() - Date.parse(n.at) < NOTICE_TTL_MS);

/** Клиенту не нужны чужие отметки «прочитано» и журнал уведомлений (свои уведомления — через /api/notices). */
const forUser = (data: Data, user: User): Data => {
  const { notices: _notices, ...rest } = data;
  return { ...rest, chatReads: (data.chatReads ?? []).filter((r) => r.employeeId === user.employeeId) };
};

export const createApi = ({ repo, secret, now = () => new Date(), windowsIdentity, windowsCheck, directory }: Options) => {
  const normalizeData = (data: Data): Data => {
    const authentication = data.authentication ?? { ...DEFAULT_AUTHENTICATION };
    // Выбранный режим сохраняется как есть. Если сервер не умеет Windows-вход, приложение
    // не переписывает настройку, а пускает по форме (см. POST /api/login) — иначе переключатель
    // в администрировании «не держится», а причина остаётся неизвестной.
    const access = recoverAdministrativeAccess(normalizeUsers(data.users ?? DEFAULT_USERS), data.roles ?? DEFAULT_ROLES, authentication.mode === 'form' || !windowsIdentity);
    return { ...data, ...access, authentication };
  };
  /** Данные; пустая база заполняется демонстрационными данными. */
  const load = async (): Promise<Data> => {
    const data = (await repo.read()) ?? await repo.update((cur) => cur ?? toData(createSeed(now())));
    // Проверки сотрудников (исполнители, отсутствия, нормы) — по актуальному составу из базы.
    syncStaff(data.users ?? DEFAULT_USERS, data.units ?? DEFAULT_UNITS);
    syncCategories(data.dictionaries ?? DEFAULT_DICTIONARIES);
    return normalizeData(data);
  };

  const authed = (req: IncomingMessage): User => {
    const user = verifyToken(bearer(req), secret, now());
    if (!user) throw new HttpError(401, 'Сеанс истёк. Войдите заново.');
    return user;
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
      switch (route) {
        case 'GET /api/health': {
          // Проверяем само соединение: настроенная, но недоступная база — частая причина «белого экрана».
          try {
            await repo.ping?.();
          } catch (e) {
            console.error('Хранилище недоступно:', e);
            return send(res, 503, { ok: false, storage: repo.kind, error: 'База данных недоступна.' });
          }
          return send(res, 200, { ok: true, storage: repo.kind });
        }
        case 'GET /api/authentication': {
          const current = await load();
          return send(res, 200, { authentication: current.authentication, windowsAvailable: !!windowsIdentity, directoryAvailable: !!directory });
        }
        case 'GET /api/windows-check': {
          // Проверка настройки для администратора: что сервер видит в этом самом запросе.
          const tokenUser = authed(req);
          const current = await load();
          const user = effectiveUser(tokenUser, current.users, current.roles);
          if (!user) throw new HttpError(401, 'Учётная запись отключена.');
          if (!hasPermission(user, 'authentication.manage')) throw new HttpError(403, 'Недостаточно прав для проверки способа входа.');
          const check = windowsCheck?.(req) ?? {
            enabled: false,
            secretRequired: false,
            secretOk: false,
            seen: [],
            identity: null,
            problem: 'Windows-вход выключен на сервере: задайте переменную WINDOWS_AUTH_TRUST_PROXY=true и перезапустите приложение.',
          };
          // Сопоставление с пользователем приложения: без него вход не состоится даже при верном заголовке.
          const keys = check.identity ? identityKeys(check.identity) : [];
          const match = current.users.find((item) => keys.includes(item.windowsLogin.trim().toLowerCase()));
          return send(res, 200, {
            ...check,
            matched: match ? { employeeId: match.employeeId, fullName: match.fullName, windowsLogin: match.windowsLogin, active: match.active } : null,
            problem:
              check.problem ??
              (!match
                ? `Доменный пользователь «${check.identity}» не сопоставлен: добавьте этот логин в столбец «Windows-логин» нужного сотрудника.`
                : !match.active
                  ? `Сотрудник ${match.fullName} отключён — включите учётную запись.`
                  : null),
          });
        }
        case 'GET /api/directory-users': {
          const tokenUser = authed(req);
          const current = await load();
          const user = effectiveUser(tokenUser, current.users, current.roles);
          if (!user) throw new HttpError(401, 'Учётная запись отключена.');
          if (!hasPermission(user, 'users.manage')) throw new HttpError(403, 'Недостаточно прав для поиска пользователей.');
          if (!directory) throw new HttpError(503, 'Поиск в Active Directory не настроен на сервере.');
          const query = url.searchParams.get('q')?.trim() ?? '';
          if (query.length < 2) return send(res, 200, { users: [] });
          try {
            return send(res, 200, { users: await directory.search(query) });
          } catch (error) {
            console.error(error);
            throw new HttpError(503, 'Active Directory недоступен. Проверьте подключение к домену и модуль ActiveDirectory.');
          }
        }
        case 'POST /api/login': {
          const body = await readBody(req);
          const email = isObj(body) && typeof body.email === 'string' ? body.email : '';
          const password = isObj(body) && typeof body.password === 'string' ? body.password : '';
          const current = await load();
          const account = authenticate(email, password, current.users, current.roles);
          if (!account) throw new HttpError(401, 'Неверный логин или пароль. Проверьте данные и повторите вход.');
          // Форма закрывается, только если прокси действительно передал доменного пользователя
          // в этом же запросе: при неверной настройке IIS иначе никто не смог бы войти.
          const seamless = !!windowsIdentity?.(req);
          if (current.authentication.mode === 'windows' && seamless && (!current.authentication.allowEmergencyForm || !hasPermission(account, 'admin.access'))) {
            throw new HttpError(403, 'Включён вход через Windows. Используйте доменную учётную запись.');
          }
          const user: User = account;
          return send(res, 200, { token: signToken(user, secret, now()), user });
        }
        case 'POST /api/windows-login': {
          const current = await load();
          if (current.authentication.mode !== 'windows') throw new HttpError(409, 'Вход через Windows не включён администратором.');
          if (!windowsIdentity) throw new HttpError(503, 'Windows-аутентификация не настроена на сервере.');
          const identity = windowsIdentity(req);
          if (!identity) throw new HttpError(401, 'Сервер не получил подтверждённую учётную запись Windows.');
          const keys = identityKeys(identity);
          const account = current.users.find((item) => item.active && keys.includes(item.windowsLogin.trim().toLowerCase()));
          if (!account) throw new HttpError(403, 'Учётная запись Windows не сопоставлена с активным пользователем приложения.');
          const user = sessionUser(account, current.roles);
          return send(res, 200, { token: signToken(user, secret, now()), user });
        }
        case 'GET /api/notices': {
          // Вкладка приложения периодически забирает новые уведомления сотрудника и показывает их средствами Chrome.
          const tokenUser = authed(req);
          const t = now();
          let data = await load();
          const user = effectiveUser(tokenUser, data.users, data.roles);
          if (!user) throw new HttpError(401, 'Учётная запись отключена.');
          const me = user.employeeId;
          // Напоминание о просрочке — раз в день, при первом обращении сотрудника после 9:00. Внешний планировщик не нужен.
          const overdueId = `ntc-overdue-${me}-${dayKey(t)}`;
          if (hourOf(t) >= OVERDUE_HOUR && !(data.notices ?? []).some((n) => n.id === overdueId)) {
            const event = overdueNotice(data, me, t);
            if (event) {
              data = await repo.update((cur) => {
                const base = cur ?? data;
                if ((base.notices ?? []).some((n) => n.id === overdueId)) return base;
                return { ...base, notices: [...fresh(base, t), { id: overdueId, at: t.toISOString(), ...event }] };
              });
            }
          }
          const since = Date.parse(url.searchParams.get('since') ?? '');
          const notices = Number.isNaN(since)
            ? []
            : (data.notices ?? [])
                .filter((n) => n.to.includes(me) && Date.parse(n.at) > since)
                .sort((a, b) => a.at.localeCompare(b.at))
                .slice(-20)
                .map(({ to: _to, ...n }) => n);
          return send(res, 200, { notices, now: t.toISOString() });
        }
        case 'GET /api/state': {
          const tokenUser = authed(req);
          const data = await load();
          if (!effectiveUser(tokenUser, data.users, data.roles)) throw new HttpError(401, 'Учётная запись отключена.');
          return send(res, 200, { data: forUser(data, tokenUser) });
        }
        case 'POST /api/action': {
          const tokenUser = authed(req);
          const body = await readBody(req);
          const t = now();
          const data = await repo.update((cur) => {
            const raw = cur ?? toData(createSeed(t));
            const current = normalizeData(raw);
            const action = parseAction(isObj(body) ? body.action : undefined, current, t);
            // Режим «Windows» разрешено включать заранее: пока сервер не настроен, вход идёт по форме,
            // а в администрировании показывается, чего не хватает (GET /api/windows-check).
            if (action.type === 'saveAuthentication' && action.mode === 'windows' && !action.allowEmergencyForm && !windowsIdentity) {
              throw new HttpError(409, 'Windows-вход ещё не настроен на сервере: оставьте включённым резервный вход администратора по паролю.');
            }
            const user = effectiveUser(tokenUser, current.users, current.roles);
            if (!user) throw new HttpError(401, 'Учётная запись отключена.');
            const before = fromData(current, user);
            const after = reducer(before, action);
            // Редьюсер возвращает прежнее состояние, если у пользователя нет прав на действие.
            if (after === before) throw new HttpError(403, 'Изменение не сохранено: недостаточно прав для этого действия.');
            const next: Data = toData(after);
            // Уведомления о событии — в журнал; устаревшие (старше недели) удаляются.
            const events = NOTIFYING.has(action.type) ? detectEvents(current, next, user) : [];
            return { ...next, notices: [...fresh(current, t), ...toNotices(events, t)] };
          });
          return send(res, 200, { data: forUser(data, tokenUser) });
        }
        default:
          throw new HttpError(404, 'Нет такого адреса API.');
      }
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Ошибка сервера. Повторите попытку позже.' });
    }
  };
};
