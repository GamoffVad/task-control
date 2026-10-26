import { addDays, fromDateKey } from './dates';
import type { Absence, Task } from './types';

export type TripTask = Pick<Task, 'assigneeIds' | 'start' | 'end' | 'tripAbsenceIds'>;

/** Связь исключает конфликт только для конкретной активной поездки и её исполнителя.
 * Задача должна целиком помещаться в поездку, включая последний день. */
export const linkedTripCoversTask = (task: TripTask, trip: Absence, absences?: Absence[]): boolean =>
  !!task.tripAbsenceIds?.includes(trip.id) && trip.type === 'trip' && trip.status !== 'rejected' && !!trip.to
  && task.assigneeIds.includes(trip.employeeId)
  && (!absences || absences.filter((item) => task.tripAbsenceIds?.includes(item.id) && item.employeeId === trip.employeeId && item.type === 'trip' && item.status !== 'rejected').length === 1)
  && new Date(task.start) >= fromDateKey(trip.from)
  && new Date(task.end) <= addDays(fromDateKey(trip.to), 1);

/** Новые ссылки проверяются; старые недоступные ссылки остаются для явного предупреждения.
 * Поэтому удаление поездки не превращает обычное сохранение результата задачи в ошибку. */
export const tripLinksError = (task: TripTask, absences: Absence[], previous: string[] = []): string | undefined => {
  const ids = task.tripAbsenceIds ?? [];
  if (!Array.isArray(ids) || ids.length > 20 || ids.some((id) => typeof id !== 'string' || !id || id.length > 100) || new Set(ids).size !== ids.length) return 'Некорректные связи с командировками.';
  const people = new Map<number, string>();
  for (const id of ids) {
    const trip = absences.find((item) => item.id === id);
    if (trip && task.assigneeIds.includes(trip.employeeId)) {
      const other = people.get(trip.employeeId);
      if (other && (!previous.includes(id) || !previous.includes(other))) return 'Выберите одну командировку для каждого исполнителя.';
      people.set(trip.employeeId, id);
    }
    if (previous.includes(id)) continue;
    if (!trip || trip.type !== 'trip' || trip.status === 'rejected' || !task.assigneeIds.includes(trip.employeeId)) return 'Командировка недоступна или не относится к исполнителю задачи.';
  }
};

export const taskTripWarnings = (task: TripTask, absences: Absence[]): string[] => {
  const linked = absences.filter((trip) => task.tripAbsenceIds?.includes(trip.id) && trip.type === 'trip' && trip.status !== 'rejected');
  const duplicate = new Set(linked.map((trip) => trip.employeeId)).size < linked.length;
  return [
    ...(duplicate ? ['У исполнителя связаны несколько командировок. Оставьте одну поездку для каждого сотрудника.'] : []),
    ...(task.tripAbsenceIds ?? []).flatMap((id) => {
      const trip = absences.find((item) => item.id === id);
      if (!trip) return ['Связанная командировка удалена или недоступна. Выберите другую или уберите связь.'];
      if (trip.type !== 'trip') return ['Связанное событие больше не является командировкой. Проверьте связь.'];
      if (trip.status === 'rejected') return ['Связанная командировка отклонена. Проверьте связь.'];
      if (!task.assigneeIds.includes(trip.employeeId)) return ['Сотрудник связанной командировки больше не является исполнителем задачи.'];
      if (!linkedTripCoversTask(task, trip)) return ['Период задачи выходит за пределы связанной командировки. Проверьте даты или выберите другую поездку.'];
      return [];
    }),
  ];
};

export const selectTaskTrip = (task: Pick<Task, 'tripAbsenceIds'>, employeeId: number, tripId: string, absences: Absence[]): string[] => [
  ...(task.tripAbsenceIds ?? []).filter((id) => absences.find((item) => item.id === id)?.employeeId !== employeeId),
  ...(tripId ? [tripId] : []),
];
