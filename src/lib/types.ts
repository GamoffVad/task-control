// Модель данных приложения «Контроль задач».

/** Администратор настраивает доступ, руководитель планирует, исполнитель ведёт свои задачи. */
export type Role = 'administrator' | 'manager' | 'executor';

export type Permission =
  | 'admin.access'
  | 'authentication.manage'
  | 'database.manage'
  | 'scoring.manage'
  | 'periods.manage'
  | 'users.manage'
  | 'units.manage'
  | 'roles.manage'
  | 'dictionaries.manage'
  | 'planRows.manage'
  | 'templates.manage'
  | 'appearance.manage'
  | 'reports.view'
  | 'tasks.plan'
  | 'tasks.execute'
  | 'tasks.score'
  | 'tasks.viewAll'
  | 'tasks.delete'
  | 'chat.moderate'
  | 'absences.manage'
  | 'absences.request'
  | 'entitlements.manage'
  | 'data.reset';

export type RoleDefinition = {
  role: Role;
  name: string;
  permissions: Permission[];
};

export type ManagedUser = {
  email: string;
  fullName: string;
  position: string;
  /** UPN or DOMAIN\\login supplied by a trusted Windows-auth proxy. */
  windowsLogin: string;
  employeeId: number;
  role: Role;
  active: boolean;
  /** Не показывать сотрудника в рабочих разделах; возможность входа определяется active. */
  hidden?: boolean;
  /** Индивидуальная ежегодная норма отпуска, календарных дней. */
  annualVacationDays?: number;
  /** Подразделение пользователя (обычно отделение или отдел). */
  unitId?: string;
};

/** Шаблон текстового документа (Администрирование → Шаблоны документов). */
/** Где используется шаблон документа: кнопка «Документ» в «Планировании» или в «Отчётности». */
export type TemplateScope = 'planning' | 'reports';

export type DocumentTemplate = { id: string; name: string; body: string; scope: TemplateScope };

/** Уровень подразделения: организация → управление → отдел → отделение. */
export type UnitKind = 'organization' | 'directorate' | 'department' | 'section';

export type Unit = {
  id: string;
  /** Вышестоящее подразделение; у организации — null. */
  parentId: string | null;
  kind: UnitKind;
  name: string;
  /** Руководство отдела: руководители этого отделения видят весь родительский отдел. */
  managesParent?: boolean;
};

export type DirectoryUser = {
  fullName: string;
  surname: string;
  givenName: string;
  patronymic: string;
  login: string;
  email: string;
  position: string;
};

export type AuthenticationMode = 'form' | 'windows';

export type AuthenticationSettings = {
  mode: AuthenticationMode;
  /** Allows an administrator to use the password form if Windows SSO is unavailable. */
  allowEmergencyForm: boolean;
};

/** Чем делится общий балл при расчёте среднего. */
export type ScoringAverageBase =
  /** Все сотрудники отдела, кроме исключённых. */
  | 'staff'
  /** Только действующие учётные записи. */
  | 'active'
  /** Только те, у кого есть баллы за период. */
  | 'withScore';

/**
 * Правила подсчёта баллов. Применяются при показе: изменение правила пересчитывает и прошлые периоды.
 * Вес самой записи отчёта остаётся замороженным на момент отправки.
 */
export type ScoringSettings = {
  /** Подразделения вне общей оценки — например, руководство. */
  excludedUnitIds: string[];
  /** Точечные исключения сотрудников. */
  excludedEmployeeIds: number[];
  averageBase: ScoringAverageBase;
  /** Показывать разрез по направлениям (отделениям). */
  byDirection: boolean;
};

/**
 * Оформление приложения: цвета по темам, шрифты и размеры текста.
 * Хранятся только отличия от дизайн-системы, поэтому её правки доходят до незаданных токенов.
 */
/** Сохранённый набор цветов одной темы — готовая или своя «цветовая тема». */
export type AppearancePreset = {
  id: string;
  name: string;
  /** К какой теме относится набор: светлой или тёмной. */
  theme: 'light' | 'dark';
  /** Цвета набора: имя переменной CSS без «--» → #RRGGBB. */
  colors: Record<string, string>;
};

export type AppearanceSettings = {
  /** Переопределённые цвета светлой темы: имя переменной CSS без «--» → #RRGGBB. */
  light: Record<string, string>;
  dark: Record<string, string>;
  /** Свои сохранённые наборы цветов; готовые приходят из кода. */
  presets: AppearancePreset[];
  fontBody: string;
  fontMono: string;
  sizes: { base: number; heading: number; caps: number; subtitle: number };
  /** Личный порядок разделов навбара в этом браузере. */
  navOrder: string[];
};

/** Категория мероприятия — определяет цвет в календаре. */
/**
 * Категория мероприятия — код значения справочника «Категории задач» (Администрирование → Словари).
 * Список живой: см. syncCategories в data.ts. Пустая категория (null) показывается как «Иное».
 */
export type Category = string;

export type Employee = {
  id: number;
  role: Role;
  lastname: string;
  name: string;
  patronymic: string;
  position: string;
};

export type Group = {
  id: string;
  name: string;
  employeeIds: number[];
};

export type Department = {
  id: string;
  name: string;
  groups: Group[];
};

/** Строка плана: раздел (заголовок) или плановая позиция с весом в баллах. */
export type PlanRow = {
  id: string;
  title: string;
  isHeader: boolean;
  baseScore: number;
};

/** Единая задача: одна и та же запись видна в Календаре, Планировании и Контроле. */
export type Task = {
  id: string;
  title: string;
  rowId: string | null;
  category: Category | null;
  assigneeIds: number[];
  /** ISO-дата начала. */
  start: string;
  /** ISO-дата окончания — это же срок исполнения. */
  end: string;
  docName: string;
  docNumber: string;
  result: string;
  done: boolean;
  /** Баллы за исполнение; null — базовый вес позиции плана. */
  score: number | null;
  /** ISO-дата отметки об исполнении. */
  doneAt: string | null;
};

