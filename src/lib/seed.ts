// Демонстрационные данные, построенные относительно текущей даты.
import { employees, isCoreEmployee, planRows } from './data';
import { DEFAULT_AUTHENTICATION, DEFAULT_ROLES, DEFAULT_SCORING, DEFAULT_USERS } from './access';
import { normalizeAppearance } from './appearance';
import { STAFF_USERS } from './staff';
import { DEFAULT_UNITS } from './units';
import { DEFAULT_TEMPLATES } from './templates';
import { addDays, planWeekStart, startOfDay, startOfWeek, toDateKey } from './dates';
import { buildReportEntries } from './logic';
import type { Absence, AbsenceStatus, AbsenceType, AppState, Category, DictionaryEntry, Entitlement, Message, Report, ReportEntry, Task } from './types';

export const DEFAULT_DICTIONARIES: DictionaryEntry[] = [
  { id: 'dict-cat-dept', dictionary: 'taskCategory', code: 'reportDept', title: 'Доклад руководству отдела', color: '#2F5480' },
  { id: 'dict-cat-directorate', dictionary: 'taskCategory', code: 'reportDirectorate', title: 'Доклад руководству управления и службы', color: '#6A4C93' },
  { id: 'dict-cat-agency', dictionary: 'taskCategory', code: 'reportAgency', title: 'Доклад руководству ведомства', color: '#983A6E' },
  { id: 'dict-cat-interim', dictionary: 'taskCategory', code: 'interim', title: 'Промежуточный контроль', color: '#1E7268' },
  { id: 'dict-absence-vacation', dictionary: 'absenceType', code: 'vacation', title: 'Отпуск', color: '#9A6B12' },
  { id: 'dict-absence-trip', dictionary: 'absenceType', code: 'trip', title: 'Командировка', color: '#2F5480' },
  { id: 'dict-absence-dayoff', dictionary: 'absenceType', code: 'dayoff', title: 'Отгул', color: '#6A4C93' },
  { id: 'dict-absence-sick', dictionary: 'absenceType', code: 'sick', title: 'Больничный', color: '#983A6E' },
  { id: 'dict-absence-study', dictionary: 'absenceType', code: 'study', title: 'Учёба', color: '#1E7268' },
  { id: 'dict-status-planned', dictionary: 'taskStatus', code: 'planned', title: 'В работе' },
  { id: 'dict-status-done', dictionary: 'taskStatus', code: 'done', title: 'Выполнено' },
];

type SeedTask = [
  title: string,
  rowId: string | null,
  assignees: number[],
  dayOffset: number,
  startHour: number,
  durationHours: number,
  done: boolean,
  result?: string,
  doc?: [string, string],
  category?: Category,
];

const at = (base: Date, dayOffset: number, hour: number): Date => {
  const d = addDays(base, dayOffset);
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d;
};

