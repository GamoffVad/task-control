import { TextInput } from '../kit';
import { useState } from 'react';
import { absenceDays, balanceFor, entitlementFor, fmtSpan } from '../lib/absences';
import { ABSENCE_STATUS_LABELS, absenceType } from '../lib/data';
import { plural } from '../lib/dates';
import { isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import type { Absence } from '../lib/types';
import { absColor } from './absColor';
import { AbsenceModal } from './AbsenceModal';
import { Icon } from './Icons';

const TOTALS = { sick: ['Больничные', 'случаев'], trip: ['Командировки', 'поездок'], study: ['Обучение', 'курсов'] } as const;

const pct = (part: number, total: number) => `${total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : 0}%`;

/** Блок «Отсутствия» в карточке сотрудника: остатки за год, список отсутствий, нормы. */
export const AbsencePanel = ({ id }: { id: number }) => {
  const { state, dispatch } = useStore();
  const manager = isManager(state.user);
  const own = state.user?.employeeId === id;
  const year = new Date().getFullYear();
  const b = balanceFor(state.absences, state.entitlements, id, year);
  const ent = entitlementFor(state.entitlements, id, year);
  const [editing, setEditing] = useState<{ absence?: Absence } | null>(null);
  const [norms, setNorms] = useState<{ vacationDays: string; carriedOver: string; dayoffAccrued: string } | null>(null);
  const list = state.absences
    .filter((a) => a.employeeId === id && (a.from.startsWith(String(year)) || (a.to ?? '').startsWith(String(year))))
    .sort((a, b) => b.from.localeCompare(a.from));

  if (!manager && !own) return null;

  const saveNorms = () => {
    if (!norms) return;
    const num = (v: string) => Math.max(0, Math.round(Number(v.replace(',', '.')) || 0));
    dispatch({
      type: 'saveEntitlement',
      entitlement: { employeeId: id, year, vacationDays: num(norms.vacationDays), carriedOver: num(norms.carriedOver), dayoffAccrued: num(norms.dayoffAccrued) },
    });
    setNorms(null);
  };

  return (
    <section className="card" aria-label="Отсутствия сотрудника">
      <div className="card-head">
        <h2>Отсутствия</h2>
        <span className="caps">{year} год</span>
      </div>
      <div className="bal-grid">
        <div className="bal-block" style={absColor('vacation')}>
          <div className="top">
            <span className="caps">Ежегодный отпуск</span>
            <span className="num faint" style={{ fontSize: 12 }}>из {b.vacation.total} дн.</span>
          </div>
          <div className={`big${b.vacation.left < 0 ? ' bad' : ''}`}>
            {b.vacation.left} <small>{plural(b.vacation.left, 'день остался', 'дня осталось', 'дней осталось')}</small>
          </div>
          <div className="bal-track" aria-hidden>
            <i className="used" style={{ width: pct(b.vacation.used, b.vacation.total) }} />
            <i className="plan" style={{ width: pct(b.vacation.current + b.vacation.planned, b.vacation.total) }} />
          </div>
          <div className="bal-keys">
            <span>использовано <span className="num">{b.vacation.used}</span></span>
            <span>идёт и запланировано <span className="num">{b.vacation.current + b.vacation.planned}</span></span>
            {b.vacation.requested > 0 && <span className="amber">в заявках <span className="num">{b.vacation.requested}</span></span>}
          </div>
        </div>
        <div className="bal-block" style={absColor('dayoff')}>
          <div className="top">
            <span className="caps">Отгулы</span>
            <span className="num faint" style={{ fontSize: 12 }}>накоплено {b.dayoff.accrued}</span>
          </div>
          <div className={`big${b.dayoff.left < 0 ? ' bad' : ''}`}>
            {b.dayoff.left} <small>{plural(b.dayoff.left, 'день', 'дня', 'дней')}</small>
          </div>
          <div className="bal-track" aria-hidden>
            <i className="used" style={{ width: pct(b.dayoff.used, b.dayoff.accrued) }} />
          </div>
          <div className="bal-keys">
            <span>использовано <span className="num">{b.dayoff.used}</span></span>
            {b.dayoff.requested > 0 && <span className="amber">в заявках <span className="num">{b.dayoff.requested}</span></span>}
          </div>
        </div>
        {(['sick', 'trip', 'study'] as const).map((k) => (
          <div key={k} className="bal-block" style={absColor(k)}>
            <div className="top">
              <span className="caps">{TOTALS[k][0]}</span>
              <span className="num faint" style={{ fontSize: 12 }}>{year}</span>
            </div>
            <div className="big">
              {b[k].days} <small>{plural(b[k].days, 'день', 'дня', 'дней')}</small>
            </div>
            <div className="bal-track" aria-hidden>
              <i className="used" style={{ width: pct(b[k].days, 50) }} />
            </div>
            <div className="bal-keys">
              <span>
                {TOTALS[k][1]} <span className="num">{b[k].cases}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Отсутствия за год</h2>
        <button type="button" className="text-action" onClick={() => setEditing({})}>
          <Icon.Plus size={12} /> {manager ? 'Добавить отсутствие' : 'Подать заявку'}
        </button>
      </div>
      {list.length === 0 && <p className="empty">Отсутствий в этом году нет.</p>}
      <ul className="list">
        {list.map((a) => (
          <li key={a.id} style={{ borderLeftColor: `var(--abs-${a.type})` }}>
            <button type="button" className="t" onClick={() => setEditing({ absence: a })}>
              {absenceType(a.type).full}
            </button>
            <div className="m">
              <span className="num">{fmtSpan(a)}</span>
              <span>{absenceDays(a)} дн.</span>
              <span className={`status-tag ${a.status}`}>{ABSENCE_STATUS_LABELS[a.status]}</span>
              {a.note && <span>{a.note}</span>}
            </div>
          </li>
        ))}
      </ul>

      {manager && (
        <div className="norms">
          {norms ? (
            <>
              <label className="field">
                <span className="caps">Отпуск, дней в году</span>
                <TextInput mono inputMode="numeric" value={norms.vacationDays} onChange={(e) => setNorms({ ...norms, vacationDays: e.target.value })} />
              </label>
              <label className="field">
                <span className="caps">Перенесено</span>
                <TextInput mono inputMode="numeric" value={norms.carriedOver} onChange={(e) => setNorms({ ...norms, carriedOver: e.target.value })} />
              </label>
              <label className="field">
                <span className="caps">Отгулов накоплено</span>
                <TextInput mono inputMode="numeric" value={norms.dayoffAccrued} onChange={(e) => setNorms({ ...norms, dayoffAccrued: e.target.value })} />
              </label>
              <button type="button" className="btn btn--primary" onClick={saveNorms}>
                <Icon.Save size={15} /> Сохранить нормы
              </button>
              <button type="button" className="btn" onClick={() => setNorms(null)}>
                Отмена
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-action"
              onClick={() => setNorms({ vacationDays: String(ent.vacationDays), carriedOver: String(ent.carriedOver), dayoffAccrued: String(ent.dayoffAccrued) })}
            >
              Нормы на {year} год: отпуск {ent.vacationDays} + перенесено {ent.carriedOver}, отгулов {ent.dayoffAccrued} — изменить
            </button>
          )}
        </div>
      )}

      {editing && <AbsenceModal key={editing.absence?.id ?? 'new'} absence={editing.absence} defaults={{ employeeId: id }} onClose={() => setEditing(null)} />}
    </section>
  );
};
