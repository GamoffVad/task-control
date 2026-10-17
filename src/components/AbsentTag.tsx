import { absenceType } from '../lib/data';
import { fmtSpan, travelNote } from '../lib/absences';
import { toDateKey } from '../lib/dates';
import { absColor } from './absColor';
import type { Absence } from '../lib/types';
import { useStore } from '../lib/store';
import { vacationTypeTitle } from '../lib/vacations';

const short = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;

/**
 * Красная метка отсутствия у фамилии: «отпуск · до 25.09», «больничный · с 16.09».
 * dot — только точка цвета вида отсутствия (как в «Тетрисе»), подробности в подсказке; focusable=false — внутри ссылки, чтобы не вкладывать фокус в фокус.
 */
export const AbsentTag = ({ absence, from, dot, focusable = true }: { absence: Absence; from?: Date; dot?: boolean; focusable?: boolean }) => {
  const { state } = useStore();
  const type = absenceType(absence.type).label.toLowerCase();
  const started = !from || absence.from <= toDateKey(from);
  const when = absence.to === null ? `с ${short(absence.from)}` : started ? `до ${short(absence.to)}` : `с ${short(absence.from)}`;
  const details = `${absence.type === 'vacation' ? vacationTypeTitle(absence, state.dictionaries) : absenceType(absence.type).full}: ${fmtSpan(absence)}${travelNote(absence) ? `. ${travelNote(absence)}` : ''}${absence.note ? `. ${absence.note}` : ''}`;
  if (dot) return <span className="absent-dot" style={absColor(absence.type)} tabIndex={focusable ? 0 : undefined} role="img" aria-label={`${type} · ${when}. ${details}`} data-tip={`${type[0].toUpperCase()}${type.slice(1)} · ${when}
${details}`} />;
  return (
    <span className="absent-tag" data-tip={details}>
      {type} · {when}
    </span>
  );
};
