import { useEffect, useRef, useState } from 'react';

// Подсказки в стиле приложения вместо системных title.
// Элемент получает атрибут data-tip, слой показывает подсказку при наведении и при фокусе с клавиатуры
// и на время показа связывает её с элементом через aria-describedby.

const TIP_ID = 'kit-tooltip';
const DELAY = 350;

type Tip = { text: string; x: number; y: number; below: boolean };

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (target.current?.getAttribute('aria-describedby') === TIP_ID) target.current.removeAttribute('aria-describedby');
      target.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      const text = el.dataset.tip;
      if (!text) return;
      window.clearTimeout(timer.current);
      target.current = el;
      timer.current = window.setTimeout(() => {
        if (target.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 64;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
        if (!el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', TIP_ID);
      }, delay);
    };
    const find = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null);
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = find(e);
      if (el === target.current) return;
      hide();
      if (el) show(el, DELAY);
    };
    const onFocus = (e: FocusEvent) => {
      const el = find(e);
      if (el && (e.target as Element).matches(':focus-visible')) show(el, 0);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && target.current && hide();
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', onKey);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Подсказка не выходит за края окна.
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!tip || !ref.current) return setShift(0);
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    setShift(r.left < pad ? pad - r.left : r.right > window.innerWidth - pad ? window.innerWidth - pad - r.right : 0);
  }, [tip]);

  return (
    <div
      ref={ref}
      id={TIP_ID}
      role="tooltip"
      className={`kit-tip${tip ? ' show' : ''}${tip?.below ? ' below' : ''}`}
      style={tip ? { left: tip.x + shift, top: tip.y } : undefined}
      hidden={!tip}
    >
      {tip?.text}
    </div>
  );
}
