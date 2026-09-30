// Знак приложения и анимация «Ступени»: геометрия, порядок прыжков, настройки и запуск цикла.
// Кубики по очереди подпрыгивают от нижней левой части знака к верхней правой.

import { useCallback, useRef } from 'react';

/** [столбец, строка, тон]: 0 — тёмный, 1 — синий. */
export const CELLS: [number, number, 0 | 1][] = [
  [2, 3, 1],
  [1, 3, 1],
  [0, 3, 0],
  [2, 2, 1],
  [1, 2, 0],
  [2, 1, 1],
  [1, 1, 0],
  [2, 0, 0],
  [1, 0, 1],
];

/**
 * Порядок прыжков — явно, по ступеням диагонали снизу слева вверх вправо.
 * Ступень — строка исходной сетки (после поворота на 45° она лежит поперёк диагонали);
 * внутри ступени первым прыгает левый кубик.
 */
const JUMP_ORDER: [number, number][] = [
  [0, 3], [1, 3], [2, 3], // ступень 1 — нижняя левая
  [1, 2], [2, 2], //         ступень 2
  [1, 1], [2, 1], //         ступень 3
  [1, 0], [2, 0], //         ступень 4 — верхняя правая
];

export const STEP = 11;
export const SIZE = 10.4;
const K = Math.SQRT1_2;
export const rot = (x: number, y: number) => [(x - y) * K, (x + y) * K];

// Рамка по всем углам повёрнутых клеток — знак вписан без обрезки.
const corners = CELLS.flatMap(([cx, cy]) => {
  const x = cx * STEP;
  const y = cy * STEP;
  return [rot(x, y), rot(x + SIZE, y), rot(x, y + SIZE), rot(x + SIZE, y + SIZE)];
});
const minX = Math.min(...corners.map((c) => c[0]));
const maxX = Math.max(...corners.map((c) => c[0]));
const minY = Math.min(...corners.map((c) => c[1]));
const maxY = Math.max(...corners.map((c) => c[1]));
const side = Math.max(maxX - minX, maxY - minY) + 6;
/** Рамка знака: из неё строятся и viewBox логотипа, и значок вкладки. */
export const VIEW_BOX = { x: (minX + maxX) / 2 - side / 2, y: (minY + maxY) / 2 - side / 2, side };
export const VIEW = `${VIEW_BOX.x.toFixed(2)} ${VIEW_BOX.y.toFixed(2)} ${VIEW_BOX.side.toFixed(2)} ${VIEW_BOX.side.toFixed(2)}`;

export const FILL = ['var(--logo-dark)', 'var(--logo-1)'];

/** Настройки «Ступеней». Смещения — в единицах эталонного viewBox 0 0 56 52 и масштабируются вместе со знаком. */
export type LogoMotion = {
  /** Высота прыжка вверх (эталон — 8). */
  height: number;
  /** Сдвиг влево в верхней точке (эталон — 3). */
  shift: number;
  /** Насколько кубик «проседает» при приземлении (эталон — 1,5). */
  landing: number;
  /** Задержка между кубиками, мс. */
  delay: number;
  /** Длительность прыжка одного кубика, мс. */
  duration: number;
};

export const LOGO_MOTION: LogoMotion = { height: 8, shift: 3, landing: 1.5, delay: 50, duration: 700 };

// Эталонные единицы (ширина 56) → единицы нашего viewBox.
const UNIT = side / 56;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Кадры прыжка: CSS-преобразование группы кубика; поворот на 45° задан глубже и не сбрасывается. */
export const jumpFrames = (m: LogoMotion = LOGO_MOTION): Keyframe[] => [
  { offset: 0, transform: 'translate(0px, 0px) scale(1, 1)', easing: EASE },
  { offset: 0.4, transform: `translate(${(-m.shift * UNIT).toFixed(3)}px, ${(-m.height * UNIT).toFixed(3)}px) scale(0.92, 0.92)`, easing: EASE },
  { offset: 0.72, transform: `translate(0px, ${(m.landing * UNIT).toFixed(3)}px) scale(1.08, 0.9)`, easing: EASE },
  { offset: 1, transform: 'translate(0px, 0px) scale(1, 1)' },
];

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Запуск одного цикла «Ступеней» (при наведении курсора на знак). Пока цикл идёт, повторные запуски игнорируются — наложений и скачков нет;
 * уход курсора цикл не прерывает, он доигрывает до конца.
 */
export const useLogoSteps = (motion: LogoMotion = LOGO_MOTION) => {
  const svg = useRef<SVGSVGElement>(null);
  const running = useRef(false);
  const play = useCallback(() => {
    const root = svg.current;
    if (!root || running.current || typeof root.animate !== 'function') return;
    running.current = true;
    const done = () => {
      running.current = false;
    };
    if (prefersReducedMotion()) {
      // Вместо прыжков — короткое мягкое изменение прозрачности всего знака.
      root.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 420, easing: EASE }).finished.then(done, done);
      return;
    }
    const frames = jumpFrames(motion);
    const cubes = JUMP_ORDER.map(([x, y]) => root.querySelector<SVGGElement>(`[data-cube="${x}-${y}"]`));
    const animations = cubes.map((cube, i) => cube?.animate(frames, { duration: motion.duration, delay: i * motion.delay, easing: 'linear', fill: 'none' }));
    const last = animations.at(-1);
    if (last) last.finished.then(done, done);
    else done();
  }, [motion]);
  return { svg, play };
};

