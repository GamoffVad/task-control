import { department, employees, shortName } from '../lib/data';
import { PERIOD_LABELS } from '../lib/dates';
import type { Employee, Period } from '../lib/types';
import { Segmented, Select } from '../kit';

// Фильтры приложения, собранные из компонентов библиотеки.

export const PeriodPicker = ({ value, onChange }: { value: Period; onChange: (p: Period) => void }) => (
  <Segmented
    label="Период"
    value={value}
    onChange={onChange}
    options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
  />
);

export const EmployeeFilter = ({
  value,
  onChange,
  people = employees,
  allLabel = 'Все сотрудники',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  /** Кого предлагать в списке — например, только сотрудников выбранной группы. */
  people?: Employee[];
  allLabel?: string;
}) => (
  <Select<number>
    label="Сотрудник"
    value={value ?? 0}
    onChange={(v) => onChange(v === 0 ? null : v)}
    options={[{ value: 0, label: allLabel }, ...people.map((e) => ({ value: e.id, label: shortName(e.id) }))]}
  />
);

/** Группа отдела; 'all' — весь отдел. */
export const GroupFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <Select<string>
    label="Группа"
    value={value}
    onChange={onChange}
    options={[{ value: 'all', label: 'Весь отдел' }, ...department.groups.map((g) => ({ value: g.id, label: g.name }))]}
  />
);

