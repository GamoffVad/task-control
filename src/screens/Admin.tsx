import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icons';
import { DirectoryUserAutocomplete } from '../components/DirectoryUserAutocomplete';
import { Button, Checkbox, ColorPicker, Dialog, PageHeader, Segmented, Select, Slider, TextArea, TextInput } from '../kit';
import { DEFAULT_TEMPLATES, TEMPLATE_SCOPES, placeholdersFor, renderTemplate } from '../lib/templates';
import { reportDocContext } from '../lib/reportExport';
import { planDocContext, planItems } from '../lib/planExport';
import { addDays, fmtRange, planWeekStart } from '../lib/dates';
import { PERMISSIONS, hasPermission, permissionsFor } from '../lib/access';
import { COLOR_GROUPS, COLOR_TOKENS, DEFAULT_APPEARANCE, FONT_STACKS, isPresetActive, MAX_PRESETS, MONO_STACKS, presetsFor, SIZE_TOKENS, tokenValue, type TokenDef } from '../lib/appearance';
import { useTheme, type Theme } from '../lib/theme';
import { DEFAULT_DICTIONARIES } from '../lib/seed';
import { useStore } from '../lib/store';
import type { WindowsCheck } from '../lib/api';
import type { AppearanceSettings, AuthenticationMode, DictionaryEntry, DictionaryKind, DirectoryUser, DocumentTemplate, ManagedUser, ScoringSettings, TemplateScope, Permission, PlanRow, Role, Unit, UnitKind } from '../lib/types';
import { PARENT_KIND, UNIT_KINDS, unitKindLabel, unitPath, unitTree, unitWithDescendants } from '../lib/units';
import { unitOf } from '../lib/data';

type Tab = 'users' | 'units' | 'roles' | 'authentication' | 'scoring' | 'appearance' | 'dictionaries' | 'planRows' | 'templates';
const ALL_TABS: { value: Tab; label: string; permission: Permission }[] = [
  { value: 'users', label: 'Пользователи', permission: 'users.manage' },
  { value: 'units', label: 'Подразделения', permission: 'users.manage' },
  { value: 'roles', label: 'Роли и разрешения', permission: 'roles.manage' },
  { value: 'authentication', label: 'Аутентификация', permission: 'authentication.manage' },
  { value: 'scoring', label: 'Оценка', permission: 'scoring.manage' },
  { value: 'appearance', label: 'Редактирование UI', permission: 'appearance.manage' },
  { value: 'dictionaries', label: 'Словари', permission: 'dictionaries.manage' },
  { value: 'planRows', label: 'Разделы планирования', permission: 'dictionaries.manage' },
  { value: 'templates', label: 'Шаблоны документов', permission: 'dictionaries.manage' },
];
const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'administrator', label: 'Администратор' },
  { value: 'manager', label: 'Руководитель' },
  { value: 'executor', label: 'Исполнитель' },
];
const REQUIRED_ADMIN_PERMISSIONS: Permission[] = ['admin.access', 'users.manage', 'roles.manage'];
const canAdminister = (role: Role, roles: ReturnType<typeof useStore>['state']['roles']) => REQUIRED_ADMIN_PERMISSIONS.every((permission) => permissionsFor(role, roles).includes(permission));
const DICTIONARIES: { value: DictionaryKind; label: string; hint: string }[] = [
  { value: 'taskCategory', label: 'Категории задач', hint: 'Обозначения для классификации задач.' },
  { value: 'absenceType', label: 'Виды отсутствий', hint: 'Причины отсутствия сотрудников.' },
  { value: 'taskStatus', label: 'Статусы задач', hint: 'Текстовые статусы процесса работы.' },
];

type TabProps = { state: ReturnType<typeof useStore>['state']; dispatch: ReturnType<typeof useStore>['dispatch'] };

export const Admin = () => {
  const { state, dispatch } = useStore();
  const tabs = ALL_TABS.filter((item) => hasPermission(state.user, item.permission));
  const [tab, setTab] = useState<Tab>(() => tabs[0]?.value ?? 'users');
  const activeTab = tabs.some((item) => item.value === tab) ? tab : tabs[0]?.value;
  return (
    <section className="admin-page">
      <PageHeader title="Администрирование" subtitle="Пользователи и подразделения, доступ, способ входа, правила оценки, разделы планирования, справочники и шаблоны документов." />
      {tabs.length > 0 && <Segmented value={activeTab!} options={tabs} onChange={setTab} label="Раздел администрирования" />}
      {activeTab === 'users' && <UsersTab state={state} dispatch={dispatch} />}
      {activeTab === 'units' && <UnitsTab state={state} dispatch={dispatch} />}
      {activeTab === 'roles' && <RolesTab state={state} dispatch={dispatch} />}
      {activeTab === 'authentication' && <AuthenticationTab />}
      {activeTab === 'scoring' && <ScoringTab state={state} dispatch={dispatch} />}
      {activeTab === 'appearance' && <AppearanceTab state={state} dispatch={dispatch} />}
      {activeTab === 'dictionaries' && <DictionariesTab state={state} dispatch={dispatch} />}
      {activeTab === 'planRows' && <PlanRowsTab state={state} dispatch={dispatch} />}
      {activeTab === 'templates' && <TemplatesTab state={state} dispatch={dispatch} />}
      {!activeTab && <p className="admin-empty">Для этой роли не назначено разрешений на настройку приложения.</p>}
    </section>
  );
};

