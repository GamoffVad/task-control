import { Checkbox, Select } from '../kit';
import { fmtDate, fromDateKey } from '../lib/dates';
import { shortName } from '../lib/data';
import { linkedTripCoversTask, selectTaskTrip, taskTripWarnings, type TripTask } from '../lib/taskTrips';
import type { Absence } from '../lib/types';

export const TaskTripsField = ({ draft, absences, enabled, readOnly, error, onEnabled, onChange, onCreate, canCreate }: {
  draft: TripTask; absences: Absence[]; enabled: boolean; readOnly: boolean; error?: string;
  onEnabled: (enabled: boolean) => void; onChange: (ids: string[]) => void; onCreate: (employeeId: number) => void; canCreate: (employeeId: number) => boolean;
}) => {
  const ids = draft.tripAbsenceIds ?? [];
  const warnings = [...new Set(taskTripWarnings(draft, absences))];
  const missing = ids.filter((id) => !absences.some((trip) => trip.id === id && draft.assigneeIds.includes(trip.employeeId)));
  return <section className="task-trips" aria-label="Связь с командировками">
    <Checkbox checked={enabled} disabled={readOnly} onChange={onEnabled}>Задача выполняется в командировке</Checkbox>
    {enabled && <>
      {!draft.assigneeIds.length && <p className="field-hint">Сначала выберите исполнителя задачи.</p>}
      {draft.assigneeIds.map((employeeId) => {
        const selected = absences.find((trip) => ids.includes(trip.id) && trip.employeeId === employeeId);
        const options = absences.filter((trip) => trip.employeeId === employeeId && ((trip.type === 'trip' && trip.status !== 'rejected') || trip.id === selected?.id))
          .sort((a, b) => Number(linkedTripCoversTask({ ...draft, tripAbsenceIds: [b.id] }, b)) - Number(linkedTripCoversTask({ ...draft, tripAbsenceIds: [a.id] }, a)) || b.from.localeCompare(a.from));
        return <div className="field" key={employeeId}>
          <span className="caps">{shortName(employeeId)}</span>
          <Select variant="light" label={`Командировка ${shortName(employeeId)}`} value={selected?.id ?? ''} disabled={readOnly}
            options={[{ value: '', label: 'Не связана' }, ...options.map((trip) => ({ value: trip.id, label: `${fmtDate(fromDateKey(trip.from))}–${trip.to ? fmtDate(fromDateKey(trip.to)) : '…'} · ${trip.status === 'request' ? 'заявка' : trip.status === 'rejected' ? 'отклонена' : 'согласована'}${trip.note ? ` · ${trip.note}` : ''}` }))]}
            onChange={(id) => onChange(selectTaskTrip(draft, employeeId, id, absences))} />
          {!readOnly && canCreate(employeeId) && <button type="button" className="text-action" onClick={() => onCreate(employeeId)}>Создать командировку для {shortName(employeeId)}</button>}
        </div>;
      })}
      {!!missing.length && !readOnly && <button type="button" className="text-action" onClick={() => onChange(ids.filter((id) => !missing.includes(id)))}>Убрать недоступные связи</button>}
      <p className="field-hint">Связь действует только для выбранной поездки и её исполнителя. Другие отсутствия продолжают проверяться.</p>
    </>}
    {!!warnings.length && <div className="warn-note" role="note">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </section>;
};
