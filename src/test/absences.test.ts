import { describe, expect, it, vi } from 'vitest';
import {
  absenceDays,
  balanceFor,
  covers,
  findClashes,
  fmtDayRanges,
  shareIfApproved,
  vacationLoad,
  validateAbsence,
  type AbsenceDraft,
} from '../lib/absences';
import { absenceAccess } from '../lib/permissions';
import { reducer } from '../lib/reducer';
import { createSeed } from '../lib/seed';
import type { Absence, AppState, Task, User } from '../lib/types';

// Основные тесты проверяют демоотдел из 7 человек; большой отдел — в bigdept.test.tsx.
vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

// Четверг, 17 сентября 2026.
const NOW = new Date(2026, 8, 17, 12, 0);
const MANAGER: User = { email: 'user@example.com', employeeId: 1, role: 'manager' };
const EXECUTOR: User = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' };

const abs = (over: Partial<Absence> = {}): Absence => ({
  id: 'a1',
  employeeId: 3,
  type: 'vacation',
  from: '2026-09-14',
  to: '2026-09-18',
  status: 'approved',
  note: '',
  decidedBy: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Задача',
  rowId: '1.1',
  category: null,
  assigneeIds: [3],
  start: new Date(2026, 8, 16, 10).toISOString(),
  end: new Date(2026, 8, 16, 11).toISOString(),
  docName: '',
  docNumber: '',
  result: '',
  done: false,
  score: null,
  doneAt: null,
  ...over,
});

describe('длительность и покрытие', () => {
  it('отпуск — в календарных днях, отгул — в рабочих', () => {
    expect(absenceDays(abs({ from: '2026-09-14', to: '2026-09-20' }), NOW)).toBe(7);
    expect(absenceDays(abs({ type: 'dayoff', from: '2026-09-14', to: '2026-09-20' }), NOW)).toBe(5);
  });

  it('открытый больничный длится по сегодня + 3 дня', () => {
    const sick = abs({ type: 'sick', from: '2026-09-15', to: null });
    expect(covers(sick, new Date(2026, 8, 20), NOW)).toBe(true);
    expect(covers(sick, new Date(2026, 8, 21), NOW)).toBe(false);
    expect(absenceDays(sick, NOW)).toBe(6);
  });
});

describe('остатки', () => {
  it('делит отпуск на использованный, текущий, запланированный и заявки', () => {
    const list = [
      abs({ id: 'past', from: '2026-07-01', to: '2026-07-14' }),
      abs({ id: 'now', from: '2026-09-15', to: '2026-09-18' }),
      abs({ id: 'future', from: '2026-11-02', to: '2026-11-06' }),
      abs({ id: 'req', from: '2026-12-01', to: '2026-12-03', status: 'request' }),
      abs({ id: 'rej', from: '2026-12-10', to: '2026-12-20', status: 'rejected' }),
      abs({ id: 'off', type: 'dayoff', from: '2026-08-03', to: '2026-08-03' }),
      abs({ id: 'sick', type: 'sick', from: '2026-03-02', to: '2026-03-06' }),
    ];
    const b = balanceFor(list, [{ employeeId: 3, year: 2026, vacationDays: 28, carriedOver: 2, dayoffAccrued: 3 }], 3, 2026, NOW);
    expect(b.vacation).toEqual({ total: 30, used: 14, current: 4, planned: 5, requested: 3, left: 7 });
    expect(b.dayoff).toEqual({ accrued: 3, used: 1, requested: 0, left: 2 });
    expect(b.sick).toEqual({ days: 5, cases: 1 });
  });

  it('без норм берёт 28 дней отпуска', () => {
    expect(balanceFor([], [], 5, 2026, NOW).vacation.left).toBe(28);
  });

  it('учитывает только дни внутри года', () => {
    const b = balanceFor([abs({ from: '2025-12-29', to: '2026-01-04' })], [], 3, 2026, NOW);
    expect(b.vacation.used).toBe(4);
  });
});