export const createSeed = (now: Date = new Date()): AppState => {
  const monday = startOfWeek(now);
  const seeds: SeedTask[] = [
    // Прошлая неделя
    ['Внести документы в журнал регистрации', '4.1', [7], -5, 9, 1, true, 'Документы внесены, проверены и подписаны', ['Журнал регистрации', 'ЖР-2026']],
    ['Доклад начальнику отдела о ходе внедрения', '1.1', [3], -6, 16, 1, true, 'Доклад сделан, замечаний нет', undefined, 'reportDept'],
    ['Подготовить сводку обращений за месяц', '3.4.1', [6], -4, 10, 2, true, 'Сводка направлена руководству'],
    ['Обновить антивирусные базы на серверах', '3.5', [4], -4, 14, 1, true, 'Базы обновлены на 12 серверах'],
    ['Согласовать график отпусков', '1.3', [2], -3, 11, 1, false],
    ['Проверить резервные копии баз данных', '3.6', [3], -2, 15, 2, false],
    // Текущая неделя
    ['Провести планёрку и утвердить показатели', '1.2', [1, 2], 0, 10, 1, true, 'Планёрка проведена, показатели утверждены', ['Протокол совещания', 'ПР-37'], 'reportDept'],
    ['Подготовить отчёт по редизайну портала', '1.1', [1], 1, 16.5, 2, false, '', ['ТЗ на редизайн', 'ТЗ-2026-001'], 'reportDirectorate'],
    ['Согласовать бюджет и обновить смету', '2.1', [2], 2, 11, 1, false, '', undefined, 'reportDirectorate'],
    ['Промежуточный контроль готовности модуля отчётов', '3.1.2', [4], 3, 9, 1, false, '', undefined, 'interim'],
    ['Анализ конкурентов и сбор данных', '1.1', [5], 3, 14, 2, false, '', ['Аналитическая справка', 'АС-05']],
    ['Сборка модуля авторизации', '3.1.1', [3], 0, 9, 3, true, 'Модуль собран и передан на тестирование'],
    ['Исправить ошибки в модуле отчётов', '3.1.2', [4], 1, 13, 3, false],
    ['Провести обучение по новой форме заявки', '3.4.2', [6], 2, 15, 1.5, false],
    ['Поставить на контроль поручения директора', '4.2', [7], 1, 9.5, 1, true, 'Поручения внесены в реестр контроля'],
    ['Подготовить техническое задание на модуль 3', '3.3.1', [5], 0, 11, 2, true, 'ТЗ согласовано с заказчиком', ['Техническое задание', 'ТЗ-2026-014']],
    ['Замена рабочих мест в бухгалтерии', '3.7.3', [4], 4, 10, 4, false],
    ['Доклад руководству ведомства об итогах квартала', '1.1', [1, 2], 4, 15, 1.5, false, '', ['Справка-доклад', 'СД-12'], 'reportAgency'],
    ['Созвон с подрядчиком по сетевому оборудованию', null, [2, 3], 3, 12, 1, false],
    // Следующая неделя и дальше
    ['Подготовить заявку на закупку серверов', '2.2', [2], 8, 10, 2, false],
    ['Внедрение этапа 1 в отделе кадров', '3.2.1', [3, 5], 9, 9, 6, false],
    ['Промежуточный контроль внедрения этапа 1', '3.2.1', [3], 10, 11, 1, false, '', undefined, 'interim'],
    ['Обновить руководство пользователя', '3.3.2', [7], 10, 14, 3, false],
    ['Модернизация коммутаторов на 3 этаже', '3.7.2', [4], 16, 10, 5, false],
    ['Квартальный аналитический отчёт', '1.1', [1], 20, 12, 3, false, '', undefined, 'reportAgency'],
    ['Закрыть журнал регистрации за неделю', '4.1', [7], 3, 16, 1, false],
  ];

  const tasks: Task[] = seeds.map(([title, rowId, assigneeIds, day, hour, dur, done, result = '', doc, category], i) => {
    const start = at(monday, day, hour);
    const end = new Date(start.getTime() + dur * 3600_000);
    return {
      id: `seed-${i + 1}`,
      title,
      rowId,
      category: category ?? null,
      assigneeIds,
      start: start.toISOString(),
      end: end.toISOString(),
      docName: doc?.[0] ?? '',
      docNumber: doc?.[1] ?? '',
      result,
      done,
      score: null,
      doneAt: done ? end.toISOString() : null,
    };
  });

  const lastWeek = addDays(planWeekStart(now), -7);
  const lastReport: Report = {
    weekStart: toDateKey(lastWeek),
    submittedAt: addDays(lastWeek, 7).toISOString(),
    entries: buildReportEntries({ tasks }, lastWeek),
  };

  return {
    version: 5,
    tasks,
    reports: [...createSeedReports(now), lastReport],
    messages: createSeedMessages(now),
    chatReads: [],
    absences: createSeedAbsences(now),
    entitlements: createSeedEntitlements(now),
    planRows: planRows.map((row) => ({ ...row })),
    dictionaries: DEFAULT_DICTIONARIES,
    users: DEFAULT_USERS,
    roles: DEFAULT_ROLES,
    units: DEFAULT_UNITS.map((u) => ({ ...u })),
    templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    authentication: { ...DEFAULT_AUTHENTICATION },
    scoring: { ...DEFAULT_SCORING },
    appearance: normalizeAppearance(undefined),
    user: null,
  };
};