const UsersTab = ({ state, dispatch }: TabProps) => {
  const { directoryAvailable } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  return <div className="admin-section">
    <div className="card-head admin-content-head">
      <div><h2>Пользователи</h2><p className="subtitle">Данные сотрудника — ФИО, должность, почта, Windows-логин, подразделение и роль — правятся здесь. Отключённый пользователь не сможет войти.</p></div>
      <div className="admin-users-actions"><span className="faint num">{state.users.filter((item) => item.active).length} активн.</span><Button variant="primary" icon={<Icon.Plus size={15} />} onClick={() => setAdding(true)}>Добавить пользователя</Button></div>
    </div>
    <div className="table-scroll admin-table-wrap">
      <table className="admin-table admin-users-table">
        <caption className="sr-only">Пользователи и назначенные роли</caption>
        <thead><tr><th scope="col">Пользователь</th><th scope="col">Подразделение</th><th scope="col">Учётная запись</th><th scope="col">Windows-логин</th><th scope="col">Роль</th><th scope="col">Доступ</th><th scope="col" className="admin-actions-head">Действие</th></tr></thead>
        <tbody>{state.users.map((account) => {
          const protectedAccount = account.active && canAdminister(account.role, state.roles) && !state.users.some((other) => other.employeeId !== account.employeeId && other.active && canAdminister(other.role, state.roles));
          const currentAccount = state.user?.employeeId === account.employeeId;
          return <tr key={account.employeeId}>
            <td><b>{account.fullName}</b><small className="admin-cell-note">{account.position || 'Сотрудник'}</small></td>
            <td>{(() => { const path = unitPath(state.units, unitOf(account)); const last = path.at(-1); return last ? <span data-tip={path.map((u) => u.name).join(' › ')}>{last.name}</span> : <span className="muted">не выбрано</span>; })()}</td>
            <td><span className="num muted">{account.email}</span></td>
            <td><span className="num">{account.windowsLogin}</span></td>
            <td>{ROLE_OPTIONS.find((option) => option.value === account.role)?.label}</td>
            <td><span className={`admin-access-state${account.active ? ' active' : ''}`}>{protectedAccount ? 'Основной администратор' : account.active ? 'Активен' : 'Отключён'}</span></td>
            <td className="admin-icon-actions">
              <button type="button" className="admin-icon-action" onClick={() => setEditing(account)} aria-label={`Редактировать пользователя ${account.fullName}`} data-tip="Редактировать"><Icon.Edit size={15} /></button>
              <button type="button" className="admin-icon-action danger" disabled={protectedAccount || currentAccount} onClick={() => setDeleting(account)} aria-label={`Удалить пользователя ${account.fullName}`} data-tip={currentAccount ? 'Нельзя удалить текущую учётную запись' : protectedAccount ? 'Нельзя удалить последнего администратора' : 'Удалить'}><Icon.Trash size={15} /></button>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="help-note">Windows-логин указывается без пароля: например, ivanov или DOMAIN\ivanov. В системе всегда сохраняется хотя бы один активный пользователь с правами управления.</p>
    {adding && <AddUserDialog users={state.users} units={state.units} directoryAvailable={directoryAvailable} onClose={() => setAdding(false)} onSave={(account) => { dispatch({ type: 'addManagedUser', account }); setAdding(false); }} />}
    {editing && <EditUserDialog account={editing} users={state.users} units={state.units} protectedAccount={editing.active && canAdminister(editing.role, state.roles) && state.users.filter((item) => item.active && canAdminister(item.role, state.roles)).length === 1} onClose={() => setEditing(null)} onSave={(draft) => { dispatch({ type: 'saveManagedUser', employeeId: editing.employeeId, role: draft.role, active: draft.active, windowsLogin: draft.windowsLogin, unitId: draft.unitId, fullName: draft.fullName, position: draft.position, email: draft.email }); setEditing(null); }} />}
    {deleting && <DeleteUserDialog account={deleting} onClose={() => setDeleting(null)} onConfirm={() => { dispatch({ type: 'deleteManagedUser', employeeId: deleting.employeeId }); setDeleting(null); }} />}
  </div>;
};

/** Поля сотрудника: одинаковые в добавлении и редактировании. */
type PersonDraft = { fullName: string; position: string; email: string; windowsLogin: string; unitId: string; role: Role; active: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Проверка полей: ФИО, почта и Windows-логин обязательны и не повторяются у других сотрудников. */
const checkPerson = (draft: PersonDraft, users: ManagedUser[], employeeId: number | null): string => {
  if (draft.fullName.trim().split(/\s+/).filter(Boolean).length < 2) return 'Укажите фамилию и имя сотрудника.';
  if (!EMAIL_RE.test(draft.email.trim())) return 'Укажите рабочую почту в виде ivanov@example.com.';
  if (!draft.windowsLogin.trim()) return 'Укажите Windows-логин: например, ivanov или DOMAIN\\ivanov.';
  const other = users.filter((u) => u.employeeId !== employeeId);
  if (other.some((u) => u.email.toLowerCase() === draft.email.trim().toLowerCase())) return 'Эта почта уже указана у другого сотрудника.';
  if (other.some((u) => u.windowsLogin.toLowerCase() === draft.windowsLogin.trim().toLowerCase())) return 'Этот Windows-логин уже назначен другому пользователю.';
  return '';
};

/** Общие поля сотрудника. Все доступны для правки независимо от способа входа и настройки Active Directory. */
const PersonFields = ({ draft, set, units, disabledRole, nameSlot }: { draft: PersonDraft; set: <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) => void; units: Unit[]; disabledRole?: boolean; nameSlot?: ReactNode }) => (
  <>
    {nameSlot ?? (
      <label className="field"><span className="caps">ФИО</span>
        <TextInput value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Иванов Алексей Борисович" maxLength={200} />
      </label>
    )}
    <div className="field-row">
      <label className="field"><span className="caps">Должность</span>
        <TextInput value={draft.position} onChange={(e) => set('position', e.target.value)} placeholder="Ведущий специалист" maxLength={200} />
      </label>
      <label className="field"><span className="caps">Электронная почта</span>
        <TextInput value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="ivanov@example.com" maxLength={200} />
      </label>
    </div>
    <div className="field-row">
      <label className="field"><span className="caps">Windows-логин</span>
        <TextInput value={draft.windowsLogin} onChange={(e) => set('windowsLogin', e.target.value)} placeholder="ivanov" mono maxLength={128} />
      </label>
      <div className="field"><span className="caps">Подразделение</span>
        <Select<string> variant="light" label="Подразделение сотрудника" value={draft.unitId} options={unitOptions(units)} onChange={(v) => set('unitId', v)} />
      </div>
    </div>
    <label className="field"><span className="caps">Роль</span>
      <Select<Role> value={draft.role} options={ROLE_OPTIONS} disabled={disabledRole} label="Роль сотрудника" onChange={(v) => set('role', v)} />
    </label>
  </>
);

const EditUserDialog = ({ account, users, units, protectedAccount, onClose, onSave }: { account: ManagedUser; users: ManagedUser[]; units: Unit[]; protectedAccount: boolean; onClose: () => void; onSave: (draft: PersonDraft) => void }) => {
  const [draft, setDraft] = useState<PersonDraft>({
    fullName: account.fullName,
    position: account.position,
    email: account.email,
    windowsLogin: account.windowsLogin,
    unitId: unitOf(account) ?? '',
    role: account.role,
    active: account.active,
  });
  const [error, setError] = useState('');
  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError('');
  };
  const submit = () => {
    const problem = checkPerson(draft, users, account.employeeId);
    if (problem) return setError(problem);
    onSave({ ...draft, fullName: draft.fullName.trim(), position: draft.position.trim(), email: draft.email.trim(), windowsLogin: draft.windowsLogin.trim() });
  };
  return <Dialog title="Редактировать сотрудника" context={account.fullName} onClose={onClose} wide>
    <form className="form-stack edit-user-form" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
      <PersonFields draft={draft} set={set} units={units} disabledRole={protectedAccount} />
      <Checkbox checked={draft.active} disabled={protectedAccount} onChange={(v) => set('active', v)}>{protectedAccount ? 'Основной администратор должен оставаться активным' : 'Разрешить вход в приложение'}</Checkbox>
      <p className="field-hint">ФИО, должность и почта хранятся в приложении и правятся здесь независимо от способа входа и настройки Active Directory.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><Button type="submit" variant="primary" icon={<Icon.Save size={15} />}>Сохранить</Button><Button onClick={onClose}>Отмена</Button></div>
    </form>
  </Dialog>;
};

const DeleteUserDialog = ({ account, onClose, onConfirm }: { account: ManagedUser; onClose: () => void; onConfirm: () => void }) => <Dialog title="Удалить пользователя?" context="Действие потребует подтверждения" onClose={onClose}>
  <div className="delete-user-dialog">
    <div className="delete-user-warning"><Icon.Trash size={18} /><div><strong>{account.fullName}</strong><p>Пользователь потеряет доступ к приложению. Отменить удаление после подтверждения нельзя.</p></div></div>
    <div className="form-actions"><Button variant="danger" icon={<Icon.Trash size={15} />} onClick={onConfirm}>Удалить</Button><Button onClick={onClose}>Отмена</Button></div>
  </div>
</Dialog>;

const AddUserDialog = ({ users, units, directoryAvailable, onClose, onSave }: { users: ManagedUser[]; units: Unit[]; directoryAvailable: boolean; onClose: () => void; onSave: (account: ManagedUser) => void }) => {
  const [draft, setDraft] = useState<PersonDraft>({ fullName: '', position: '', email: '', windowsLogin: '', unitId: '', role: 'executor', active: true });
  const [error, setError] = useState('');
  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError('');
  };
  // Поиск в каталоге только заполняет поля; без Active Directory сотрудник заводится вручную.
  const select = (user: DirectoryUser) => {
    setDraft((prev) => ({ ...prev, fullName: user.fullName, position: user.position, email: user.email, windowsLogin: user.login }));
    setError('');
  };
  const submit = () => {
    const problem = checkPerson(draft, users, null);
    if (problem) return setError(problem);
    const employeeId = Math.max(1000, ...users.map((user) => user.employeeId)) + 1;
    onSave({
      employeeId,
      fullName: draft.fullName.trim(),
      position: draft.position.trim(),
      windowsLogin: draft.windowsLogin.trim(),
      email: draft.email.trim(),
      role: draft.role,
      active: draft.active,
      ...(draft.unitId ? { unitId: draft.unitId } : {}),
    });
  };
  const nameSlot = (
    <label className="field"><span className="caps">ФИО</span>
      {directoryAvailable ? (
        <DirectoryUserAutocomplete value={draft.fullName} invalid={!!error} onChange={(value) => set('fullName', value)} onSelect={select} />
      ) : (
        <TextInput value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Иванов Алексей Борисович" maxLength={200} />
      )}
      <span className="field-hint">
        {directoryAvailable
          ? 'Введите две буквы фамилии и выберите сотрудника — поля заполнятся сами; их можно исправить.'
          : 'Active Directory не настроен — заполните данные вручную.'}
      </span>
    </label>
  );
  return <Dialog title="Добавить сотрудника" context={directoryAvailable ? 'Поиск в Active Directory или ввод вручную' : 'Ввод данных вручную'} onClose={onClose} wide>
    <form className="form-stack add-user-form" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
      <PersonFields draft={draft} set={set} units={units} nameSlot={nameSlot} />
      <Checkbox checked={draft.active} onChange={(v) => set('active', v)}>Разрешить вход в приложение</Checkbox>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><Button type="submit" variant="primary" icon={<Icon.Plus size={15} />}>Добавить</Button><Button onClick={onClose}>Отмена</Button></div>
    </form>
  </Dialog>;
};

const AuthenticationTab = () => {
  const { state, dispatch, windowsAuthAvailable, directoryAvailable, checkWindows, sync } = useStore();
  const [check, setCheck] = useState<WindowsCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const windows = state.authentication.mode === 'windows';
  const choose = (mode: AuthenticationMode) => {
    // Режим переключается всегда: пока сервер не настроен, вход идёт по форме, а проверка ниже покажет, чего не хватает.
    dispatch({ type: 'saveAuthentication', mode, allowEmergencyForm: mode === 'windows' && !windowsAuthAvailable ? true : state.authentication.allowEmergencyForm });
  };
  const runCheck = async () => {
    if (!checkWindows) return;
    setChecking(true);
    setCheckError('');
    try {
      setCheck(await checkWindows());
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Не удалось выполнить проверку.');
    } finally {
      setChecking(false);
    }
  };
  return <div className="admin-section auth-settings">
    <div className="card-head admin-content-head">
      <div><h2>Способ входа</h2><p className="subtitle">Один режим действует для всех пользователей приложения.</p></div>
      <span className={`auth-readiness ${windowsAuthAvailable ? 'ready' : ''}`}>{windowsAuthAvailable ? 'Windows готов' : 'Windows не настроен'}</span>
    </div>
    <div className="auth-choice-grid" role="radiogroup" aria-label="Способ входа">
      <button type="button" role="radio" aria-checked={!windows} onClick={() => choose('form')}>
        <strong>Форма входа</strong><span>Рабочая почта и пароль приложения.</span>
      </button>
      <button type="button" role="radio" aria-checked={windows} onClick={() => choose('windows')}>
        <strong>Windows</strong><span>Бесшовный вход при открытии приложения, без формы и пароля.</span>
      </button>
    </div>
    <div className="auth-emergency">
      <Checkbox
        checked={state.authentication.allowEmergencyForm}
        disabled={!windows || !windowsAuthAvailable}
        onChange={(allowEmergencyForm) => dispatch({ type: 'saveAuthentication', mode: state.authentication.mode, allowEmergencyForm })}
      >
        Разрешить резервный вход администратора по паролю
      </Checkbox>
      <p>Рекомендуется оставить включённым на случай недоступности домена или reverse proxy. Пока Windows-вход не работает на сервере, резервный вход выключить нельзя.</p>
    </div>
    {windows && !windowsAuthAvailable && (
      <p className="help-note amber">
        Режим выбран, но сервер пока не получает доменного пользователя, поэтому вход идёт по форме. Задайте на сервере приложения
        <span className="num"> WINDOWS_AUTH_TRUST_PROXY=true</span>, настройте IIS и нажмите «Проверить настройку» — проверка покажет, чего не хватает.
      </p>
    )}
    {windowsAuthAvailable && <p className="help-note">При открытии приложения сервер сопоставляет подтверждённый доменный логин со столбцом «Windows-логин». Отдельный экран входа пользователю не показывается.</p>}

    <div className="auth-check">
      <div className="card-head admin-content-head">
        <div><h3>Проверка Windows-входа</h3><p className="subtitle">Показывает, что сервер видит именно в вашем запросе: заголовки прокси, доменный логин и сопоставленного сотрудника.</p></div>
        <Button onClick={runCheck} disabled={!checkWindows || checking}>{checking ? 'Проверяем…' : 'Проверить настройку'}</Button>
      </div>
      {checkError && <p className="field-error" role="alert">{checkError}</p>}
      {check && (
        <div className="auth-check-result" role="status">
          <table className="admin-table">
            <tbody>
              <tr><td>Доверие прокси (WINDOWS_AUTH_TRUST_PROXY)</td><td>{check.enabled ? 'включено' : 'выключено'}</td></tr>
              <tr><td>Общий секрет прокси</td><td>{check.secretRequired ? (check.secretOk ? 'задан и совпал' : 'задан, но не получен от прокси') : 'не задан (не проверяется)'}</td></tr>
              <tr>
                <td>Заголовки с доменным пользователем</td>
                <td>{check.seen.length ? check.seen.map((s) => `${s.header}: ${s.value}`).join('; ') : 'не получены'}</td>
              </tr>
              <tr><td>Доменный пользователь</td><td>{check.identity ?? '—'}</td></tr>
              <tr>
                <td>Сотрудник приложения</td>
                <td>{check.matched ? `${check.matched.fullName} (${check.matched.windowsLogin})${check.matched.active ? '' : ' — отключён'}` : 'не сопоставлен'}</td>
              </tr>
            </tbody>
          </table>
          <p className={check.problem ? 'help-note amber' : 'help-note'}>{check.problem ?? 'Всё готово: вход через Windows выполнится автоматически.'}</p>
        </div>
      )}
    </div>

    <p className={`auth-directory-state ${directoryAvailable ? 'ready' : ''}`}>Active Directory: {directoryAvailable ? 'поиск сотрудников доступен' : 'поиск не настроен'}</p>
    {sync.error && <p className="field-error" role="alert">{sync.error}</p>}
  </div>;
};

const RolesTab = ({ state, dispatch }: TabProps) => {
  const [role, setRole] = useState<Role>('administrator');
  const definition = state.roles.find((item) => item.role === role)!;
  const groups = [...new Set(PERMISSIONS.map((item) => item.group))];
  const required: Permission[] = ['admin.access', 'users.manage', 'roles.manage'];
  const hasOtherAdministrator = state.users.some((user) => user.active && user.role !== role && required.every((permission) => permissionsFor(user.role, state.roles).includes(permission)));
  const toggle = (permission: Permission, checked: boolean) => {
    const permissions = checked ? [...definition.permissions, permission] : definition.permissions.filter((item) => item !== permission);
    dispatch({ type: 'saveRolePermissions', role, permissions });
  };
  return <div className="admin-grid admin-role-layout">
    <aside className="admin-directory" aria-label="Роли"><p className="caps">Роли</p><div className="admin-directory-list" role="list">
      {state.roles.map((item) => <button key={item.role} type="button" role="listitem" aria-pressed={item.role === role} onClick={() => setRole(item.role)}><span>{item.name}</span><small className="num">{item.permissions.length}</small></button>)}
    </div></aside>
    <div className="admin-content">
      <div className="card-head admin-content-head"><div><h2>{definition.name}</h2><p className="subtitle">Разрешения применяются ко всем пользователям с этой ролью.</p></div><span className="role-code num">{role}</span></div>
      <div className="permission-groups">{groups.map((group) => <section key={group} className="permission-group" aria-labelledby={`permission-${group}`}>
        <h3 id={`permission-${group}`}>{group}</h3><div className="permission-list">{PERMISSIONS.filter((item) => item.group === group).map((item) => <Checkbox key={item.key} checked={definition.permissions.includes(item.key)} disabled={!hasOtherAdministrator && required.includes(item.key) && state.users.some((user) => user.active && user.role === role)} onChange={(checked) => toggle(item.key, checked)}>{item.label}</Checkbox>)}</div>
      </section>)}</div>
      <p className="help-note">Изменения сохраняются сразу. У активного пользователя должны оставаться разрешения на вход в администрирование, управление пользователями и ролями.</p>
    </div>
  </div>;
};

const AVERAGE_BASES: { value: ScoringSettings['averageBase']; label: string; hint: string }[] = [
  { value: 'staff', label: 'Все сотрудники', hint: 'Делим на численность, кроме исключённых. Сотрудник без баллов занижает среднее.' },
  { value: 'active', label: 'Действующие', hint: 'Отключённые учётные записи в знаменатель не идут.' },
  { value: 'withScore', label: 'Только с баллами', hint: 'Делим на число тех, у кого есть баллы за период.' },
];

const ScoringTab = ({ state, dispatch }: TabProps) => {
  const scoring = state.scoring;
  const save = (patch: Partial<ScoringSettings>) => dispatch({ type: 'saveScoring', scoring: { ...scoring, ...patch } });
  // Исключать можно любое подразделение: и отделение отдела, и целое управление.
  const units = useMemo(() => unitTree(state.units), [state.units]);
  const excludedUnits = new Set(scoring.excludedUnitIds);
  const excludedPeople = new Set(scoring.excludedEmployeeIds);
  const toggleUnit = (id: string, on: boolean) =>
    save({ excludedUnitIds: on ? [...scoring.excludedUnitIds, id] : scoring.excludedUnitIds.filter((x) => x !== id) });
  const togglePerson = (id: number, on: boolean) =>
    save({ excludedEmployeeIds: on ? [...scoring.excludedEmployeeIds, id] : scoring.excludedEmployeeIds.filter((x) => x !== id) });
  // Сотрудник уже исключён подразделением — отдельная отметка ему не нужна.
  const byUnit = new Set<number>();
  for (const id of scoring.excludedUnitIds) {
    const inside = unitWithDescendants(state.units, id);
    for (const user of state.users) if (inside.has(unitOf(user) ?? '')) byUnit.add(user.employeeId);
  }

  return <div className="admin-section">
    <div className="card-head admin-content-head">
      <div><h2>Правила подсчёта баллов</h2><p className="subtitle">Правила применяются при показе: изменение пересчитывает и прошлые периоды. Вес самой записи отчёта остаётся тем, что был на момент отправки.</p></div>
    </div>

    <h3 className="admin-subhead">Вне общей оценки</h3>
    <p className="subtitle">Баллы исключённых видны на своих местах, но не входят в итог и среднее по отделу — так обычно поступают с руководством.</p>
    <ul className="scoring-units">
      {units.map(({ unit, depth }) => (
        <li key={unit.id} style={{ paddingLeft: depth * 18 }}>
          <Checkbox checked={excludedUnits.has(unit.id)} onChange={(on) => toggleUnit(unit.id, on)}>
            {unit.name} <span className="faint">· {unitKindLabel(unit.kind)}</span>
          </Checkbox>
        </li>
      ))}
    </ul>

    <h3 className="admin-subhead">Отдельные сотрудники</h3>
    <ul className="scoring-people">
      {[...state.users].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')).map((user) => (
        <li key={user.employeeId}>
          <Checkbox
            checked={excludedPeople.has(user.employeeId) || byUnit.has(user.employeeId)}
            disabled={byUnit.has(user.employeeId)}
            onChange={(on) => togglePerson(user.employeeId, on)}
          >
            {user.fullName}
            {byUnit.has(user.employeeId) && <span className="faint"> · по подразделению</span>}
          </Checkbox>
        </li>
      ))}
    </ul>

    <h3 className="admin-subhead">Средний балл</h3>
    <p className="subtitle">Чем делится общий балл отдела или направления.</p>
    <div className="scoring-choice" role="radiogroup" aria-label="Знаменатель среднего балла">
      {AVERAGE_BASES.map((item) => (
        <button key={item.value} type="button" role="radio" aria-checked={scoring.averageBase === item.value} onClick={() => save({ averageBase: item.value })}>
          <strong>{item.label}</strong><span>{item.hint}</span>
        </button>
      ))}
    </div>

    <h3 className="admin-subhead">Направления</h3>
    <Checkbox checked={scoring.byDirection} onChange={(byDirection) => save({ byDirection })}>
      Показывать разрез по направлениям в «Показателях»
    </Checkbox>
    <p className="subtitle">Направления — отделения основного отдела, те же, что в фильтре «Группа».</p>
  </div>;
};

