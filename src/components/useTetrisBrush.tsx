import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { Checkbox, TextInput } from '../kit';
import { applyAbsenceStroke, brushMatches, type AbsenceBrush, type AbsenceStroke } from '../lib/absenceBrush';
import { absenceAccess } from '../lib/permissions';
import { hasPermission } from '../lib/access';
import { addMonths, fmtDate, fmtMonthYear, fromDateKey, toDateKey } from '../lib/dates';
import { dutyTypes, eventTypes } from '../lib/eventTypes';
import { vacationTypes } from '../lib/vacations';
import { useStore } from '../lib/store';
import { absColor } from './absColor';

type Choice = AbsenceBrush & { key: string; label: string };
type Gesture = { pointerId: number; employeeId: number; anchor: string; end: string; mode: 'paint' | 'erase'; brush: Choice; startMonth: Date; scrollLeft: number; x: number; y: number; edge: number; held: boolean };
const FIRST_DELAY = 650, REPEAT_DELAY = 900, EDGE = 18;

export const useTetrisBrush = (board: RefObject<HTMLDivElement | null>, month: Date, setMonth: Dispatch<SetStateAction<Date>>, revealType: (type: string) => void) => {
  const { state, dispatch } = useStore();
  const preference = `task-control:tetris-drawing:${state.user?.employeeId ?? 0}`;
  const [drawing, setDrawing] = useState(() => { try { return localStorage.getItem(preference) === '1'; } catch { return false; } });
  const [choiceKey, setChoiceKey] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [stroke, setStroke] = useState<AbsenceStroke | null>(null);
  const [message, setMessage] = useState('');
  const choices = useMemo<Choice[]>(() => eventTypes(state.dictionaries).flatMap((t) =>
    t.key === 'vacation' ? vacationTypes(state.dictionaries).map((v) => ({ key: `vacation:${v.code}`, type: t.key, vacationType: v.code, label: `${t.label} · ${v.title}` }))
      : t.key === 'duty' ? dutyTypes(state.dictionaries).map((v) => ({ key: `duty:${v.code}`, type: t.key, dutyType: v.code, label: `${t.label} · ${v.title}` }))
        : [{ key: t.key, type: t.key, label: t.label }]), [state.dictionaries]);
  const choice = choices.find((c) => c.key === choiceKey) ?? choices[0];
  const latest = useRef({ state, month, drawing, choice, menu });
  latest.current = { state, month, drawing, choice, menu };
  const active = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const pendingScroll = useRef(0);
  const menuEl = useRef<HTMLDivElement>(null);
  const preview = useMemo(() => stroke ? applyAbsenceStroke(state, stroke) : null, [state, stroke]);
  const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const range = (g: Gesture): AbsenceStroke => ({ employeeId: g.employeeId, type: g.brush.type, vacationType: g.brush.vacationType, dutyType: g.brush.dutyType,
    from: g.anchor < g.end ? g.anchor : g.end, to: g.anchor > g.end ? g.anchor : g.end, mode: g.mode });
  const drawPreview = () => { if (active.current) setStroke(range(active.current)); };
  const release = () => {
    const g = active.current;
    active.current = null;
    clearTimer();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (g && board.current?.hasPointerCapture?.(g.pointerId)) board.current.releasePointerCapture(g.pointerId);
    setStroke(null);
    return g;
  };
  const cancel = () => {
    const g = release();
    pendingScroll.current = 0;
    if (g) { setMonth(g.startMonth); if (board.current) board.current.scrollLeft = g.scrollLeft; setMessage('Рисование отменено.'); }
  };
  const geometry = (g: Gesture) => {
    const el = board.current, lane = el?.querySelector<HTMLElement>(`[data-brush-employee="${g.employeeId}"]`);
    if (!el || !lane) return null;
    const rect = lane.getBoundingClientRect(), outer = el.getBoundingClientRect();
    const nameWidth = el.querySelector('.tl-who')?.getBoundingClientRect().width ?? 0;
    return { el, rect, outer, left: Math.max(rect.left, outer.left + nameWidth), right: Math.min(rect.right, outer.right, window.innerWidth) };
  };
  const dayAt = (x: number, rect: DOMRect) => {
    const m = latest.current.month, count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    return toDateKey(new Date(m.getFullYear(), m.getMonth(), Math.min(count, Math.max(1, Math.floor((x - rect.left) / rect.width * count) + 1))));
  };
  const tick = () => {
    timer.current = null;
    const g = active.current;
    if (!g || !g.edge) return;
    const geo = geometry(g);
    if (!geo) return;
    const { el } = geo, max = Math.max(0, el.scrollWidth - el.clientWidth);
    if ((g.edge > 0 && el.scrollLeft < max - 1) || (g.edge < 0 && el.scrollLeft > 1)) {
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + g.edge * 120));
      const next = geometry(g);
      if (next) g.end = dayAt(g.x, next.rect);
      drawPreview(); timer.current = setTimeout(tick, 120); return;
    }
    const next = addMonths(latest.current.month, g.edge);
    if (next.getFullYear() < 1900 || next.getFullYear() > 3000) return;
    const date = g.edge > 0 ? next : new Date(next.getFullYear(), next.getMonth() + 1, 0);
    g.end = toDateKey(date); g.held = true;
    latest.current.month = next;
    pendingScroll.current = g.edge;
    setMonth(next); drawPreview();
    timer.current = setTimeout(tick, REPEAT_DELAY);
  };
  const move = (x: number, y: number) => {
    const g = active.current;
    if (!g) return;
    g.x = x; g.y = y;
    const geo = geometry(g);
    if (!geo) return;
    if (y < geo.outer.top || y > geo.outer.bottom) { clearTimer(); g.edge = 0; return; }
    const edge = x >= geo.right - EDGE ? 1 : x <= geo.left + EDGE ? -1 : 0;
    if (!g.held || edge !== g.edge) { g.end = dayAt(x, geo.rect); g.held = false; }
    if (edge !== g.edge) { clearTimer(); g.edge = edge; if (edge) timer.current = setTimeout(tick, FIRST_DELAY); }
    drawPreview();
  };
  useLayoutEffect(() => {
    if (!pendingScroll.current || !board.current) return;
    board.current.scrollLeft = pendingScroll.current > 0 ? 0 : board.current.scrollWidth - board.current.clientWidth;
    pendingScroll.current = 0;
  }, [month, board]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (active.current) { e.preventDefault(); cancel(); } setMenu(null); } };
    const outside = (e: globalThis.PointerEvent) => { if (latest.current.menu && !menuEl.current?.contains(e.target as Node)) setMenu(null); };
    const blur = () => { cancel(); setMenu(null); };
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside); window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur);
      clearTimer(); if (frame.current !== null) cancelAnimationFrame(frame.current); active.current = null;
    };
    // Обработчики читают актуальную кисть, месяц и данные через refs; подписка не прерывает жест.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openMenu = (x: number, y: number) => { cancel(); setQuery(''); setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - Math.min(360, window.innerWidth - 16) - 8)), y: Math.max(8, Math.min(y, window.innerHeight - Math.min(420, window.innerHeight - 16) - 8)) }); };
  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (!drawing || e.button !== 0 || e.isPrimary === false || active.current) return;
    if (menu) { setMenu(null); return; }
    const lane = (e.target as HTMLElement).closest<HTMLElement>('[data-brush-employee]');
    const employeeId = Number(lane?.dataset.brushEmployee);
    if (!lane || !choice || !absenceAccess(state.user, null).edit || (!hasPermission(state.user, 'absences.manage') && employeeId !== state.user?.employeeId)) return;
    const anchor = dayAt(e.clientX, lane.getBoundingClientRect());
    const erase = state.absences.some((a) => a.employeeId === employeeId && a.status !== 'rejected' && a.from <= anchor && (a.to === null || a.to >= anchor) && brushMatches(a, choice, state.dictionaries));
    const g: Gesture = { pointerId: e.pointerId, employeeId, anchor, end: anchor, mode: erase ? 'erase' : 'paint', brush: choice, startMonth: month, scrollLeft: board.current?.scrollLeft ?? 0, x: e.clientX, y: e.clientY, edge: 0, held: false };
    const result = applyAbsenceStroke(state, range(g));
    if (result.error) { setMessage(result.error); e.preventDefault(); return; }
    e.preventDefault(); setMessage(''); active.current = g;
    board.current?.focus({ preventScroll: true }); board.current?.setPointerCapture?.(e.pointerId);
    move(e.clientX, e.clientY);
  };
  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (active.current?.pointerId !== e.pointerId) return;
    move(e.clientX, e.clientY);
    const g = release();
    if (!g) return;
    const s = range(g), result = applyAbsenceStroke(latest.current.state, s);
    if (result.error) { setMessage(result.error); return; }
    dispatch({ type: 'paintAbsences', stroke: s });
    setMessage(`${g.mode === 'erase' ? 'Очищено' : 'Нарисовано'}: ${g.brush.label}, ${fmtDate(fromDateKey(s.from))} — ${fmtDate(fromDateKey(s.to))}.`);
  };
  const search = query.trim().toLocaleLowerCase().replaceAll('ё', 'е');
  const filtered = choices.filter((c) => c.label.toLocaleLowerCase().replaceAll('ё', 'е').includes(search));
  return {
    drawing, stroke, preview,
    tools: <div className="tt-brush-tools">
      <Checkbox checked={drawing} disabled={!absenceAccess(state.user, null).edit} onChange={(value) => { cancel(); setDrawing(value); setMenu(null); setMessage(''); if (value && choice) revealType(choice.type); try { localStorage.setItem(preference, value ? '1' : '0'); } catch { /* Режим действует до перезагрузки. */ } }}>Рисование периодов</Checkbox>
      {drawing && <button type="button" className="btn tt-brush-choice" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }}>Кисть: {choice?.label}</button>}
    </div>,
    hint: drawing && <div className={`tt-brush-hint${preview?.error ? ' danger' : ''}`} role="status">
      {preview?.error ?? (stroke ? `${stroke.mode === 'erase' ? 'Стирание' : 'Рисование'}: ${fmtDate(fromDateKey(stroke.from))} — ${fmtDate(fromDateKey(stroke.to))} · ${fmtMonthYear(month)} · Escape — отменить` : message || 'Правая кнопка — выбор кисти. Левой протяните по дням одной строки. Начните на том же виде события, чтобы стереть. У края месяца удерживайте курсор для перелистывания.')}
    </div>,
    menu: menu && createPortal(<div className="tt-brush-menu" ref={menuEl} style={{ left: menu.x, top: menu.y, maxHeight: window.innerHeight - menu.y - 8 }} role="menu" aria-label="Кисть периода" onKeyDown={(e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || ((e.target as HTMLElement).tagName === 'INPUT' && ['Home', 'End'].includes(e.key))) return;
      e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : current < 0 ? (e.key === 'ArrowUp' ? buttons.length - 1 : 0) : (current + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }}>
      <TextInput autoFocus aria-label="Поиск кисти" placeholder="Поиск вида события…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="tt-brush-items">{filtered.map((c) => <button key={c.key} type="button" role="menuitemradio" aria-checked={choice?.key === c.key} style={absColor(c.type)} onClick={() => { setChoiceKey(c.key); revealType(c.type); setMenu(null); setMessage(''); board.current?.focus({ preventScroll: true }); }}><i />{c.label}</button>)}{!filtered.length && <p>Ничего не найдено</p>}</div>
      <small>Руководитель рисует согласованные события, сотрудник — заявки на себя. Дополнительные сведения задаются через форму.</small>
    </div>, document.body),
    bindings: {
      tabIndex: drawing ? 0 : undefined,
      onPointerDown: start,
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => { if (active.current?.pointerId !== e.pointerId) return; active.current.x = e.clientX; active.current.y = e.clientY;
        if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (active.current) move(active.current.x, active.current.y); }); },
      onPointerUp: finish,
      onPointerCancel: (e: PointerEvent<HTMLDivElement>) => { if (active.current?.pointerId === e.pointerId) cancel(); },
      onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) => { if (active.current?.pointerId === e.pointerId && e.target === board.current) cancel(); },
      onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => { if (!drawing || !(e.target as HTMLElement).closest('[data-brush-employee]')) return; e.preventDefault(); openMenu(e.clientX, e.clientY); },
      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => { if (drawing && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left + 24, r.top + 24); } },
      onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => { if (drawing && (e.target as HTMLElement).closest('[data-brush-employee]')) { e.preventDefault(); e.stopPropagation(); } },
    },
  };
};
