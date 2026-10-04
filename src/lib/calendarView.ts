// Выбранный вид календаря запоминается в браузере отдельно для каждого сотрудника.
import type { CalendarView } from './types';

export const DEFAULT_CALENDAR_VIEW: CalendarView = 'week';

const keyOf = (employeeId?: number | null) => (employeeId == null ? 'task-control:calendar-view' : `task-control:calendar-view:${employeeId}`);

/** Допустимое значение вида; прежняя «Рабочая неделя» заменена на «Неделю». */
export const normalizeCalendarView = (value: unknown): CalendarView =>
  value === 'day' || value === 'week' || value === 'month' ? value : DEFAULT_CALENDAR_VIEW;

export const loadCalendarView = (employeeId?: number | null): CalendarView => {
  try {
    return normalizeCalendarView(localStorage.getItem(keyOf(employeeId)));
  } catch {
    return DEFAULT_CALENDAR_VIEW;
  }
};

export const storeCalendarView = (view: CalendarView, employeeId?: number | null): void => {
  try {
    localStorage.setItem(keyOf(employeeId), view);
  } catch {
    // Хранилище браузера недоступно — вид просто не запомнится.
  }
};
