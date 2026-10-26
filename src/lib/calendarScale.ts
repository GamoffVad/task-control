import { FIRST_HOUR, LAST_HOUR } from './calendarLayout';

export const CALENDAR_SLOTS = (LAST_HOUR - FIRST_HOUR) * 2;
export const BASE_SLOT_HEIGHT = 20;
export type CalendarContentSize = { top: number; duration: number; pixels: number };

/** Общая шкала всех дней: растут только получасовые интервалы, которым не хватает места.
 * Карточки сохраняют реальные начало/окончание и не накрывают следующую задачу. */
export const calendarSlotHeights = (contents: CalendarContentSize[]): number[] => {
  const heights = Array<number>(CALENDAR_SLOTS).fill(BASE_SLOT_HEIGHT);
  for (const { top, duration, pixels } of contents) {
    const start = Math.max(0, top * 2), end = Math.min(CALENDAR_SLOTS, (top + duration) * 2);
    if (end <= start || !Number.isFinite(pixels)) continue;
    const weights = heights.map((_, index) => Math.max(0, Math.min(end, index + 1) - Math.max(start, index)));
    const available = heights.reduce((sum, height, index) => sum + height * weights[index], 0);
    const deficit = pixels + 2 - available;
    if (deficit <= 0) continue;
    const denominator = weights.reduce((sum, weight) => sum + weight * weight, 0);
    heights.forEach((height, index) => { heights[index] = height + deficit * weights[index] / denominator; });
  }
  return heights.map((height) => Math.ceil(height));
};

/** Часы от начала сетки → пиксели по расширенной шкале, включая неполные интервалы. */
export const calendarOffset = (heights: number[], hours: number): number => {
  const slot = Math.max(0, Math.min(heights.length, hours * 2));
  const whole = Math.floor(slot);
  return heights.slice(0, whole).reduce((sum, height) => sum + height, 0) + (heights[whole] ?? 0) * (slot - whole);
};

/** Обратное преобразование для переноса и растягивания на неравномерной шкале. */
export const calendarMinutesAt = (zone: HTMLElement, y: number): number => {
  const slots = [...zone.querySelectorAll<HTMLElement>('[data-calendar-minute]')];
  for (const slot of slots) {
    const rect = slot.getBoundingClientRect();
    if (rect.height > 0 && y >= rect.top && y <= rect.bottom) return Number(slot.dataset.calendarMinute) + (y - rect.top) / rect.height * 30;
  }
  const rect = zone.getBoundingClientRect();
  return FIRST_HOUR * 60 + (y - rect.top) / rect.height * (LAST_HOUR - FIRST_HOUR) * 60;
};
