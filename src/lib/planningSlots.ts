import { addDays, startOfDay } from './dates';
import type { Task } from './types';

export const PLANNING_STEPS = [15, 30, 60, 90, 120, 180] as const;
export type PlanningStep = typeof PLANNING_STEPS[number];
export const DEFAULT_PLANNING_STEP: PlanningStep = 60;
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

const keyOf = (employeeId: number) => `task-control:planning-step:${employeeId}`;
const validStep = (value: number): value is PlanningStep => PLANNING_STEPS.some(step => step === value);
export const loadPlanningStep = (employeeId: number): PlanningStep => {
  try {
    const value = Number(localStorage.getItem(keyOf(employeeId)));
    return validStep(value) ? value : DEFAULT_PLANNING_STEP;
  } catch { return DEFAULT_PLANNING_STEP; }
};
export const storePlanningStep = (step: PlanningStep, employeeId: number): void => {
  try { localStorage.setItem(keyOf(employeeId), String(step)); } catch { /* Настройка действует до закрытия страницы. */ }
};

export type PlanningSlot = { start: string; end: string };

/** Предлагает свободный интервал; существующие задачи никогда не сдвигаются.
 * Учитываются все задачи исполнителя, в том числе общие и вне матрицы.
 * В текущем периоде не предлагаем прошедшее время; для исторического периода
 * начинаем с его первого дня. При заполненном периоде результат отсутствует.
 */
export const nextPlanningSlot = (tasks: Pick<Task, 'start' | 'end' | 'assigneeIds'>[], employeeId: number, from: Date, to: Date, step: PlanningStep, now = new Date()): PlanningSlot | null => {
  const first = startOfDay(from), last = startOfDay(to), today = startOfDay(now);
  const current = today >= first && today <= last;
  const busy = tasks.filter(task => task.assigneeIds.includes(employeeId))
    .map(task => ({ start: new Date(task.start).getTime(), end: new Date(task.end).getTime() }))
    .filter(task => Number.isFinite(task.start) && Number.isFinite(task.end) && task.end > task.start)
    .sort((a, b) => a.start - b.start);
  const duration = step * 60_000;
  for (let day = current ? today : first; day <= last; day = addDays(day, 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const begin = new Date(day); begin.setHours(WORK_START_HOUR, 0, 0, 0);
    const finish = new Date(day); finish.setHours(WORK_END_HOUR, 0, 0, 0);
    let start = begin.getTime();
    if (current && day.getTime() === today.getTime()) start = Math.max(start, now.getTime());
    // Начала привязаны к сетке от 09:00, а не к округлению Unix-времени.
    const snap = (value: number) => begin.getTime() + Math.ceil((value - begin.getTime()) / duration) * duration;
    start = snap(start);
    for (const task of busy) {
      if (start + duration <= task.start) break;
      if (start < task.end && start + duration > task.start) start = snap(task.end);
    }
    if (start + duration <= finish.getTime()) return { start: new Date(start).toISOString(), end: new Date(start + duration).toISOString() };
  }
  return null;
};
