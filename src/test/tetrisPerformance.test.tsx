import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import * as absences from '../lib/absences';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('на 50 сотрудниках движение кисти не пересчитывает общую сводку и остатки, а движения внутри дня не перерисовывают матрицу', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 18, 12));
  let frames: FrameRequestCallback[] = [], commits = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const left = this.dataset.brushEmployee ? 220 : 0, width = this.classList.contains('tl-who') ? 220 : this.dataset.brushEmployee ? 930 : 1150;
    return { x: left, y: 0, left, top: 0, right: left + width, bottom: 500, width, height: 500, toJSON: () => ({}) };
  });
  const seed = createSeed();
  render(<StoreProvider initial={{ ...seed, absences: seed.absences.filter((a) => a.employeeId !== 1), user: { employeeId: 1, email: 'user@example.com', role: 'administrator' } }}><MemoryRouter initialEntries={['/tetris']}><Profiler id="tetris" onRender={() => commits++}><AppRoutes /></Profiler></MemoryRouter></StoreProvider>);
  expect(document.querySelectorAll('.tl-who')).toHaveLength(50);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Рисование периодов' }));
  const board = document.querySelector<HTMLElement>('.tl-board')!;
  const lane = document.querySelector<HTMLElement>('[data-brush-employee="1"]')!;
  const load = vi.spyOn(absences, 'vacationLoad'), balances = vi.spyOn(absences, 'balanceFor');
  const p = (day: number, offset = 0) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 220 + (day - .5) / 31 * 930 + offset, clientY: 20 });
  const move = (day: number, offset = 0) => {
    fireEvent.pointerMove(board, p(day, offset));
    act(() => { const callbacks = frames; frames = []; callbacks.forEach((callback) => callback(0)); });
  };
  fireEvent.pointerDown(lane.querySelectorAll('.tl-cell')[1], p(2));
  for (let day = 3; day <= 10; day++) move(day);
  const before = commits;
  for (let i = 0; i < 12; i++) move(10, i % 3);
  expect(load.mock.calls.length).toBe(0);
  expect(balances.mock.calls.length).toBe(0);
  expect(commits).toBe(before);
  expect(document.querySelector('.tl-brush-preview')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
});