/** Отчёты за 20 прошедших недель, чтобы показатели эффективности были не пустыми. */
const createSeedReports = (now: Date): Report[] => {
  const scoringRows = planRows.filter((r) => !r.isHeader);
  const reports: Report[] = [];
  const thisWeek = planWeekStart(now);
  for (let w = 20; w >= 2; w--) {
    const weekStart = addDays(thisWeek, -7 * w);
    const entries: ReportEntry[] = [];
    for (const e of employees.filter((x) => isCoreEmployee(x.id))) {
      // Детерминированный «разброс»: у разных сотрудников разное число задач.
      const count = ((e.id * 7 + w * 3) % 4) + (e.id <= 3 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const r = scoringRows[(e.id * 5 + w * 11 + k * 7) % scoringRows.length];
        const doneAt = addDays(weekStart, 1 + ((k + e.id) % 5));
        doneAt.setHours(17, 0, 0, 0);
        entries.push({
          taskId: `hist-${w}-${e.id}-${k}`,
          rowId: r.id,
          rowTitle: r.title,
          assigneeId: e.id,
          title: `${r.title}: работы недели`,
          deadline: doneAt.toISOString(),
          result: 'Выполнено в срок',
          docName: '',
          docNumber: '',
          score: r.baseScore,
          doneAt: doneAt.toISOString(),
        });
      }
    }
    reports.push({ weekStart: toDateKey(weekStart), submittedAt: addDays(weekStart, 7).toISOString(), entries });
  }
  return reports;
};

const createSeedMessages = (now: Date): Message[] => {
  const d = startOfDay(now);
  const m = (id: string, authorId: number, dayOffset: number, hour: number, text: string): Message => ({
    id,
    authorId,
    sentAt: at(d, dayOffset, hour).toISOString(),
    text,
  });
  return [
    m('m1', 2, -1, 9.25, 'Коллеги, смета по серверам будет готова к среде. Прошу прислать замечания заранее.'),
    m('m2', 7, -1, 9.75, 'Журнал регистрации за прошлую неделю закрыт, все документы подписаны.'),
    m('m3', 3, -1, 11.5, 'Модуль авторизации собран, передаю на тестирование Кузнецову.'),
    m('m4', 4, 0, 8.9, 'Принял. Результаты тестирования отправлю до конца дня.'),
  ];
};

type SeedAbsence = [employeeId: number, type: AbsenceType, from: number, to: number | null, status: AbsenceStatus, note: string];

/** Отсутствия вокруг текущей недели (смещения в днях от понедельника) и летние отпуска текущего года. */
const createSeedAbsences = (now: Date): Absence[] => {
  const monday = startOfWeek(now);
  const key = (d: number) => toDateKey(addDays(monday, d));
  const year = now.getFullYear();
  const near: SeedAbsence[] = [
    [2, 'vacation', 0, 11, 'approved', 'Ежегодный отпуск, вторая часть'],
    [1, 'trip', 19, 21, 'approved', 'Совещание в ведомстве'],
    [3, 'vacation', 7, 11, 'request', 'Заявка на отпуск'],
    [3, 'dayoff', -10, -10, 'approved', 'За работу в выходной день'],
    [4, 'sick', -11, -7, 'approved', 'Лист нетрудоспособности № 9102'],
    [5, 'study', -6, -4, 'approved', 'Курсы по информационной безопасности'],
    [5, 'vacation', 14, 25, 'request', 'Заявка на отпуск'],
    [6, 'trip', -17, -15, 'approved', 'Филиал, установка ПО'],
    [7, 'sick', 2, null, 'approved', 'Больничный открыт, дата закрытия не известна'],
  ];
  const summer: [number, number][] = [[1, 14], [2, 16], [3, 14], [4, 7], [5, 10], [6, 4], [7, 21]];
  const created = addDays(monday, -30).toISOString();
  const list: Absence[] = near.map(([employeeId, type, from, to, status, note], i) => ({
    id: `seed-abs-${i + 1}`,
    employeeId,
    type,
    from: key(from),
    to: to === null ? null : key(to),
    status,
    note,
    decidedBy: status === 'approved' ? 1 : null,
    createdAt: created,
  }));
  for (const [employeeId, days] of summer) {
    const from = new Date(year, 6, 6 + employeeId * 3);
    list.push({
      id: `seed-abs-summer-${employeeId}`,
      employeeId,
      type: 'vacation',
      from: toDateKey(from),
      to: toDateKey(addDays(from, days - 1)),
      status: 'approved',
      note: 'Ежегодный отпуск, первая часть',
      decidedBy: 1,
      createdAt: new Date(year, 3, 1).toISOString(),
    });
  }
  return [...list, ...testStaffAbsences(now)];
};

