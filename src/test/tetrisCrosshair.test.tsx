import { createRef, Profiler } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TetrisCrosshair } from '../components/TetrisCrosshair';
import type { Employee } from '../lib/types';

const people: Employee[] = [
  { id: 1, lastname: 'Иванов', name: 'Иван', patronymic: 'Петрович', position: 'Руководитель', role: 'manager' },
  { id: 2, lastname: 'Петров', name: 'Пётр', patronymic: 'Иванович', position: 'Инженер', role: 'executor' },
];
let callbacks = new Map<number, FrameRequestCallback>(), frameId = 0, laneLeft = 220;
const flush = () => act(() => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach((f) => f(0)); });
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
beforeEach(() => {
  callbacks = new Map(); frameId = 0; laneLeft = 220;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { callbacks.set(++frameId, f); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('tl-corner')) return rect(0, 100, 220, 40);
    if (this.classList.contains('tl-foot-label')) return rect(0, 480, 220, 20);
    if (this.dataset.brushEmployee) return rect(laneLeft, this.dataset.brushEmployee === '1' ? 140 : 180, 930, 40);
    if (this.classList.contains('tl-crosshair-label')) return rect(0, 0, 200, 50);
    return rect(0, 100, 1150, 400);
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn((_x: number, y: number) => document.querySelector(`[data-brush-employee="${y < 180 ? 1 : 2}"] button`)) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as Partial<Document>).elementFromPoint; });

const setup = () => {
  const board = createRef<HTMLDivElement>();
  let commits = 0;
  const ui = (month = new Date(2026, 9, 1), active = true) => <Profiler id="crosshair" onRender={() => commits++}>
    <div className="tl-board" ref={board}><div className="tl-corner" />
      {Array.from({ length: 31 }, (_, i) => <div key={i} className="tl-dh">{i + 1}</div>)}
      {people.map((p) => <div key={p.id}><a className="tl-who">{p.lastname}</a><div data-brush-employee={p.id}><button>Период</button></div></div>)}
      <div className="tl-foot-label" />
    </div><TetrisCrosshair board={board} people={people} month={month} active={active} />
  </Profiler>;
  const view = render(ui());
  Object.defineProperties(board.current!, { clientWidth: { configurable: true, value: 1150 }, clientHeight: { configurable: true, value: 400 } });
  return { ...view, board: board.current!, ui, commits: () => commits };
};
const overlay = () => document.querySelector<HTMLElement>('.tl-crosshair')!;
const move = (board: HTMLElement, day: number, y = 160, pointerType = 'mouse') => fireEvent.pointerMove(board, { pointerType, clientX: 220 + (day - .5) * 30, clientY: y });

it('перекрестие и подпись стоят в центре ячейки и меняют положение только при переходе в соседнюю', () => {
  const view = setup();
  const area = document.querySelector<HTMLElement>('.tl-crosshair-field')!, tip = document.querySelector<HTMLElement>('.tl-crosshair-label')!;
  fireEvent.pointerMove(view.board, { pointerType: 'mouse', clientX: 282, clientY: 145 }); flush();
  expect(area.style.getPropertyValue('--cross-x')).toBe('75px');
  expect(area.style.getPropertyValue('--cross-y')).toBe('20px');
  const linePosition = area.style.cssText, labelPosition = tip.style.transform;
  for (const [clientX, clientY] of [[288, 155], [308, 178], [281, 141]]) {
    fireEvent.pointerMove(view.board, { pointerType: 'mouse', clientX, clientY }); flush();
    expect(area.style.cssText).toBe(linePosition);
    expect(tip.style.transform).toBe(labelPosition);
  }
  fireEvent.pointerMove(view.board, { pointerType: 'mouse', clientX: 311, clientY: 178 }); flush();
  expect(area.style.getPropertyValue('--cross-x')).toBe('105px');
  expect(area.style.getPropertyValue('--cross-y')).toBe('20px');
  expect(overlay()).toHaveTextContent('04.10.2026');
  fireEvent.pointerMove(view.board, { pointerType: 'mouse', clientX: 311, clientY: 181 }); flush();
  expect(area.style.getPropertyValue('--cross-y')).toBe('60px');
  expect(overlay()).toHaveTextContent('Петров Пётр Иванович');
});

it('дата и сотрудник определяются поверх периода; движения объединяются в кадр без рендеров React', () => {
  const view = setup(), before = view.commits();
  for (let i = 1; i <= 12; i++) move(view.board, i);
  expect(callbacks.size).toBe(1);
  flush();
  expect(overlay().hidden).toBe(false);
  expect(overlay()).toHaveTextContent('12.10.2026');
  expect(overlay()).toHaveTextContent('Иванов Иван Петрович');
  expect(document.querySelector('.tl-dh.tl-crosshair-hit')).toHaveTextContent('12');
  expect(document.querySelector('.tl-who.tl-crosshair-hit')).toHaveTextContent('Иванов');
  move(view.board, 7, 200); flush();
  expect(overlay()).toHaveTextContent('07.10.2026');
  expect(overlay()).toHaveTextContent('Петров Пётр Иванович');
  expect(document.querySelectorAll('.tl-dh.tl-crosshair-hit')).toHaveLength(1);
  expect(document.querySelector('.tl-dh.tl-crosshair-hit')).toHaveTextContent('7');
  expect(document.querySelectorAll('.tl-who.tl-crosshair-hit')).toHaveLength(1);
  expect(document.querySelector('.tl-who.tl-crosshair-hit')).toHaveTextContent('Петров');
  expect(view.commits()).toBe(before);
  view.rerender(view.ui(new Date(2026, 10, 1))); flush();
  expect(overlay()).toHaveTextContent('07.11.2026');
});

it('учитывает горизонтальную прокрутку и скрывается над закреплёнными ячейками, итогом и при уходе', () => {
  const view = setup();
  move(view.board, 1); flush();
  expect(overlay()).toHaveTextContent('01.10.2026');
  laneLeft = 130;
  fireEvent.scroll(view.board); flush();
  expect(overlay()).toHaveTextContent('04.10.2026');
  for (const [clientX, clientY] of [[100, 160], [235, 120], [235, 490]]) {
    fireEvent.pointerMove(view.board, { pointerType: 'mouse', clientX, clientY }); flush();
    expect(overlay().hidden).toBe(true);
    expect(document.querySelectorAll('.tl-crosshair-hit')).toHaveLength(0);
  }
  move(view.board, 2); flush();
  fireEvent.pointerLeave(view.board);
  expect(overlay().hidden).toBe(true);
  expect(document.querySelectorAll('.tl-crosshair-hit')).toHaveLength(0);
  move(view.board, 2); flush();
  fireEvent(window, new Event('blur'));
  expect(overlay().hidden).toBe(true);
});

it('не мешает касаниям и убирает слой при смене вкладки/открытии формы и размонтировании', () => {
  const view = setup();
  move(view.board, 3); flush();
  move(view.board, 3, 160, 'touch'); flush();
  expect(overlay().hidden).toBe(true);
  move(view.board, 3); flush();
  view.rerender(view.ui(new Date(2026, 9, 1), false)); flush();
  expect(overlay().hidden).toBe(true);
  view.rerender(view.ui());
  move(view.board, 3);
  view.unmount();
  expect(callbacks.size).toBe(0);
  expect(document.querySelector('.tl-crosshair')).toBeNull();
});
