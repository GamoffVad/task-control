import { useEffect, useId, useRef, useState } from 'react';
import { moveNavItem, normalizeNavOrder } from '../lib/navigation';
import type { User } from '../lib/types';
import { navFor } from './nav';
import { Icon } from './Icons';

type Gesture = { id: string; pointerId: number; x: number; y: number; moved: boolean; order: string[] };

/** Личная доска порядка меню: указатель меняет предпросмотр, отпускание сохраняет. */
export const NavOrderEditor = ({ user, order, onChange }: { user: User | null; order: string[]; onChange: (order: string[]) => void }) => {
  const board = useRef<HTMLOListElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const hintId = useId();
  const items = navFor(user, preview ?? order);
  const defaultOrder = normalizeNavOrder(undefined);
  const isDefault = order.every((to, index) => to === defaultOrder[index]) && order.length === defaultOrder.length;

  const announce = (next: string[], id: string) => {
    const visible = navFor(user, next), index = visible.findIndex((item) => item.to === id);
    setMessage(`${visible[index]?.label}: позиция ${index + 1} из ${visible.length}. Порядок сохранён.`);
  };
  const move = (id: string, to: string) => {
    const next = moveNavItem(order, id, to);
    onChange(next); announce(next, id);
  };
  const finish = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (g && board.current?.hasPointerCapture?.(g.pointerId)) board.current.releasePointerCapture(g.pointerId);
    setPreview(null); setDragged(null);
    if (commit && g?.moved) { onChange(g.order); announce(g.order, g.id); }
    else if (g?.moved) setMessage('Перемещение отменено.');
  };
  useEffect(() => {
    const cancel = () => { gesture.current = null; setPreview(null); setDragged(null); };
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); gesture.current = null; };
  }, []);

  return <section className="nav-order" aria-labelledby={`${hintId}-title`}>
    <div className="card-head">
      <h3 className="admin-subhead" id={`${hintId}-title`}>Порядок пунктов навбара</h3>
      <button type="button" className="text-action" disabled={isDefault} onClick={() => { finish(false); onChange(defaultOrder); setMessage('Порядок меню возвращён по умолчанию.'); }}>Вернуть порядок по умолчанию</button>
    </div>
    <p className="subtitle" id={hintId}>Перетащите карточку за её верхнюю часть на нужное место. Можно использовать кнопки ← → или стрелки клавиатуры на карточке; Home и End — в начало и конец. Изменения сразу видны в шапке и сохраняются для вас в этом браузере.</p>
    <ol className="nav-order-board" ref={board} aria-label="Очередность разделов" onPointerDown={(e) => {
      if (e.button !== 0 || e.isPrimary === false || !(e.target as HTMLElement).closest('[data-nav-handle]')) return;
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-item]');
      if (!card?.dataset.navItem) return;
      e.preventDefault();
      card.querySelector<HTMLButtonElement>('[data-nav-handle]')?.focus({ preventScroll: true });
      gesture.current = { id: card.dataset.navItem, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, order: normalizeNavOrder(order) };
      board.current?.setPointerCapture?.(e.pointerId);
    }} onPointerMove={(e) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
      g.moved = true; setDragged(g.id);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-nav-item]');
      if (!target || !board.current?.contains(target) || target.dataset.navItem === g.id) return;
      g.order = moveNavItem(g.order, g.id, target.dataset.navItem!);
      setPreview(g.order);
    }} onPointerUp={(e) => {
      if (gesture.current?.pointerId !== e.pointerId) return;
      const rect = e.currentTarget.getBoundingClientRect();
      finish(e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
    }} onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (gesture.current) finish(false); }} onKeyDown={(e) => {
      if (e.key === 'Escape' && gesture.current) { e.preventDefault(); finish(false); }
    }}>
      {items.map((item, index) => <li key={item.to} data-nav-item={item.to} className={`nav-order-card${dragged === item.to ? ' dragging' : ''}`}>
        <button type="button" className="nav-order-handle" data-nav-handle data-tip={item.label} aria-label={`Переместить: ${item.label}`} aria-describedby={hintId} onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || gesture.current) return;
          e.preventDefault();
          const target = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (e.key === 'ArrowLeft' ? -1 : 1)));
          if (target !== index) move(item.to, items[target].to);
        }}>
          <span className="nav-order-rank num" aria-hidden>{index + 1}</span>
          <strong>{item.label}</strong><span className="nav-order-grip" aria-hidden>⠿</span>
        </button>
        <div className="nav-order-actions">
          <button type="button" className="icon-btn" aria-label={`${item.label}: влево`} data-tip="На одну позицию раньше" disabled={index === 0 || dragged !== null} onClick={() => move(item.to, items[index - 1].to)}><Icon.ChevronLeft /></button>
          <button type="button" className="icon-btn" aria-label={`${item.label}: вправо`} data-tip="На одну позицию позже" disabled={index === items.length - 1 || dragged !== null} onClick={() => move(item.to, items[index + 1].to)}><Icon.Chevron /></button>
        </div>
      </li>)}
    </ol>
    <p className="nav-order-status" role="status" aria-live="polite">{message || 'Показаны только разделы, доступные вашей роли.'}</p>
  </section>;
};