/** Строка цвета: выбор цвета, название и возврат к значению дизайн-системы. */
const ColorRow = ({ token, value, isDefault, onChange, onReset }: {
  token: TokenDef;
  value: string;
  isDefault: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) => (
  <div className="ui-color">
    <ColorPicker value={value} label={`Цвет: ${token.label}`} onChange={onChange} />
    <span className="ui-color-label">{token.label}</span>
    <button type="button" className="text-action" disabled={isDefault} onClick={onReset}>
      по умолчанию
    </button>
  </div>
);

const AppearanceTab = ({ state, dispatch }: TabProps) => {
  const pageTheme = useTheme();
  const [theme, setTheme] = useState<Theme>(pageTheme);
  const appearance = state.appearance;
  const save = (patch: Partial<AppearanceSettings>) => dispatch({ type: 'saveAppearance', appearance: { ...appearance, ...patch } });
  const setColor = (name: string, value: string) => save({ [theme]: { ...appearance[theme], [name]: value } } as Partial<AppearanceSettings>);
  const resetColor = (name: string) => {
    const rest = { ...appearance[theme] };
    delete rest[name];
    save({ [theme]: rest } as Partial<AppearanceSettings>);
  };
  const changed = Object.keys(appearance.light).length + Object.keys(appearance.dark).length;
  const presets = presetsFor(appearance, theme);
  const [presetName, setPresetName] = useState('');

  return <div className="admin-section">
    <div className="card-head admin-content-head">
      <div>
        <h2>Редактирование UI</h2>
        <p className="subtitle">Цвета, шрифты и размеры текста. Изменения видны сразу и действуют для всех пользователей. Сохраняются только отличия от оформления по умолчанию.</p>
      </div>
      <Button
        onClick={() => dispatch({ type: 'saveAppearance', appearance: { ...DEFAULT_APPEARANCE, light: {}, dark: {}, sizes: { ...DEFAULT_APPEARANCE.sizes } } })}
        disabled={changed === 0 && appearance.fontBody === DEFAULT_APPEARANCE.fontBody && appearance.fontMono === DEFAULT_APPEARANCE.fontMono && SIZE_TOKENS.every((i) => appearance.sizes[i.name] === i.base)}
      >
        Вернуть всё по умолчанию
      </Button>
    </div>

    <h3 className="admin-subhead">Шрифты</h3>
    <p className="subtitle">Только те, что есть в системе: приложение ничего не загружает из интернета.</p>
    <div className="ui-fields">
      <label className="field">
        <span className="caps">Основной шрифт</span>
        <Select value={appearance.fontBody} options={FONT_STACKS} onChange={(fontBody) => save({ fontBody })} label="Основной шрифт" />
        <span className="ui-sample" style={{ fontFamily: appearance.fontBody, fontSize: appearance.sizes.base }}>
          Подготовить отчёт по редизайну портала
        </span>
      </label>
      <label className="field">
        <span className="caps">Шрифт чисел и дат</span>
        <Select value={appearance.fontMono} options={MONO_STACKS} onChange={(fontMono) => save({ fontMono })} label="Шрифт чисел и дат" />
        <span className="ui-sample" style={{ fontFamily: appearance.fontMono, fontSize: appearance.sizes.base }}>
          17.09.2026 · 10:00–12:30 · 4,5 балла
        </span>
      </label>
    </div>

    <h3 className="admin-subhead">Размеры текста</h3>
    <p className="subtitle">Образец под ползунком показывает, как текст будет выглядеть.</p>
    <div className="ui-sizes">
      {SIZE_TOKENS.map((item) => (
        <div className="ui-size" key={item.name}>
          <span className="caps">{item.label}</span>
          <Slider
            value={appearance.sizes[item.name]}
            min={item.min}
            max={item.max}
            step={0.5}
            label={`${item.label}, пикселей`}
            format={(value) => `${String(value).replace('.', ',')} px`}
            onChange={(value) => save({ sizes: { ...appearance.sizes, [item.name]: value } })}
          />
          <span
            className={`ui-sample ui-sample--${item.name}`}
            style={{ fontFamily: appearance.fontBody, fontSize: appearance.sizes[item.name] }}
          >
            {item.sample}
          </span>
          <span className="field-hint">{item.hint} От {item.min} до {item.max} пикселей, по умолчанию {item.base}.</span>
        </div>
      ))}
    </div>

    <h3 className="admin-subhead">Цвета</h3>
    <p className="subtitle">Готовая тема задаёт поверхности и акцент целиком; отдельные цвета можно поправить ниже и сохранить как свою тему.</p>
    <div className="ui-theme-switch">
      <Segmented
        label="Тема, цвета которой правятся"
        value={theme}
        options={[{ value: 'light' as Theme, label: 'Светлая' }, { value: 'dark' as Theme, label: 'Тёмная' }]}
        onChange={setTheme}
      />
      {theme !== pageTheme && <span className="subtitle">Сейчас включена другая тема — переключите её в шапке, чтобы увидеть правки.</span>}
    </div>
    <div className="ui-presets">
      {presets.map((preset) => {
        const active = isPresetActive(appearance, preset);
        return (
          <div key={preset.id} className={`ui-preset${active ? ' active' : ''}`}>
            <button
              type="button"
              className="ui-preset-apply"
              aria-pressed={active}
              onClick={() => save({ [theme]: { ...preset.colors } } as Partial<AppearanceSettings>)}
            >
              <span className="ui-preset-dots" aria-hidden>
                {['paper', 'sheet', 'soft-2', 'accent'].map((name) => (
                  <i key={name} style={{ background: preset.colors[name] ?? COLOR_TOKENS.find((t) => t.name === name)![theme] }} />
                ))}
              </span>
              <span className="ui-preset-name">{preset.name}</span>
              <span className="ui-preset-kind">{preset.builtin ? 'готовая' : 'своя'}</span>
            </button>
            {!preset.builtin && (
              <button
                type="button"
                className="text-action"
                aria-label={`Удалить тему ${preset.name}`}
                onClick={() => save({ presets: appearance.presets.filter((item) => item.id !== preset.id) })}
              >
                удалить
              </button>
            )}
          </div>
        );
      })}
    </div>
    <div className="ui-save-preset">
      <TextInput
        value={presetName}
        maxLength={40}
        placeholder="Название темы"
        aria-label="Название новой темы"
        onChange={(e) => setPresetName(e.target.value)}
      />
      <Button
        disabled={!presetName.trim() || appearance.presets.length >= MAX_PRESETS}
        onClick={() => {
          save({
            presets: [
              ...appearance.presets,
              { id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: presetName.trim(), theme, colors: { ...appearance[theme] } },
            ],
          });
          setPresetName('');
        }}
      >
        Сохранить текущие цвета как тему
      </Button>
      {appearance.presets.length >= MAX_PRESETS && <span className="field-hint">Сохранено {MAX_PRESETS} тем — больше нельзя, удалите ненужные.</span>}
    </div>

    {COLOR_GROUPS.map((group) => (
      <section key={group.title} className="ui-group">
        <h4>{group.title}</h4>
        {group.hint && <p className="subtitle">{group.hint}</p>}
        <div className="ui-colors">
          {group.tokens.map((token) => (
            <ColorRow
              key={token.name}
              token={token}
              value={tokenValue(appearance, token, theme)}
              isDefault={appearance[theme][token.name] === undefined}
              onChange={(value) => setColor(token.name, value)}
              onReset={() => resetColor(token.name)}
            />
          ))}
        </div>
      </section>
    ))}
  </div>;
};

const DictionariesTab = ({ state, dispatch }: TabProps) => {
  const [dictionary, setDictionary] = useState<DictionaryKind>('taskCategory');
  const [editing, setEditing] = useState<DictionaryEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DictionaryEntry | null>(null);
  const info = DICTIONARIES.find((item) => item.value === dictionary)!;
  const withColor = dictionary === 'absenceType' || dictionary === 'taskCategory';
  const entries = useMemo(() => state.dictionaries.filter((entry) => entry.dictionary === dictionary).sort((a, b) => a.title.localeCompare(b.title, 'ru')), [state.dictionaries, dictionary]);
  return <div className="admin-grid">
    <aside className="admin-directory" aria-label="Справочники"><p className="caps">Справочники</p><div className="admin-directory-list" role="list">{DICTIONARIES.map((item) => <button key={item.value} type="button" role="listitem" aria-pressed={item.value === dictionary} onClick={() => { setDictionary(item.value); setEditing(null); }}><span>{item.label}</span><small className="num">{state.dictionaries.filter((entry) => entry.dictionary === item.value).length}</small></button>)}</div></aside>
    <div className="admin-content">
      <div className="card-head admin-content-head">
        <div><h2>{info.label}</h2><p className="subtitle">{info.hint}{dictionary === 'absenceType' ? ' Цвет задаёт полосы «Тетриса» и точки у фамилий.' : dictionary === 'taskCategory' ? ' Цвет задаёт карточки Календаря, точки категорий, фильтр и легенду.' : ''}</p></div>
        <div className="admin-users-actions"><span className="faint num">{entries.length} знач.</span><Button variant="primary" icon={<Icon.Plus size={15} />} onClick={() => setEditing('new')}>Добавить значение</Button></div>
      </div>
      <div className="table-scroll admin-table-wrap"><table className="admin-table"><caption className="sr-only">Значения справочника «{info.label}»</caption>
        <thead><tr><th scope="col">Название</th><th scope="col">Код</th>{withColor && <th scope="col">Цвет</th>}<th scope="col" className="admin-actions-head">Действие</th></tr></thead>
        <tbody>
          {entries.map((entry) => <tr key={entry.id}>
            <td><b>{entry.title}</b></td>
            <td><span className="num muted">{entry.code}</span></td>
            {withColor && <td>{entry.color ? <span className="num"><i className="admin-swatch" style={{ background: entry.color }} aria-hidden />{entry.color}</span> : <span className="num muted"><i className="admin-swatch" style={{ background: `var(--${dictionary === 'absenceType' ? 'abs' : 'cat'}-${entry.code})` }} aria-hidden />по умолчанию</span>}</td>}
            <td className="admin-icon-actions">
              <button type="button" className="admin-icon-action" onClick={() => setEditing(entry)} aria-label={`Изменить значение ${entry.title}`} data-tip="Изменить"><Icon.Edit size={15} /></button>
              <button type="button" className="admin-icon-action danger" onClick={() => setDeleting(entry)} aria-label={`Удалить значение ${entry.title}`} data-tip="Удалить"><Icon.Trash size={15} /></button>
            </td>
          </tr>)}
          {entries.length === 0 && <tr><td colSpan={withColor ? 4 : 3} className="admin-empty">Значений пока нет. Нажмите «Добавить значение».</td></tr>}
        </tbody>
      </table></div>
    </div>
    {editing && <DictionaryDialog entry={editing === 'new' ? undefined : editing} kind={dictionary} label={info.label} entries={entries} onClose={() => setEditing(null)} onSave={(draft) => { dispatch({ type: 'saveDictionary', draft }); setEditing(null); }} />}
    {deleting && <Dialog title="Удалить значение?" context={`${info.label} · ${deleting.title}`} onClose={() => setDeleting(null)}><div className="delete-user-dialog"><div className="delete-user-warning"><Icon.Trash size={18} /><div><strong>{deleting.title}</strong><p>Значение исчезнет из справочника. Отменить удаление после подтверждения нельзя.</p></div></div><div className="form-actions"><Button variant="danger" icon={<Icon.Trash size={15} />} onClick={() => { dispatch({ type: 'deleteDictionary', id: deleting.id }); setDeleting(null); }}>Удалить</Button><span className="spacer" /><Button onClick={() => setDeleting(null)}>Отмена</Button></div></div></Dialog>}
  </div>;
};

/** Форма значения справочника: код, название и — для видов отсутствий — цвет. */
const DictionaryDialog = ({ entry, kind, label, entries, onClose, onSave }: { entry?: DictionaryEntry; kind: DictionaryKind; label: string; entries: DictionaryEntry[]; onClose: () => void; onSave: (draft: { id?: string; dictionary: DictionaryKind; code: string; title: string; color?: string }) => void }) => {
  const [code, setCode] = useState(entry?.code ?? '');
  const [title, setTitle] = useState(entry?.title ?? '');
  // Без сохранённого цвета — текущий цвет вида по умолчанию, чтобы сохранение ничего не перекрасило.
  const [color, setColor] = useState(entry?.color ?? DEFAULT_DICTIONARIES.find((d) => d.dictionary === kind && d.code === entry?.code)?.color ?? '#8C816C');
  const [error, setError] = useState('');
  const withColor = kind === 'absenceType' || kind === 'taskCategory';
  const submit = () => {
    const c = code.trim();
    const t = title.trim();
    if (!c || !t) return setError('Заполните код и название.');
    if (entries.some((item) => item.id !== entry?.id && item.code.toLowerCase() === c.toLowerCase())) return setError('В этом справочнике такой код уже есть.');
    onSave({ ...(entry ? { id: entry.id } : {}), dictionary: kind, code: c, title: t, ...(withColor ? { color } : {}) });
  };
  return <Dialog title={entry ? 'Изменить значение' : 'Добавить значение'} context={entry ? `${label} · ${entry.title}` : label} onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
      <div className="field-row">
        <label className="field"><span className="caps">Название</span><TextInput value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} placeholder="Название значения" maxLength={160} invalid={!!error} /></label>
        <div className="field"><label className="caps" htmlFor="dict-code">Код</label><TextInput id="dict-code" value={code} onChange={(event) => { setCode(event.target.value); setError(''); }} placeholder="internal-review" maxLength={48} mono invalid={!!error} aria-describedby="dict-code-hint" /><span className="field-hint" id="dict-code-hint">Связывает значение с данными; меняйте осторожно.</span></div>
      </div>
      {withColor && <div className="field"><span className="caps">Цвет</span><ColorPicker value={color} onChange={(value) => { setColor(value); setError(''); }} label={kind === 'absenceType' ? 'Цвет вида отсутствия' : 'Цвет категории'} /><span className="field-hint">В тёмной теме цвет автоматически высветляется.</span></div>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><span className="spacer" /><Button type="submit" variant="primary" icon={<Icon.Save size={15} />}>{entry ? 'Сохранить' : 'Добавить'}</Button><Button onClick={onClose}>Отмена</Button></div>
    </form>
  </Dialog>;
};

const TemplatesTab = ({ state, dispatch }: TabProps) => {
  const [editing, setEditing] = useState<DocumentTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DocumentTemplate | null>(null);
  return <div className="admin-section">
    <div className="card-head admin-content-head">
      <div><h2>Шаблоны документов</h2><p className="subtitle">Текст с подстановками для кнопки «Документ»: в «Планировании» — по мероприятиям недели, в «Отчётности» — по отправленному отчёту.</p></div>
      <div className="admin-users-actions"><span className="faint num">{state.templates.length} шабл.</span><Button variant="primary" icon={<Icon.Plus size={15} />} onClick={() => setEditing('new')}>Добавить шаблон</Button></div>
    </div>
    <div className="table-scroll admin-table-wrap"><table className="admin-table"><caption className="sr-only">Шаблоны документов</caption>
      <thead><tr><th scope="col">Название</th><th scope="col">Раздел</th><th scope="col">Начало текста</th><th scope="col" className="admin-actions-head">Действие</th></tr></thead>
      <tbody>
        {state.templates.map((t) => <tr key={t.id}>
          <td><b>{t.name}</b></td>
          <td>{TEMPLATE_SCOPES.find((x) => x.value === t.scope)?.label}</td>
          <td><span className="num muted">{t.body.split('\n').find((l) => l.trim())?.slice(0, 60)}</span></td>
          <td className="admin-icon-actions">
            <button type="button" className="admin-icon-action" onClick={() => setEditing(t)} aria-label={`Изменить шаблон ${t.name}`} data-tip="Изменить"><Icon.Edit size={15} /></button>
            <button type="button" className="admin-icon-action danger" onClick={() => setDeleting(t)} aria-label={`Удалить шаблон ${t.name}`} data-tip="Удалить"><Icon.Trash size={15} /></button>
          </td>
        </tr>)}
        {state.templates.length === 0 && <tr><td colSpan={4} className="admin-empty">Шаблонов нет. Нажмите «Добавить шаблон».</td></tr>}
      </tbody>
    </table></div>
    {editing && <TemplateDialog template={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={(draft) => { dispatch({ type: 'saveTemplate', draft }); setEditing(null); }} />}
    {deleting && <Dialog title="Удалить шаблон?" context={deleting.name} onClose={() => setDeleting(null)}><div className="delete-user-dialog"><div className="delete-user-warning"><Icon.Trash size={18} /><div><strong>{deleting.name}</strong><p>Шаблон исчезнет из списка документов раздела «{TEMPLATE_SCOPES.find((x) => x.value === deleting.scope)?.label}». Отменить удаление после подтверждения нельзя.</p></div></div><div className="form-actions"><Button variant="danger" icon={<Icon.Trash size={15} />} onClick={() => { dispatch({ type: 'deleteTemplate', id: deleting.id }); setDeleting(null); }}>Удалить</Button><span className="spacer" /><Button onClick={() => setDeleting(null)}>Отмена</Button></div></div></Dialog>}
  </div>;
};

const defaultBody = (scope: TemplateScope) => DEFAULT_TEMPLATES.find((t) => t.scope === scope)?.body ?? '';

/**
 * Редактор шаблона: слева текст, справа — предпросмотр.
 * «Планирование» — мероприятия текущей недели всего отдела; «Отчётность» — последний отправленный отчёт.
 */
const TemplateDialog = ({ template, onClose, onSave }: { template?: DocumentTemplate; onClose: () => void; onSave: (draft: { id?: string; name: string; body: string; scope: TemplateScope }) => void }) => {
  const { state } = useStore();
  const [name, setName] = useState(template?.name ?? '');
  const [scope, setScope] = useState<TemplateScope>(template?.scope ?? 'planning');
  const [body, setBody] = useState(template?.body ?? defaultBody('planning'));
  const [error, setError] = useState('');
  const lastReport = useMemo(() => [...state.reports].sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0], [state.reports]);
  const reportWeek = lastReport ? new Date(`${lastReport.weekStart}T00:00:00`) : addDays(planWeekStart(new Date()), -7);
  const context = useMemo(() => {
    const planWeek = planWeekStart(new Date());
    if (scope === 'planning') return planDocContext(planItems(state.tasks, state.planRows, planWeek, state.users.map((u) => u.employeeId)), state.planRows, planWeek, state.user);
    return reportDocContext(lastReport, state.planRows, lastReport ? new Date(`${lastReport.weekStart}T00:00:00`) : addDays(planWeek, -7), state.user);
  }, [state.tasks, state.planRows, state.users, state.user, scope, lastReport]);
  const changeScope = (next: TemplateScope) => {
    // У нового шаблона текст по умолчанию меняется вместе с разделом, пока его не правили.
    if (!template && body === defaultBody(scope)) setBody(defaultBody(next));
    setScope(next);
  };
  const preview = useMemo(() => {
    try {
      return { text: renderTemplate(body, context), error: '' };
    } catch (e) {
      return { text: '', error: (e as Error).message };
    }
  }, [body, context]);
  const submit = () => {
    if (!name.trim() || !body.trim()) return setError('Заполните название и текст шаблона.');
    if (preview.error) return setError(`Шаблон содержит ошибку: ${preview.error}`);
    onSave({ ...(template ? { id: template.id } : {}), name: name.trim(), body, scope });
  };
  return <Dialog title={template ? 'Изменить шаблон' : 'Добавить шаблон'} context={template?.name ?? 'Новый шаблон документа'} onClose={onClose} wide>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
      <label className="field"><span className="caps">Название</span><TextInput value={name} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder="План мероприятий на неделю" maxLength={160} invalid={!!error && !name.trim()} /></label>
      <div className="field"><span className="caps">Раздел</span><Segmented<TemplateScope> label="Раздел шаблона" value={scope} options={TEMPLATE_SCOPES} onChange={changeScope} /></div>
      <div className="template-editor">
        <div className="field"><label className="caps" htmlFor="template-body">Текст шаблона</label><TextArea id="template-body" className="template-body" value={body} onChange={(event) => { setBody(event.target.value); setError(''); }} spellCheck={false} invalid={!!preview.error} /></div>
        <div className="field"><span className="caps">Предпросмотр — {scope === 'reports' ? (lastReport ? `отчёт за ${fmtRange(reportWeek, addDays(reportWeek, 6))}` : 'отчётов ещё нет') : 'текущая неделя'}</span>{preview.error ? <p className="field-error" role="alert">{preview.error}</p> : <pre className="doc-preview template-preview">{preview.text}</pre>}</div>
      </div>
      <details className="template-help"><summary>Подстановки</summary><dl>{placeholdersFor(scope).map((p) => <div key={p.tag}><dt><code>{p.tag}</code></dt><dd>{p.hint}</dd></div>)}</dl></details>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><span className="spacer" /><Button type="submit" variant="primary" icon={<Icon.Save size={15} />}>{template ? 'Сохранить' : 'Добавить'}</Button><Button onClick={onClose}>Отмена</Button></div>
    </form>
  </Dialog>;
};

const UnitsTab = ({ state, dispatch }: TabProps) => {
  const [editing, setEditing] = useState<{ unit?: Unit; parentId?: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = unitTree(state.units);
  // Сотрудники подразделения — вместе с вложенными.
  const staffIn = (id: string) => {
    const inside = unitWithDescendants(state.units, id);
    return state.users.filter((u) => inside.has(unitOf(u) ?? '')).length;
  };
  const hidden = (u: Unit) => unitPath(state.units, u.parentId ?? undefined).some((p) => collapsed.has(p.id));
  const toggle = (id: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const counts = UNIT_KINDS.map((k) => `${state.units.filter((u) => u.kind === k.kind).length} ${k.label.toLowerCase()}`).join(' · ');
  return <div className="admin-section">
    <div className="card-head admin-content-head">
      <div><h2>Подразделения</h2><p className="subtitle">Иерархия: организация → управление → отдел → отделение. Отделения основного отдела — группы в фильтрах «Планирования» и «Тетриса».</p></div>
      <div className="admin-users-actions"><span className="faint num">{counts}</span><Button variant="primary" icon={<Icon.Plus size={15} />} onClick={() => setEditing({ parentId: null })}>Добавить подразделение</Button></div>
    </div>
    <div className="table-scroll admin-table-wrap">
      <table className="admin-table admin-plan-table">
        <caption className="sr-only">Подразделения</caption>
        <thead><tr><th scope="col">Название</th><th scope="col">Уровень</th><th scope="col">Сотрудники</th><th scope="col" className="admin-actions-head">Действие</th></tr></thead>
        <tbody>{tree.filter(({ unit }) => !hidden(unit)).map(({ unit, depth }) => {
          const children = state.units.filter((u) => u.parentId === unit.id).length;
          const staff = staffIn(unit.id);
          const direct = state.users.filter((u) => unitOf(u) === unit.id).length;
          const open = !collapsed.has(unit.id);
          const childKind = UNIT_KINDS.find((k) => PARENT_KIND[k.kind] === unit.kind);
          return <tr key={unit.id} className={unit.kind !== 'section' ? 'admin-plan-section' : undefined}>
            <td>
              <div className="plan-tree" style={{ ['--depth' as string]: depth }}>
                {children > 0 ? (
                  <button type="button" className={`plan-tree-toggle${open ? ' open' : ''}`} aria-expanded={open} aria-label={`${open ? 'Свернуть' : 'Развернуть'} подразделение ${unit.name}`} onClick={() => toggle(unit.id)}><Icon.Chevron size={13} /></button>
                ) : <span className="plan-tree-spacer" aria-hidden />}
                {unit.kind === 'section' ? <span>{unit.name}</span> : <b>{unit.name}</b>}
              </div>
            </td>
            <td>{unitKindLabel(unit.kind)}</td>
            <td><span className="num">{staff}</span>{direct > 0 && direct !== staff && <span className="faint"> · {direct} напрямую</span>}</td>
            <td className="admin-icon-actions">
              {childKind && <button type="button" className="admin-icon-action" onClick={() => setEditing({ parentId: unit.id })} aria-label={`Добавить в «${unit.name}»: ${childKind.label.toLowerCase()}`} data-tip={`Добавить: ${childKind.label.toLowerCase()}`}><Icon.Plus size={15} /></button>}
              <button type="button" className="admin-icon-action" onClick={() => setEditing({ unit })} aria-label={`Изменить подразделение ${unit.name}`} data-tip="Изменить"><Icon.Edit size={15} /></button>
              <button type="button" className="admin-icon-action danger" disabled={children > 0 || direct > 0} onClick={() => setDeleting(unit)} aria-label={`Удалить подразделение ${unit.name}`} data-tip={children > 0 ? 'Сначала удалите вложенные подразделения' : direct > 0 ? 'В подразделении есть сотрудники' : 'Удалить'}><Icon.Trash size={15} /></button>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="help-note">Уровень задаёт место в иерархии: у управления родитель — организация, у отдела — управление, у отделения — отдел. Удалить можно только подразделение без вложенных и без сотрудников; сотрудников переводят в другое подразделение во вкладке «Пользователи».</p>
    {editing && <UnitDialog unit={editing.unit} parentId={editing.parentId} units={state.units} onClose={() => setEditing(null)} onSave={(draft) => { dispatch({ type: 'saveUnit', draft }); setEditing(null); }} />}
    {deleting && <Dialog title="Удалить подразделение?" context={`${unitKindLabel(deleting.kind)} · ${deleting.name}`} onClose={() => setDeleting(null)}><div className="delete-user-dialog"><div className="delete-user-warning"><Icon.Trash size={18} /><div><strong>{deleting.name}</strong><p>Подразделение исчезнет из структуры. Отменить удаление после подтверждения нельзя.</p></div></div><div className="form-actions"><Button variant="danger" icon={<Icon.Trash size={15} />} onClick={() => { dispatch({ type: 'deleteUnit', id: deleting.id }); setDeleting(null); }}>Удалить</Button><span className="spacer" /><Button onClick={() => setDeleting(null)}>Отмена</Button></div></div></Dialog>}
  </div>;
};

/** Форма подразделения: уровень, вышестоящее подразделение нужного уровня и название. */
const UnitDialog = ({ unit, parentId: initialParent = null, units, onClose, onSave }: { unit?: Unit; parentId?: string | null; units: Unit[]; onClose: () => void; onSave: (draft: { id?: string; parentId: string | null; kind: UnitKind; name: string }) => void }) => {
  const parentUnit = initialParent ? units.find((u) => u.id === initialParent) : undefined;
  const initialKind: UnitKind = unit?.kind ?? (parentUnit ? UNIT_KINDS.find((k) => PARENT_KIND[k.kind] === parentUnit.kind)?.kind ?? 'section' : 'organization');
  const [kind, setKind] = useState<UnitKind>(initialKind);
  const [parent, setParent] = useState<string | null>(unit ? unit.parentId : initialParent);
  const [name, setName] = useState(unit?.name ?? '');
  const [error, setError] = useState('');
  const hasChildren = !!unit && units.some((u) => u.parentId === unit.id);
  const parentKind = PARENT_KIND[kind];
  const parents = parentKind ? units.filter((u) => u.kind === parentKind) : [];
  const changeKind = (next: UnitKind) => {
    setKind(next);
    const pk = PARENT_KIND[next];
    const candidates = pk ? units.filter((u) => u.kind === pk) : [];
    setParent(pk ? (candidates.some((u) => u.id === parent) ? parent : candidates[0]?.id ?? null) : null);
    setError('');
  };
  const submit = () => {
    const n = name.trim();
    if (!n) return setError('Введите название подразделения.');
    if (parentKind && !parent) return setError(`Выберите вышестоящее подразделение: ${unitKindLabel(parentKind).toLowerCase()}.`);
    onSave({ ...(unit ? { id: unit.id } : {}), parentId: parentKind ? parent : null, kind, name: n });
  };
  return <Dialog title={unit ? 'Изменить подразделение' : 'Добавить подразделение'} context={unit ? `${unitKindLabel(unit.kind)} · ${unit.name}` : parentUnit ? `В «${parentUnit.name}»` : 'Новое подразделение'} onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
      <div className="field-row">
        <div className="field"><span className="caps">Уровень</span><Select<UnitKind> variant="light" label="Уровень подразделения" value={kind} disabled={hasChildren} options={UNIT_KINDS.map((k) => ({ value: k.kind, label: k.label }))} onChange={changeKind} />{hasChildren && <span className="field-hint">У подразделения есть вложенные — уровень не меняется.</span>}</div>
        {parentKind && <div className="field"><span className="caps">Вышестоящее: {unitKindLabel(parentKind).toLowerCase()}</span><Select<string> variant="light" label="Вышестоящее подразделение" value={parent ?? ''} options={parents.length ? parents.map((u) => ({ value: u.id, label: u.name })) : [{ value: '', label: `Сначала добавьте: ${unitKindLabel(parentKind).toLowerCase()}` }]} onChange={(v) => { setParent(v || null); setError(''); }} /></div>}
      </div>
      <label className="field"><span className="caps">Название</span><TextInput value={name} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder={kind === 'section' ? 'Отделение разработки' : kind === 'department' ? 'Отдел разработки' : kind === 'directorate' ? 'Управление информационных технологий' : 'Ведомство'} maxLength={200} invalid={!!error} /></label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><span className="spacer" /><Button type="submit" variant="primary" icon={<Icon.Save size={15} />}>{unit ? 'Сохранить' : 'Добавить'}</Button><Button onClick={onClose}>Отмена</Button></div>
    </form>
  </Dialog>;
};

/** Варианты выпадающего списка подразделений: деревом, с отступом по уровню. */
const unitOptions = (units: Unit[]) => [{ value: '', label: 'Не выбрано' }, ...unitTree(units).map(({ unit, depth }) => ({ value: unit.id, label: `${'   '.repeat(depth)}${unit.name}` }))];

/** Родитель позиции — код без последнего сегмента: «3.1.2» → «3.1». */
const parentOf = (id: string): string | null => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null);
const lastSegment = (id: string) => id.slice(id.lastIndexOf('.') + 1);
const depthOf = (id: string) => id.split('.').length - 1;
const isInside = (id: string, ancestor: string) => id === ancestor || id.startsWith(`${ancestor}.`);

/** Следующий свободный номер внутри родителя: после «3.1», «3.2» — «3». */
const nextNumber = (rows: PlanRow[], parent: string | null, except?: string): string => {
  const used = rows.filter((r) => parentOf(r.id) === parent && r.id !== except).map((r) => Number(lastSegment(r.id))).filter(Number.isFinite);
  return String(used.length ? Math.max(...used) + 1 : 1);
};

const PlanRowsTab = ({ state, dispatch }: TabProps) => {
  const [adding, setAdding] = useState<{ parent: string | null } | null>(null);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [deleting, setDeleting] = useState<PlanRow | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const usage = (row: PlanRow) => ({
    tasks: state.tasks.filter((task) => task.rowId === row.id).length,
    children: state.planRows.filter((item) => item.id.startsWith(`${row.id}.`)).length,
  });
  // Потомки свёрнутых разделов скрыты.
  const visible = state.planRows.filter((row) => ![...collapsed].some((c) => row.id.startsWith(`${c}.`)));
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sections = state.planRows.filter((row) => row.isHeader);
  return <div className="admin-section">
    <div className="card-head admin-content-head">
      <div><h2>Разделы планирования</h2><p className="subtitle">Разделы формируют иерархию плана, рабочие позиции используются в планировании задач и задают базовый вес.</p></div>
      <div className="admin-users-actions">
        <span className="faint num">{sections.length} разд. · {state.planRows.length - sections.length} поз.</span>
        <Button onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(sections.map((s) => s.id)))}>{collapsed.size ? 'Развернуть всё' : 'Свернуть всё'}</Button>
        <Button variant="primary" icon={<Icon.Plus size={15} />} onClick={() => setAdding({ parent: null })}>Добавить позицию</Button>
      </div>
    </div>
    <div className="table-scroll admin-table-wrap">
      <table className="admin-table admin-plan-table">
        <caption className="sr-only">Разделы планирования</caption>
        <thead><tr><th scope="col">Код</th><th scope="col">Название</th><th scope="col">Тип</th><th scope="col">Базовый вес</th><th scope="col">Задачи</th><th scope="col" className="admin-actions-head">Действие</th></tr></thead>
        <tbody>{visible.map((row) => {
          const linked = usage(row);
          const protectedRow = linked.tasks > 0 || linked.children > 0;
          const open = !collapsed.has(row.id);
          return <tr key={row.id} className={row.isHeader ? 'admin-plan-section' : undefined}>
            <td><span className="num">{row.id}</span></td>
            <td>
              <div className="plan-tree" style={{ ['--depth' as string]: depthOf(row.id) }}>
                {row.isHeader && linked.children > 0 ? (
                  <button type="button" className={`plan-tree-toggle${open ? ' open' : ''}`} aria-expanded={open} aria-label={`${open ? 'Свернуть' : 'Развернуть'} раздел ${row.id}`} onClick={() => toggle(row.id)}>
                    <Icon.Chevron size={13} />
                  </button>
                ) : <span className="plan-tree-spacer" aria-hidden />}
                {row.isHeader ? <b>{row.title}</b> : <span>{row.title}</span>}
                {row.isHeader && !open && <span className="faint num"> · {linked.children}</span>}
              </div>
            </td>
            <td>{row.isHeader ? 'Раздел' : 'Позиция'}</td>
            <td><span className="num">{row.isHeader ? '—' : row.baseScore}</span></td>
            <td><span className="num muted">{linked.tasks}</span></td>
            <td className="admin-icon-actions">
              {row.isHeader && <button type="button" className="admin-icon-action" onClick={() => setAdding({ parent: row.id })} aria-label={`Добавить позицию в раздел ${row.id} ${row.title}`} data-tip="Добавить вложенную позицию"><Icon.Plus size={15} /></button>}
              <button type="button" className="admin-icon-action" onClick={() => setEditing(row)} aria-label={`Редактировать позицию ${row.id} ${row.title}`} data-tip="Редактировать"><Icon.Edit size={15} /></button>
              <button type="button" className="admin-icon-action danger" disabled={protectedRow} onClick={() => setDeleting(row)} aria-label={`Удалить позицию ${row.id} ${row.title}`} data-tip={linked.tasks ? 'Позиция используется в задачах' : linked.children ? 'Сначала удалите вложенные позиции' : 'Удалить'}><Icon.Trash size={15} /></button>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="help-note">Родитель задаёт место позиции в иерархии, код собирается из кода родителя и номера. При переносе раздела вложенные позиции и связанные задачи переезжают вместе с ним. Позицию, связанную с задачами, нельзя удалить либо превратить в раздел.</p>
    {adding && <PlanRowDialog rows={state.planRows} parent={adding.parent} onClose={() => setAdding(null)} onSave={(draft) => { dispatch({ type: 'savePlanRow', draft }); setAdding(null); }} />}
    {editing && <PlanRowDialog row={editing} rows={state.planRows} linkedTasks={usage(editing).tasks} childCount={usage(editing).children} onClose={() => setEditing(null)} onSave={(draft) => { dispatch({ type: 'savePlanRow', draft }); setEditing(null); }} />}
    {deleting && <Dialog title="Удалить позицию плана?" context={`${deleting.id} · ${deleting.title}`} onClose={() => setDeleting(null)}><div className="delete-user-dialog"><div className="delete-user-warning"><Icon.Trash size={18} /><div><strong>{deleting.title}</strong><p>Позиция исчезнет из планирования. Отменить удаление после подтверждения нельзя.</p></div></div><div className="form-actions"><Button variant="danger" icon={<Icon.Trash size={15} />} onClick={() => { dispatch({ type: 'deletePlanRow', id: deleting.id }); setDeleting(null); }}>Удалить</Button><span className="spacer" /><Button onClick={() => setDeleting(null)}>Отмена</Button></div></div></Dialog>}
  </div>;
};

const ROOT = '__root__';

const PlanRowDialog = ({ row, rows, parent: initialParent = null, linkedTasks = 0, childCount = 0, onClose, onSave }: { row?: PlanRow; rows: PlanRow[]; parent?: string | null; linkedTasks?: number; childCount?: number; onClose: () => void; onSave: (draft: { originalId?: string; id: string; title: string; isHeader: boolean; baseScore: number }) => void }) => {
  const [parent, setParent] = useState<string | null>(row ? parentOf(row.id) : initialParent);
  const [number, setNumber] = useState(row ? lastSegment(row.id) : nextNumber(rows, initialParent));
  const [title, setTitle] = useState(row?.title ?? '');
  const [isHeader, setIsHeader] = useState(row?.isHeader ?? false);
  const [score, setScore] = useState(String(row?.isHeader ? 5 : (row?.baseScore ?? 5)));
  const [error, setError] = useState('');
  // Родителем может быть только раздел, и не сама позиция или её потомок.
  const parents = rows.filter((r) => r.isHeader && !(row && isInside(r.id, row.id)));
  const parentOptions = [{ value: ROOT, label: 'Верхний уровень плана' }, ...parents.map((r) => ({ value: r.id, label: `${'   '.repeat(depthOf(r.id))}${r.id}  ${r.title}` }))];
  const code = parent ? `${parent}.${number.trim()}` : number.trim();
  const changeParent = (value: string) => {
    const next = value === ROOT ? null : value;
    setParent(next);
    setNumber(row && next === parentOf(row.id) ? lastSegment(row.id) : nextNumber(rows, next, row?.id));
    setError('');
  };
  const submit = () => {
    const name = title.trim();
    const baseScore = Number(score.replace(',', '.'));
    if (!number.trim() || !name) return setError('Заполните номер и название позиции.');
    if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(number.trim())) return setError('Номер — буквы, цифры и дефис, без точек и пробелов.');
    if (rows.some((item) => item.id !== row?.id && item.id.toLocaleLowerCase('ru') === code.toLocaleLowerCase('ru'))) return setError(`Позиция с кодом ${code} уже существует.`);
    if (!isHeader && childCount > 0) return setError('У позиции есть вложенные — она должна оставаться разделом.');
    if (!isHeader && (!Number.isFinite(baseScore) || baseScore < 0.1 || baseScore > 15)) return setError('Базовый вес — число от 0,1 до 15.');
    onSave({ ...(row ? { originalId: row.id } : {}), id: code, title: name, isHeader, baseScore: isHeader ? 0 : baseScore });
  };
  return <Dialog title={row ? 'Редактировать позицию' : 'Добавить позицию'} context={row ? `${row.id} · ${row.title}` : 'Новая строка плана'} onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
      <div className="field"><span className="caps">Родитель</span><Select variant="light" label="Родитель" value={parent ?? ROOT} options={parentOptions} onChange={changeParent} /><span className="field-hint">Раздел плана, в который входит позиция.{row && childCount > 0 ? ` Вложенные позиции (${childCount}) переедут вместе с ней.` : ''}</span></div>
      <div className="field-row">
        <label className="field"><span className="caps">Номер в разделе</span><TextInput value={number} onChange={(event) => { setNumber(event.target.value); setError(''); }} placeholder="1" maxLength={12} mono invalid={!!error} /></label>
        <div className="field"><span className="caps">Код позиции</span><div className="plan-code num" aria-live="polite">{code || '—'}</div></div>
      </div>
      <label className="field"><span className="caps">Название</span><TextInput value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} placeholder="Название позиции плана" maxLength={200} invalid={!!error} /></label>
      <Checkbox checked={isHeader} disabled={linkedTasks > 0 || childCount > 0} onChange={(checked) => { setIsHeader(checked); setError(''); }}>{linkedTasks > 0 ? 'Позиция используется в задачах и должна оставаться рабочей' : childCount > 0 ? 'Раздел с вложенными позициями' : 'Это раздел плана (может содержать вложенные позиции)'}</Checkbox>
      {!isHeader && <label className="field"><span className="caps">Базовый вес</span><TextInput value={score} onChange={(event) => { setScore(event.target.value); setError(''); }} inputMode="decimal" placeholder="5" invalid={!!error} /><span className="field-hint">От 0,1 до 15 баллов за выполненную задачу.</span></label>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions"><span className="spacer" /><Button type="submit" variant="primary" icon={<Icon.Save size={15} />}>{row ? 'Сохранить' : 'Добавить'}</Button><Button onClick={onClose}>Отмена</Button></div>
    </form>
  </Dialog>;
};
