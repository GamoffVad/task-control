import type { AppState } from './types';

/** Представление рабочих разделов. Исходные данные и учётные записи сохраняются для входа и администрирования. */
export const displayState = (state: AppState): AppState => {
  const hidden = new Set(state.users.filter((user) => user.hidden).map((user) => user.employeeId));
  if (!hidden.size) return state;
  return {
    ...state,
    users: state.users.filter((user) => !hidden.has(user.employeeId)),
    tasks: state.tasks.flatMap((task) => {
      const assigneeIds = task.assigneeIds.filter((id) => !hidden.has(id));
      return !assigneeIds.length ? [] : [assigneeIds.length === task.assigneeIds.length ? task : { ...task, assigneeIds }];
    }),
    reports: state.reports.map((report) => ({ ...report, entries: report.entries.filter((entry) => !hidden.has(entry.assigneeId)) })),
    absences: state.absences.filter((absence) => !hidden.has(absence.employeeId)).map((absence) =>
      absence.decidedBy !== null && hidden.has(absence.decidedBy) ? { ...absence, decidedBy: null } : absence),
    entitlements: state.entitlements.filter((entry) => !hidden.has(entry.employeeId)),
    messages: state.messages.filter((message) => !hidden.has(message.authorId)),
  };
};
