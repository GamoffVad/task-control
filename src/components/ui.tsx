import { department, shortName } from '../lib/data';
import { useScope, useScopeEmployees } from '../lib/useScope';
import { inScope } from '../lib/visibility';
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
  people,
  allLabel = 'Все сотрудники',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  /** Кого предлагать в списке — например, только сотрудников выбранной группы. По умолчанию — видимые вошедшему. */
  people?: Employee[];
  allLabel?: string;
}) => {
  const visible = useScopeEmployees();
  const list = people ?? visible;
  return (
    <Select<number>
      label="Сотрудник"
      value={value ?? 0}
      onChange={(v) => onChange(v === 0 ? null : v)}
      options={[{ value: 0, label: allLabel }, ...list.map((e) => ({ value: e.id, label: shortName(e.id) }))]}
    />
  );
};

/** Группа отдела; 'all' — весь отдел. Показываются группы, в которых есть видимые вошедшему сотрудники. */
export const GroupFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const scope = useScope();
  const groups = department.groups.filter((g) => g.employeeIds.some((id) => inScope(scope, id)));
  return (
    <Select<string>
      label="Группа"
      value={value}
      onChange={onChange}
      options={[{ value: 'all', label: scope === null ? 'Весь отдел' : 'Все доступные' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
    />
  );
};