describe('пересечения со сроками', () => {
  it('различает просроченные, под угрозой и по заявке; исполненные и отклонённые не считаются', () => {
    const list = [abs({ from: '2026-09-14', to: '2026-09-18' }), abs({ id: 'r', employeeId: 5, from: '2026-09-21', to: '2026-09-25', status: 'request' }), abs({ id: 'x', employeeId: 6, status: 'rejected' })];
    const clashes = findClashes(
      [
        task({ id: 'past' }),
        task({ id: 'future', end: new Date(2026, 8, 18, 12).toISOString() }),
        task({ id: 'done', done: true, result: 'ок' }),
        task({ id: 'req', assigneeIds: [5], end: new Date(2026, 8, 22).toISOString() }),
        task({ id: 'rej', assigneeIds: [6] }),
        task({ id: 'free', end: new Date(2026, 8, 21).toISOString() }),
      ],
      list,
      NOW,
    );
    expect(clashes.map((c) => [c.task.id, c.severity])).toEqual([
      ['past', 'overdue'],
      ['future', 'risk'],
      ['req', 'request'],
    ]);
  });

  it('демоданные дают пересечения по заявке, в прошлом и в будущем', () => {
    const s = createSeed(NOW);
    const sev = new Set(findClashes(s.tasks, s.absences, NOW).map((c) => c.severity));
    expect(sev).toEqual(new Set(['overdue', 'risk', 'request']));
  });
});

describe('проверка отсутствия', () => {
  const draft = (over: Partial<AbsenceDraft> = {}): AbsenceDraft => ({ employeeId: 3, type: 'vacation', from: '2026-10-05', to: '2026-10-09', status: 'request', note: '', ...over });

  it('требует даты по порядку и дату окончания для всего, кроме больничного', () => {
    expect(validateAbsence(draft({ to: '2026-10-01' }), [], NOW).to).toMatch(/раньше первого/);
    expect(validateAbsence(draft({ to: null }), [], NOW).to).toMatch(/только больничный/);
    expect(validateAbsence(draft({ type: 'sick', to: null }), [], NOW)).toEqual({});
  });

  it('не допускает пересечения со своим отсутствием, кроме отклонённого', () => {
    const existing = [abs({ from: '2026-10-08', to: '2026-10-12' })];
    expect(validateAbsence(draft(), existing, NOW).overlap).toMatch(/08\.10–12\.10/);
    expect(validateAbsence(draft(), [abs({ from: '2026-10-08', to: '2026-10-12', status: 'rejected' })], NOW)).toEqual({});
    expect(validateAbsence(draft({ employeeId: 4 }), existing, NOW)).toEqual({});
  });
});

describe('права и редьюсер', () => {
  const state = (user: User): AppState => ({ ...createSeed(NOW), user });
  const draft: AbsenceDraft = { employeeId: 5, type: 'trip', from: '2026-10-12', to: '2026-10-14', status: 'approved', note: 'Филиал' };

  it('исполнитель подаёт только заявку и только на себя', () => {
    const s = reducer(state(EXECUTOR), { type: 'saveAbsence', draft, now: NOW });
    expect(s.absences.at(-1)).toMatchObject({ employeeId: 3, status: 'request', type: 'trip', decidedBy: null });
  });

  it('руководитель сразу согласует и записывает, кто решил', () => {
    const s = reducer(state(MANAGER), { type: 'saveAbsence', draft, now: NOW });
    expect(s.absences.at(-1)).toMatchObject({ employeeId: 5, status: 'approved', decidedBy: 1 });
  });

  it('исполнитель не согласует, не меняет согласованное и не трогает чужое', () => {
    const s0 = state(EXECUTOR);
    const approvedOwn = s0.absences.find((a) => a.employeeId === 3 && a.status === 'approved')!;
    const requestOwn = s0.absences.find((a) => a.employeeId === 3 && a.status === 'request')!;
    const other = s0.absences.find((a) => a.employeeId !== 3)!;
    expect(reducer(s0, { type: 'decideAbsence', id: requestOwn.id, status: 'approved' })).toBe(s0);
    expect(reducer(s0, { type: 'saveAbsence', draft: { ...approvedOwn, note: 'x' } })).toBe(s0);
    expect(reducer(s0, { type: 'deleteAbsence', id: other.id })).toBe(s0);
    expect(reducer(s0, { type: 'saveEntitlement', entitlement: { employeeId: 3, year: 2026, vacationDays: 99, carriedOver: 0, dayoffAccrued: 0 } })).toBe(s0);
    const s1 = reducer(s0, { type: 'deleteAbsence', id: requestOwn.id });
    expect(s1.absences.some((a) => a.id === requestOwn.id)).toBe(false);
  });

  it('руководитель согласует заявку и меняет нормы', () => {
    const s0 = state(MANAGER);
    const req = s0.absences.find((a) => a.status === 'request')!;
    const s1 = reducer(s0, { type: 'decideAbsence', id: req.id, status: 'rejected' });
    expect(s1.absences.find((a) => a.id === req.id)).toMatchObject({ status: 'rejected', decidedBy: 1 });
    const s2 = reducer(s1, { type: 'saveEntitlement', entitlement: { employeeId: 3, year: 2026, vacationDays: 31.4, carriedOver: -2, dayoffAccrued: 1 } });
    expect(s2.entitlements.filter((e) => e.employeeId === 3 && e.year === 2026)).toEqual([{ employeeId: 3, year: 2026, vacationDays: 31, carriedOver: 0, dayoffAccrued: 1 }]);
  });

  it('права на отсутствия', () => {
    expect(absenceAccess(EXECUTOR, abs({ status: 'request' }))).toEqual({ edit: true, decide: false, delete: true });
    expect(absenceAccess(EXECUTOR, abs({ status: 'approved' }))).toEqual({ edit: false, decide: false, delete: false });
    expect(absenceAccess(EXECUTOR, abs({ employeeId: 4, status: 'request' }))).toEqual({ edit: false, decide: false, delete: false });
    expect(absenceAccess(MANAGER, abs())).toEqual({ edit: true, decide: true, delete: true });
  });
});

