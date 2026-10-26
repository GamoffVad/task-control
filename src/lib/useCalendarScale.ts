import { useLayoutEffect, useRef, useState } from 'react';
import { calendarSlotHeights } from './calendarScale';
import type { CalendarView, Task } from './types';

/** Измеряем текст при изменении задач, ширины дорожки или шрифта. Один расчёт на всю неделю. */
export const useCalendarScale = (tasks: Task[], days: Date[], view: CalendarView) => {
  const grid = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState(() => calendarSlotHeights([]));
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const contents = [...element.querySelectorAll<HTMLElement>('[data-calendar-content]')].map((content) => {
        const card = content.closest<HTMLElement>('[data-calendar-top]')!;
        const style = getComputedStyle(card);
        return {
          top: Number(card.dataset.calendarTop), duration: Number(card.dataset.calendarDuration),
          pixels: content.getBoundingClientRect().height + parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0') + 2,
        };
      });
      const next = calendarSlotHeights(contents);
      setHeights((before) => before.every((height, index) => height === next[index]) ? before : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    element.querySelectorAll('[data-calendar-content]').forEach((content) => observer.observe(content));
    observer.observe(element);
    return () => observer.disconnect();
  }, [tasks, days, view]);
  return { grid, heights };
};