/** Запись отчёта — снимок исполненной задачи с баллами на момент отправки. */
export type ReportEntry = {
  taskId: string;
  rowId: string;
  rowTitle: string;
  assigneeId: number;
  title: string;
  deadline: string;
  result: string;
  docName: string;
  docNumber: string;
  score: number;
  doneAt: string;
};

export type Report = {
  /** Начало отчётного периода, YYYY-MM-DD. */
  weekStart: string;
  /** Последний день включительно; у старых отчётов — начало + 6 дней. */
  periodEnd?: string;
  submittedAt: string;
  entries: ReportEntry[];
};

export type Message = {
  id: string;
  authorId: number;
  text: string;
  sentAt: string;
};

/**
 * Уведомление сотрудникам: сервер записывает его при событии, открытая вкладка приложения
 * забирает свои уведомления и показывает их средствами Chrome. Хранится неделю; клиенту целиком не передаётся.
 */
export type Notice = {
  id: string;
  /** Момент события (ISO). */
  at: string;
  /** Получатели — сотрудники (employeeId). */
  to: number[];
  title: string;
  body: string;
  /** Страница приложения, которая откроется по нажатию. */
  url: string;
};

/** До какого момента сотрудник прочитал «Переписку» — по ней считаются непрочитанные сообщения. */
export type ChatRead = {
  employeeId: number;
  readAt: string;
};

export type User = {
  email: string;
  employeeId: number;
  role: Role;
  permissions?: Permission[];
};

/** Вид отсутствия. */
/** Код из справочника видов событий; системные коды определяют правила расчёта. */
export type AbsenceType = string;

/** Заявка ждёт решения руководителя; отклонённая не учитывается в графике и остатках. */
export type AbsenceStatus = 'request' | 'approved' | 'rejected';

export type Absence = {
  id: string;
  employeeId: number;
  type: AbsenceType;
  /** Код из справочника типов отпусков; только для type = vacation. */
  vacationType?: string;
  /** Код из справочника видов дежурств; только для type = duty. */
  dutyType?: string;
  /** Дни дороги внутри дат отсутствия: в начале и в конце отпуска. */
  travelDaysBefore?: number;
  travelDaysAfter?: number;
  /** Первый день, YYYY-MM-DD. */
  from: string;
  /** Последний день включительно; null — больничный без известной даты окончания. */
  to: string | null;
  status: AbsenceStatus;
  note: string;
  decidedBy: number | null;
  createdAt: string;
};

/** Годовые нормы сотрудника; остатки вычисляются из норм и отсутствий. */
export type Entitlement = {
  employeeId: number;
  year: number;
  /** Право на ежегодный отпуск, календарных дней. */
  vacationDays: number;
  /** Перенесено с прошлого года. */
  carriedOver: number;
  /** Накоплено отгулов за переработку, рабочих дней. */
  dayoffAccrued: number;
};

/** Первый день нового отпускного периода; ежегодно, без удаления истории. */
export type VacationSettings = { resetMonth: number; resetDay: number };

/** Дни недели: 0 — воскресенье, 1 — понедельник, …, 6 — суббота. */
export type WeeklyPeriod = { startDay: number; endDay: number };
export type PeriodSettings = { planning: WeeklyPeriod; reporting: WeeklyPeriod };

/** Редактируемое значение одного из системных справочников. */
export type DictionaryKind = 'taskCategory' | 'absenceType' | 'taskStatus' | 'vacationType' | 'dutyType';

export type DictionaryEntry = {
  id: string;
  dictionary: DictionaryKind;
  code: string;
  title: string;
  /** Цвет значения (#RRGGBB): виды отсутствий — полосы «Тетриса», точки у фамилий; категории задач — карточки Календаря. */
  color?: string;
};

export type AppState = {
  version: 5;
  tasks: Task[];
  reports: Report[];
  messages: Message[];
  chatReads: ChatRead[];
  absences: Absence[];
  entitlements: Entitlement[];
  vacationSettings?: VacationSettings;
  periodSettings?: PeriodSettings;
  planRows: PlanRow[];
  dictionaries: DictionaryEntry[];
  users: ManagedUser[];
  roles: RoleDefinition[];
  units: Unit[];
  templates: DocumentTemplate[];
  authentication: AuthenticationSettings;
  scoring: ScoringSettings;
  appearance: AppearanceSettings;
  user: User | null;
};

/** Данные, которые хранятся в базе (без сеанса пользователя). */
/** Серверные данные. planRows optional только для миграции хранилищ старых версий. */
export type Data = Omit<AppState, 'version' | 'user' | 'planRows' | 'units' | 'templates' | 'chatReads' | 'scoring' | 'appearance'> & {
  planRows?: PlanRow[];
  units?: Unit[];
  templates?: DocumentTemplate[];
  chatReads?: ChatRead[];
  /** Правила подсчёта баллов; отсутствуют в базах прежних версий. */
  scoring?: ScoringSettings;
  /**
   * Версия набора прав в этих данных. Отличается от текущей — администратору дописываются
   * права, добавленные после выпуска базы. SQL Server держит ту же отметку в tc_meta.
   */
  accessVersion?: string;
  /** Журнал уведомлений — только на сервере. */
  notices?: Notice[];
};

export type CalendarView = 'day' | 'week' | 'month';

export type Period = 'all' | 'month' | 'quarter' | 'half' | 'year';

export type DeadlineBucket = 'overdue' | 'today' | 'week' | 'nextWeek' | 'month' | 'quarter' | 'later';
