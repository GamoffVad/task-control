import { fmtSpan } from '../lib/absences';
import { useStore } from '../lib/store';
import { taskTripWarnings, type TripTask } from '../lib/taskTrips';

/** Метка связи, а не согласования: статус поездки остаётся явным. */
export const TaskTripLabel = ({ task }: { task: TripTask }) => {
  const { state } = useStore();
  if (!task.tripAbsenceIds?.length) return null;
  const labels = task.tripAbsenceIds.map((id) => {
    const trip = state.absences.find((item) => item.id === id);
    return trip ? `${fmtSpan(trip)}${trip.status === 'request' ? ' (заявка)' : trip.status === 'rejected' ? ' (отклонена)' : ''}` : 'не найдена';
  });
  const warning = taskTripWarnings(task, state.absences).length > 0;
  return <span className={`task-trip-label${warning ? ' amber' : ''}`}>Командировка · {[...new Set(labels)].join('; ')}{warning ? ' · проверьте связь' : ''}</span>;
};
