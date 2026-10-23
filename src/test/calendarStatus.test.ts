import { describe, expect, it, vi } from 'vitest';
import { loadCalendarStatus, storeCalendarStatus } from '../lib/calendarStatus';

describe('устойчивость настройки статуса календаря', () => {
  it('использует все задачи при отсутствующем или повреждённом значении', () => {
    expect(loadCalendarStatus(1)).toBe('all');
    localStorage.setItem('task-control:calendar-status:1', 'unknown');
    expect(loadCalendarStatus(1)).toBe('all');
  });

  it('позволяет выбрать фильтр, даже если хранилище браузера недоступно', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    try {
      expect(loadCalendarStatus(1)).toBe('all');
      expect(() => storeCalendarStatus('done', 1)).not.toThrow();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
