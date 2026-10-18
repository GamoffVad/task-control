import { memo, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { fmtDate } from '../lib/dates';
import type { Employee } from '../lib/types';

type Props = { board: RefObject<HTMLDivElement | null>; month: Date; people: Employee[]; active: boolean };

/** Указатель обновляет только свой слой один раз за кадр, не состояние React и строки матрицы. */
export const TetrisCrosshair = memo(({ board, month, people, active }: Props) => {
  const overlay = useRef<HTMLDivElement>(null), field = useRef<HTMLDivElement>(null), label = useRef<HTMLDivElement>(null);
  const dateLabel = useRef<HTMLElement>(null), employeeLabel = useRef<HTMLSpanElement>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = board.current, layer = overlay.current, area = field.current, tip = label.current;
    if (!el || !layer || !area || !tip || !active) { point.current = null; return; }
    const names = new Map(people.map((p) => [p.id, `${p.lastname} ${p.name} ${p.patronymic}`.trim()]));
    const headers = el.querySelectorAll('.tl-dh');
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    let frame: number | null = null, lastCoordinate = '', lastPlacement = '';
    let markedDay: Element | null = null, markedEmployee: Element | null = null;
    const mark = (day: Element | null, employee: Element | null) => {
      if (day !== markedDay) { markedDay?.classList.remove('tl-crosshair-hit'); day?.classList.add('tl-crosshair-hit'); markedDay = day; }
      if (employee !== markedEmployee) { markedEmployee?.classList.remove('tl-crosshair-hit'); employee?.classList.add('tl-crosshair-hit'); markedEmployee = employee; }
      // React мог изменить класс предупреждения даты после сохранения периода.
      if (day && !day.classList.contains('tl-crosshair-hit')) day.classList.add('tl-crosshair-hit');
      if (employee && !employee.classList.contains('tl-crosshair-hit')) employee.classList.add('tl-crosshair-hit');
    };
    const hide = () => { layer.hidden = true; lastPlacement = ''; mark(null, null); };
    const clear = () => { point.current = null; hide(); };
    const paint = () => {
      frame = null;
      const p = point.current;
      if (!p) return hide();
      const outer = el.getBoundingClientRect(), corner = el.querySelector('.tl-corner')?.getBoundingClientRect();
      const footer = el.querySelector('.tl-foot-label')?.getBoundingClientRect();
      const navigationBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const left = Math.max(outer.left, corner?.right ?? outer.left, 0), top = Math.max(outer.top, corner?.bottom ?? outer.top, navigationBottom, 0);
      const right = Math.min(outer.right, outer.left + el.clientWidth, window.innerWidth);
      const bottom = Math.min(outer.bottom, outer.top + el.clientHeight, footer?.top ?? outer.bottom, window.innerHeight);
      if (p.x < left || p.x >= right || p.y < top || p.y >= bottom) return hide();
      // Учитывает полосы событий, закреплённые ячейки, меню и захват указателя кистью.
      const lane = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('[data-brush-employee]');
      if (!lane || !el.contains(lane)) return hide();
      const name = names.get(Number(lane.dataset.brushEmployee)), rect = lane.getBoundingClientRect();
      if (!name || !rect.width) return hide();
      const day = Math.min(count, Math.max(1, Math.floor((p.x - rect.left) / rect.width * count) + 1));
      mark(headers[day - 1] ?? null, lane.previousElementSibling?.matches('.tl-who') ? lane.previousElementSibling : null);
      const coordinate = `${day}|${name}`;
      if (coordinate !== lastCoordinate) {
        dateLabel.current!.textContent = fmtDate(new Date(month.getFullYear(), month.getMonth(), day));
        employeeLabel.current!.textContent = name;
        lastCoordinate = coordinate;
      }
      const cellLeft = rect.left + (day - 1) * rect.width / count, cellRight = rect.left + day * rect.width / count;
      // Центр видимой части ячейки: линии и подпись не следуют за мышью внутри одного дня/сотрудника.
      const snapX = (Math.max(left, cellLeft) + Math.min(right, cellRight)) / 2;
      const snapY = (Math.max(top, rect.top) + Math.min(bottom, rect.bottom)) / 2;
      const placement = `${coordinate}|${left}|${top}|${right}|${bottom}|${snapX}|${snapY}|${window.innerWidth}|${window.innerHeight}`;
      if (placement === lastPlacement && !layer.hidden) return;
      lastPlacement = placement;
      area.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;--cross-x:${snapX - left}px;--cross-y:${snapY - top}px`;
      layer.hidden = false;
      const box = tip.getBoundingClientRect();
      const x = snapX + 14 + box.width > window.innerWidth - 8 ? snapX - box.width - 14 : snapX + 14;
      const y = snapY + 14 + box.height > window.innerHeight - 8 ? snapY - box.height - 14 : snapY + 14;
      tip.style.transform = `translate(${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px, ${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px)`;
    };
    const queue = () => { if (frame === null && point.current) frame = requestAnimationFrame(paint); };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return clear();
      point.current = { x: event.clientX, y: event.clientY }; queue();
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('contextmenu', clear);
    window.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    window.addEventListener('blur', clear);
    queue(); // Обновляет координаты при перелистывании месяца и смене фильтра.
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      hide();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', clear);
      el.removeEventListener('pointercancel', clear);
      el.removeEventListener('contextmenu', clear);
      window.removeEventListener('scroll', queue, true);
      window.removeEventListener('resize', queue);
      window.removeEventListener('blur', clear);
    };
  }, [board, month, people, active]);
  return createPortal(<div className="tl-crosshair" ref={overlay} hidden aria-hidden="true">
    <div className="tl-crosshair-field" ref={field}><i className="tl-crosshair-x" /><i className="tl-crosshair-y" /></div>
    <div className="tl-crosshair-label" ref={label}><b ref={dateLabel} /><span ref={employeeLabel} /></div>
  </div>, document.body);
});
