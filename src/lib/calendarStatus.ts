/** Фильтр календаря хранится в браузере отдельно для каждого сотрудника. */
export type CalendarTaskStatus = 'all' | 'active' | 'done';

const keyOf = (employeeId?: number | null) => employeeId == null ? 'task-control:calendar-status' : `task-control:calendar-status:${employeeId}`;

export const loadCalendarStatus = (employeeId?: number | null): CalendarTaskStatus => {
  try {
    const value = localStorage.getItem(keyOf(employeeId));
    return value === 'active' || value === 'done' ? value : 'all';
  } catch {
    return 'all';
  }
};

export const storeCalendarStatus = (status: CalendarTaskStatus, employeeId?: number | null): void => {
  try {
    localStorage.setItem(keyOf(employeeId), status);
  } catch {
    // При недоступном хранилище фильтр продолжает работать до закрытия страницы.
  }
};
