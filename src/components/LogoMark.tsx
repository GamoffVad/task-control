// Знак приложения: галочка из квадратных блоков — «задача выполнена» и блоки «Тетриса».
// Клетки заданы в прямой сетке (буква «L») и повёрнуты на 45°; анимация «Ступени» — в lib/logoSteps.ts.

import type { PointerEventHandler, Ref } from 'react';
import { CELLS, FILL, rot, SIZE, STEP, VIEW } from '../lib/logoSteps';

export const LogoMark = ({ size = 40, className, svgRef, onPointerEnter }: { size?: number; className?: string; svgRef?: Ref<SVGSVGElement>; onPointerEnter?: PointerEventHandler<SVGSVGElement> }) => (
  <svg ref={svgRef} className={className} onPointerEnter={onPointerEnter} width={size} height={size} viewBox={VIEW} aria-hidden focusable="false" style={{ overflow: 'visible' }}>
    {CELLS.map(([x, y, tone]) => {
      // Центр кубика после поворота на 45°: внешняя группа ставит кубик на место,
      // средняя (data-cube) анимируется, внутренний ромб держит свой поворот.
      const [cx, cy] = rot(x * STEP + SIZE / 2, y * STEP + SIZE / 2);
      return (
        <g key={`${x}-${y}`} transform={`translate(${cx} ${cy})`}>
          <g data-cube={`${x}-${y}`} className="logo-cube">
            <rect
              x={-SIZE / 2}
              y={-SIZE / 2}
              width={SIZE}
              height={SIZE}
              rx={0.6}
              fill={FILL[tone]}
              // Тон 0 — «тёмные» кубики: при смене акцента они остаются тем же цветом, но проступают слабее.
              style={tone === 0 ? { fillOpacity: 'var(--logo-dark-alpha)' } : undefined}
              transform="rotate(45)"
            />
          </g>
        </g>
      );
    })}
  </svg>
);
