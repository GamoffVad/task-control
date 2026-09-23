import { useId, useState } from 'react';
import { department, fullName, shortName } from '../lib/data';
import { matchesEmployee } from '../lib/logic';
import type { Employee } from '../lib/types';
import { Icon } from './Icons';
import { Checkbox, SearchField } from '../kit';

/** С какого числа сотрудников в списке появляется поиск. */
const SEARCH_FROM = 9;

/** Выбранные сотрудники отдельно от полного списка, чтобы окно задачи не росло с размером отдела. */
export function AssigneePicker({
  choices,
  selected,
  onChange,
  readOnly,
  absence,
}: {
  choices: Employee[];
  selected: number[];
  /** Получает функцию от текущего выбора: несколько кликов подряд не затирают друг друга. */
  onChange: (update: (prev: number[]) => number[]) => void;
  readOnly?: boolean;
  /** Пометка об отсутствии сотрудника в день срока, например «отпуск». */
  absence?: (id: number) => string | null;
}) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const sorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
  const toggle = (id: number) => onChange((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : sorted([...prev, id])));

  // Имена берём из переданного списка: в нём могут быть сотрудники, которых нет в демоданных.
  const byId = new Map(choices.map((e) => [e.id, e]));
  const short = (id: number) => {
    const e = byId.get(id);
    return e ? `${e.lastname} ${e.name[0]}.${e.patronymic[0]}.` : shortName(id);
  };
  const full = (id: number) => {
    const e = byId.get(id);
    return e ? `${e.lastname} ${e.name} ${e.patronymic}` : fullName(id);
  };

  const found = choices.filter((e) => matchesEmployee(e, query));
  const grouped = department.groups
    .map((g) => ({ id: g.id, name: g.name, people: found.filter((e) => g.employeeIds.includes(e.id)) }))
    .filter((g) => g.people.length > 0);
  const ungrouped = found.filter((e) => !department.groups.some((g) => g.employeeIds.includes(e.id)));
  if (ungrouped.length) grouped.push({ id: 'none', name: 'Без группы', people: ungrouped });

  const chips = (
    <div className="picked" aria-live="polite">
      {selected.length === 0 && <span className="muted">Никто не выбран</span>}
      {selected.map((id) => {
        const mark = absence?.(id);
        return (
          <span key={id} className={`person-chip${mark ? ' absent' : ''}`} data-tip={mark ? `${full(id)} — ${mark} в день срока` : full(id)}>
            {short(id)}
            {mark && <em>{mark}</em>}
            {!readOnly && (
              <button type="button" aria-label={`Убрать: ${short(id)}`} onClick={() => toggle(id)}>
                <Icon.Close size={11} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
  if (readOnly) return chips;

  return (
    <div className="picker">
      {chips}
      <div className="picker-bar">
        {choices.length >= SEARCH_FROM && (
          <SearchField value={query} onChange={setQuery} placeholder="Фамилия, имя или должность" label="Найти сотрудника" aria-controls={listId} />
        )}
        <span className="picker-count">
          выбрано {selected.length} из {choices.length}
        </span>
      </div>
      <div className="picker-list" id={listId}>
        {grouped.length === 0 && <div className="empty">Никого не найдено</div>}
        {grouped.map((g) => {
          const ids = g.people.map((e) => e.id);
          const all = ids.every((id) => selected.includes(id));
          return (
            <div key={g.id} className="picker-group" role="group" aria-label={g.name}>
              {grouped.length > 1 || department.groups.length > 1 ? (
                <div className="picker-group-head">
                  <span className="caps">{g.name}</span>
                  {ids.length > 1 && (
                    <button
                      type="button"
                      className="picker-all"
                      onClick={() => onChange((prev) => (all ? prev.filter((id) => !ids.includes(id)) : sorted([...prev, ...ids])))}
                    >
                      {all ? 'снять группу' : 'выбрать группу'}
                    </button>
                  )}
                </div>
              ) : null}
              <div className="check-grid">
                {g.people.map((e) => {
                  const mark = absence?.(e.id);
                  return (
                    <Checkbox key={e.id} checked={selected.includes(e.id)} onChange={() => toggle(e.id)}>
                      {short(e.id)}
                      {mark && <em className="picker-absent"> · {mark}</em>}
                    </Checkbox>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