describe('пик отпусков', () => {
  const sept = Array.from({ length: 30 }, (_, i) => new Date(2026, 8, i + 1));
  const ids = [1, 2, 3, 4, 5, 6, 7];

  it('считает пик по согласованным отпускам и дни превышения 30%', () => {
    const list = [
      abs({ id: 'v1', employeeId: 2, from: '2026-09-14', to: '2026-09-25' }),
      abs({ id: 'v2', employeeId: 3, from: '2026-09-21', to: '2026-09-25' }),
      abs({ id: 'v3', employeeId: 4, from: '2026-09-24', to: '2026-09-28' }),
      abs({ id: 's1', employeeId: 5, type: 'sick', from: '2026-09-24', to: '2026-09-25' }), // больничный не считается
      abs({ id: 'r1', employeeId: 6, status: 'rejected', from: '2026-09-24', to: '2026-09-25' }),
    ];
    const load = vacationLoad(list, ids, sept, NOW);
    expect(load.peak).toBe(3);
    expect(Math.round(load.share * 100)).toBe(43);
    expect(fmtDayRanges(load.peakDays)).toBe('24–25.09');
    expect(fmtDayRanges(load.over)).toBe('24–25.09');
    expect(load.overWithRequests).toEqual([]);
  });

  it('ровно 30% — не превышение; заявки показывают будущее превышение', () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    const list = [
      abs({ id: 'v1', employeeId: 1, from: '2026-09-21', to: '2026-09-25' }),
      abs({ id: 'v2', employeeId: 2, from: '2026-09-21', to: '2026-09-25' }),
      abs({ id: 'v3', employeeId: 3, from: '2026-09-21', to: '2026-09-25' }),
      abs({ id: 'q1', employeeId: 4, status: 'request', from: '2026-09-25', to: '2026-09-28' }),
    ];
    const load = vacationLoad(list, ten, sept, NOW);
    expect(load.share).toBeCloseTo(0.3);
    expect(load.over).toEqual([]);
    expect(fmtDayRanges(load.overWithRequests)).toBe('25.09');
    expect(load.peakWithRequests).toBe(4);
    expect(shareIfApproved(list, list[3], ten, NOW)).toBeCloseTo(0.4);
    expect(shareIfApproved(list, abs({ id: 'x', type: 'trip' }), ten, NOW)).toBe(0);
  });

  it('нет отпусков — пик 0 и пустые дни', () => {
    const load = vacationLoad([], ids, sept, NOW);
    expect(load).toMatchObject({ peak: 0, share: 0, peakDays: [], over: [] });
    expect(fmtDayRanges([new Date(2026, 8, 1), new Date(2026, 8, 2), new Date(2026, 8, 5)])).toBe('01–02.09, 05.09');
  });
});