/**
 * Отсутствия тестовых сотрудников: у каждого отпуск рядом с текущей неделей и летний отпуск,
 * у части — командировки, отгулы, больничные и заявки. Разброс детерминированный, без случайных чисел.
 */
const testStaffAbsences = (now: Date): Absence[] => {
  const monday = startOfWeek(now);
  const year = now.getFullYear();
  const created = addDays(monday, -30).toISOString();
  const list: Absence[] = [];
  const add = (employeeId: number, type: AbsenceType, from: Date, to: Date | null, status: AbsenceStatus, note: string) => {
    // Отсутствия одного сотрудника не пересекаются — пересекающееся пропускаем.
    const f = toDateKey(from);
    const t = to ? toDateKey(to) : '9999-12-31';
    if (list.some((a) => a.employeeId === employeeId && a.from <= t && (a.to ?? '9999-12-31') >= f)) return;
    list.push({
      id: `seed-abs-t${employeeId}-${list.length}`,
      employeeId,
      type,
      from: toDateKey(from),
      to: to ? toDateKey(to) : null,
      status,
      note,
      decidedBy: status === 'approved' ? 1 : null,
      createdAt: created,
    });
  };
  STAFF_USERS.map((u) => ({ id: u.employeeId })).forEach((e, i) => {
    const start = addDays(monday, ((i * 17) % 84) - 35);
    const len = 5 + ((i * 7) % 10);
    add(e.id, 'vacation', start, addDays(start, len - 1), i % 9 === 4 ? 'request' : 'approved', i % 9 === 4 ? 'Заявка на отпуск' : 'Ежегодный отпуск');
    const summer = new Date(year, 5 + (i % 3), 1 + ((i * 5) % 20));
    add(e.id, 'vacation', summer, addDays(summer, 9 + (i % 5)), 'approved', 'Ежегодный отпуск, первая часть');
    if (i % 4 === 1) {
      const trip = addDays(monday, ((i * 11) % 42) - 14);
      add(e.id, 'trip', trip, addDays(trip, 1 + (i % 3)), 'approved', 'Командировка в филиал');
    }
    if (i % 6 === 2) {
      const sick = addDays(monday, ((i * 13) % 28) - 20);
      add(e.id, 'sick', sick, addDays(sick, 3 + (i % 4)), 'approved', 'Лист нетрудоспособности');
    }
    if (i % 5 === 3) {
      let off = addDays(monday, ((i * 3) % 20) - 6);
      // Отгул считается в рабочих днях — с выходного переносим на понедельник.
      while (off.getDay() === 0 || off.getDay() === 6) off = addDays(off, 1);
      add(e.id, 'dayoff', off, off, 'approved', 'За работу в выходной день');
    }
    if (i % 10 === 7) {
      const study = addDays(monday, ((i * 5) % 30) - 5);
      add(e.id, 'study', study, addDays(study, 2), 'approved', 'Курсы повышения квалификации');
    }
  });
  return list;
};

/** Нормы на текущий год: [перенесено дней отпуска, накоплено отгулов]. */
const createSeedEntitlements = (now: Date): Entitlement[] => {
  const year = now.getFullYear();
  const extra: Record<number, [number, number]> = { 1: [3, 2], 2: [4, 5], 3: [0, 2], 4: [0, 0], 5: [2, 2], 6: [0, 0], 7: [0, 4] };
  return employees.map((e) => ({
    employeeId: e.id,
    year,
    vacationDays: 28,
    carriedOver: extra[e.id]?.[0] ?? 0,
    // У тестовых сотрудников по 2 накопленных отгула, чтобы остаток не уходил в минус.
    dayoffAccrued: extra[e.id]?.[1] ?? 2,
  }));
};
