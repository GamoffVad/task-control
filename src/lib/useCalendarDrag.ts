import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type KeyboardEvent } from 'react';
import { FIRST_HOUR, LAST_HOUR } from './calendarLayout';
import { addDays } from './dates';
import type { Task } from './types';

export type CalendarDrop = { taskId: string; day: string; start: Date };
type Session = {
  taskId: string;
  pointerId: number;
  x: number;
  y: number;
  offset: number;
  moved: boolean;
  source: HTMLButtonElement;
  ghost: HTMLButtonElement | null;
  point: { x: number; y: number };
};

/** Указатель работает и с мышью, и с касанием; сохранение происходит только при отпускании в сетке. */
export function useCalendarDrag(tasks: Task[], canMove: (task: Task) => boolean, onMove: (task: Task, start: Date) => void) {
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const blockedClick = useRef<{ id: string; until: number } | null>(null);
  const keyboardTask = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<CalendarDrop | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const current = session.current;
    session.current = null;
    current?.ghost?.remove();
    if (current?.source.hasPointerCapture?.(current.pointerId)) current.source.releasePointerCapture(current.pointerId);
  }, []);

  useLayoutEffect(() => {
    if (!keyboardTask.current) return;
    const button = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-calendar-task]') ?? [])]
      .find((element) => element.dataset.calendarTask === keyboardTask.current);
    button?.focus();
    keyboardTask.current = null;
  }, [tasks]);

  const timeAt = (zone: HTMLElement, y: number) => {
    const day = new Date(zone.dataset.calendarDay!);
    const rect = zone.getBoundingClientRect();
    const minutes = FIRST_HOUR * 60 + (y - rect.top) / rect.height * (LAST_HOUR - FIRST_HOUR) * 60;
    day.setHours(0, minutes, 0, 0);
    return day.getTime();
  };

  const target = (x: number, y: number): CalendarDrop | null => {
    const current = session.current;
    if (!current) return null;
    const task = tasks.find((item) => item.id === current.taskId);
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-calendar-day]');
    if (!task || !zone || !root.current?.contains(zone)) return null;
    let start: Date;
    if (zone.dataset.calendarMode === 'month') {
      start = new Date(zone.dataset.calendarDay!);
      const before = new Date(task.start);
      start.setHours(before.getHours(), before.getMinutes(), before.getSeconds(), before.getMilliseconds());
    } else {
      start = new Date(timeAt(zone, y) - current.offset);
      start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
      // Последняя получасовая ячейка остаётся видимой и после переноса.
      if (start.toDateString() === new Date(zone.dataset.calendarDay!).toDateString() && start.getHours() >= LAST_HOUR) {
        start.setHours(LAST_HOUR - 1, 30, 0, 0);
      }
    }
    return { taskId: task.id, day: zone.dataset.calendarDay!, start };
  };

  const reset = () => {
    const current = session.current;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    current?.ghost?.remove();
    setDraggingId(null);
    setDrop(null);
    if (current?.moved) blockedClick.current = { id: current.taskId, until: performance.now() + 400 };
    if (current?.source.hasPointerCapture?.(current.pointerId)) current.source.releasePointerCapture(current.pointerId);
  };

  const onStart = (event: PointerEvent<HTMLButtonElement>, task: Task) => {
    if (event.button !== 0 || !event.isPrimary || !canMove(task) || session.current) return;
    const source = event.currentTarget;
    const zone = source.closest<HTMLElement>('[data-calendar-day]');
    if (!zone) return;
    const offset = zone.dataset.calendarMode === 'time' ? timeAt(zone, event.clientY) - new Date(task.start).getTime() : 0;
    session.current = { taskId: task.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset, source, moved: false, ghost: null, point: { x: event.clientX, y: event.clientY } };
    source.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    event.preventDefault();
    if (!current.moved) {
      current.moved = true;
      const rect = current.source.getBoundingClientRect();
      const ghost = current.source.cloneNode(true) as HTMLButtonElement;
      ghost.removeAttribute('data-calendar-task');
      ghost.removeAttribute('data-tip');
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      ghost.classList.remove('calendar-moving');
      ghost.classList.add('calendar-drag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.tabIndex = -1;
      Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, right: 'auto' });
      document.body.append(ghost);
      current.ghost = ghost;
      setDraggingId(current.taskId);
    }
    current.point = { x: event.clientX, y: event.clientY };
    // Координаты обновляются раз за кадр, а React — только при смене целевой ячейки.
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (session.current !== current) return;
      const { x, y } = current.point;
      if (current.ghost) current.ghost.style.transform = `translate3d(${x - current.x}px, ${y - current.y}px, 0)`;
      const next = target(x, y);
      setDrop((before) => before?.taskId === next?.taskId && before?.day === next?.day && before?.start.getTime() === next?.start.getTime() ? before : next);
    });
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.moved) {
      event.preventDefault();
      const next = target(event.clientX, event.clientY);
      const task = tasks.find((item) => item.id === current.taskId);
      if (next && task && canMove(task)) onMove(task, next.start);
    }
    reset();
  };

  const onClickCapture = (event: MouseEvent) => {
    const blocked = blockedClick.current;
    const taskId = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-task]')?.dataset.calendarTask;
    if (blocked && blocked.id === taskId && performance.now() < blocked.until) {
      event.preventDefault();
      event.stopPropagation();
      blockedClick.current = null;
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && session.current) {
      event.preventDefault();
      event.stopPropagation();
      reset();
      return;
    }
    // Альтернатива перетаскиванию: Alt+←/→ меняет день, Alt+↑/↓ — время на полчаса.
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-task]')?.dataset.calendarTask;
    const task = tasks.find((item) => item.id === id);
    if (!task || !canMove(task)) return;
    event.preventDefault();
    event.stopPropagation();
    keyboardTask.current = task.id;
    const start = new Date(task.start);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onMove(task, addDays(start, event.key === 'ArrowLeft' ? -1 : 1));
    else { start.setMinutes(start.getMinutes() + (event.key === 'ArrowUp' ? -30 : 30)); onMove(task, start); }
  };

  return { root, draggingId, drop, onStart, onPointerMove, onPointerUp, onPointerCancel: reset, onLostPointerCapture: reset, onClickCapture, onKeyDownCapture };
}
