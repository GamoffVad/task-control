import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type KeyboardEvent } from 'react';
import { FIRST_HOUR, LAST_HOUR, movedTaskDates } from './calendarLayout';
import { addDays } from './dates';
import type { Task } from './types';

export type CalendarDrop = { taskId: string; day: string; start: Date; end: Date; mode: 'move' | 'start' | 'end' };
type Session = {
  taskId: string;
  pointerId: number;
  x: number;
  y: number;
  offset: number;
  mode: CalendarDrop['mode'];
  moved: boolean;
  source: HTMLButtonElement;
  capture: HTMLElement;
  ghost: HTMLButtonElement | null;
  point: { x: number; y: number };
};

type Navigation = { onNavigate?: (direction: 1 | -1) => void; periodKey?: string; onResize?: (task: Task, start: Date, end: Date) => void };
const EDGE_WIDTH = 36;
const EDGE_DELAY = 650;
const EDGE_REPEAT = 1000;

/** Указатель работает и с мышью, и с касанием; сохранение происходит только при отпускании в сетке. */
export function useCalendarDrag(tasks: Task[], canMove: (task: Task) => boolean, onMove: (task: Task, start: Date) => void, { onNavigate, periodKey, onResize }: Navigation = {}) {
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const blockedClick = useRef<{ id: string; until: number } | null>(null);
  const keyboardTask = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const navigate = useRef(onNavigate);
  const edge = useRef<{ direction: 1 | -1 | null; timer: number | null }>({ direction: null, timer: null });
  const [edgeDirection, setEdgeDirection] = useState<1 | -1 | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const [drop, setDrop] = useState<CalendarDrop | null>(null);

  useLayoutEffect(() => { navigate.current = onNavigate; }, [onNavigate]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (edge.current.timer !== null) window.clearTimeout(edge.current.timer);
    const current = session.current;
    session.current = null;
    current?.ghost?.remove();
    if (current?.capture.hasPointerCapture?.(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
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

  const target = useCallback((x: number, y: number): CalendarDrop | null => {
    const current = session.current;
    if (!current) return null;
    const task = tasks.find((item) => item.id === current.taskId);
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-calendar-day]');
    if (!task || !zone || !root.current?.contains(zone)) return null;
    let point: Date;
    if (zone.dataset.calendarMode === 'month') {
      point = new Date(zone.dataset.calendarDay!);
      const before = new Date(current.mode === 'end' ? task.end : task.start);
      point.setHours(before.getHours(), before.getMinutes(), before.getSeconds(), before.getMilliseconds());
    } else {
      point = new Date(timeAt(zone, y) - current.offset);
      point.setMinutes(Math.round(point.getMinutes() / 30) * 30, 0, 0);
      // Последняя получасовая ячейка остаётся видимой и после переноса.
      if (current.mode === 'move' && point.toDateString() === new Date(zone.dataset.calendarDay!).toDateString() && point.getHours() >= LAST_HOUR) {
        point.setHours(LAST_HOUR - 1, 30, 0, 0);
      }
    }
    const start = new Date(task.start), end = new Date(task.end);
    if (current.mode === 'start') start.setTime(Math.min(point.getTime(), end.getTime() - 30 * 60_000));
    else if (current.mode === 'end') end.setTime(Math.max(point.getTime(), start.getTime() + 30 * 60_000));
    else {
      const moved = movedTaskDates(task, point);
      start.setTime(new Date(moved.start).getTime());
      end.setTime(new Date(moved.end).getTime());
    }
    return { taskId: task.id, day: zone.dataset.calendarDay!, start, end, mode: current.mode };
  }, [tasks]);

  const updateDrop = useCallback((next: CalendarDrop | null) => setDrop((before) =>
    before?.taskId === next?.taskId && before?.day === next?.day && before?.start.getTime() === next?.start.getTime() && before?.end.getTime() === next?.end.getTime() ? before : next), []);

  // После смены периода указатель может оставаться неподвижным: подсвечиваем уже новую ячейку.
  useLayoutEffect(() => {
    const current = session.current;
    if (current?.moved) updateDrop(target(current.point.x, current.point.y));
  }, [periodKey, target, updateDrop]);

  const clearEdge = () => {
    if (edge.current.timer !== null) window.clearTimeout(edge.current.timer);
    edge.current = { direction: null, timer: null };
    setEdgeDirection(null);
  };

  const edgeAt = ({ x, y }: { x: number; y: number }): 1 | -1 | null => {
    if (!navigate.current) return null;
    const surface = root.current?.querySelector<HTMLElement>('[data-calendar-surface]');
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
    if (right <= left || y < Math.max(0, rect.top) || y > Math.min(window.innerHeight, rect.bottom) || x < 0 || x > window.innerWidth) return null;
    if (x <= left + EDGE_WIDTH) return -1;
    if (x >= right - EDGE_WIDTH) return 1;
    return null;
  };

  const updateEdge = (current: Session) => {
    const direction = edgeAt(current.point);
    if (edge.current.direction === direction) return;
    clearEdge();
    if (!direction) return;
    edge.current.direction = direction;
    setEdgeDirection(direction);
    const advance = () => {
      if (session.current !== current || edge.current.direction !== direction || edgeAt(current.point) !== direction) { clearEdge(); return; }
      setDrop(null);
      navigate.current?.(direction);
      edge.current.timer = window.setTimeout(advance, EDGE_REPEAT);
    };
    edge.current.timer = window.setTimeout(advance, EDGE_DELAY);
  };

  const reset = () => {
    const current = session.current;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    clearEdge();
    current?.ghost?.remove();
    setDraggingId(null);
    setResizing(false);
    setDrop(null);
    if (current?.moved) blockedClick.current = { id: current.taskId, until: performance.now() + 400 };
    if (current?.capture.hasPointerCapture?.(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
  };

  const onStart = (event: PointerEvent<HTMLButtonElement>, task: Task) => {
    if (event.button !== 0 || !event.isPrimary || !canMove(task) || session.current) return;
    const source = event.currentTarget;
    const zone = source.closest<HTMLElement>('[data-calendar-day]');
    if (!zone) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-resize]')?.dataset.calendarResize;
    const mode = onResize && (handle === 'start' || handle === 'end') ? handle : 'move';
    const offset = zone.dataset.calendarMode === 'time' ? timeAt(zone, event.clientY) - new Date(mode === 'end' ? task.end : task.start).getTime() : 0;
    session.current = { taskId: task.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset, mode, source, capture: source, moved: false, ghost: null, point: { x: event.clientX, y: event.clientY } };
    source.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    event.preventDefault();
    if (!current.moved) {
      current.moved = true;
      if (current.mode === 'move') {
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
      }
      // Корень сохраняется при смене недели/месяца, в отличие от исходной карточки.
      if (root.current) {
        current.capture = root.current;
        root.current.setPointerCapture?.(current.pointerId);
        root.current.focus({ preventScroll: true });
      }
      setDraggingId(current.taskId);
      setResizing(current.mode !== 'move');
    }
    current.point = { x: event.clientX, y: event.clientY };
    updateEdge(current);
    // Координаты обновляются раз за кадр, а React — только при смене целевой ячейки.
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (session.current !== current) return;
      const { x, y } = current.point;
      if (current.ghost) current.ghost.style.transform = `translate3d(${x - current.x}px, ${y - current.y}px, 0)`;
      const next = target(x, y);
      updateDrop(next);
    });
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.moved) {
      event.preventDefault();
      const next = target(event.clientX, event.clientY);
      const task = tasks.find((item) => item.id === current.taskId);
      if (next && task && canMove(task)) {
        if (current.mode === 'move') onMove(task, next.start);
        else onResize?.(task, next.start, next.end);
      }
    }
    reset();
  };

  const onClickCapture = (event: MouseEvent) => {
    const blocked = blockedClick.current;
    const taskId = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-task]')?.dataset.calendarTask;
    if (blocked && (blocked.id === taskId || !taskId) && performance.now() < blocked.until) {
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

  const onLostPointerCapture = (event: PointerEvent) => {
    const current = session.current;
    // Передача захвата с карточки на корень — нормальная часть начала переноса.
    if (current && event.pointerId === current.pointerId && event.target === current.capture) reset();
  };

  return { root, draggingId, resizing, drop, edgeDirection, onStart, onPointerMove, onPointerUp, onPointerCancel: reset, onLostPointerCapture, onClickCapture, onKeyDownCapture };
}
