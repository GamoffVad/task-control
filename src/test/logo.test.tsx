import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logo } from '../components/Shell';
import { jumpFrames, LOGO_MOTION } from '../lib/logoSteps';

type Call = { cube: string; delay: number; duration: number };

/** jsdom не умеет Web Animations — подменяем animate и запоминаем вызовы. */
const stubAnimate = () => {
  const calls: Call[] = [];
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((r) => (finish = r));
  Element.prototype.animate = vi.fn(function (this: Element, _frames: Keyframe[], options?: number | KeyframeAnimationOptions) {
    const o = options as KeyframeAnimationOptions;
    calls.push({ cube: this.getAttribute('data-cube') ?? this.tagName, delay: Number(o.delay ?? 0), duration: Number(o.duration) });
    return { finished: pending } as unknown as Animation;
  });
  return { calls, finish };
};

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
});

const renderLogo = () =>
  render(
    <MemoryRouter>
      <Logo />
    </MemoryRouter>,
  );

describe('логотип: «Ступени»', () => {
  it('кадры прыжка по заданию: вверх-влево и сжатие, проседание при приземлении, точное возвращение', () => {
    const f = jumpFrames();
    expect(f.map((k) => k.offset)).toEqual([0, 0.4, 0.72, 1]);
    expect(f[0].transform).toBe('translate(0px, 0px) scale(1, 1)');
    expect(f[1].transform).toMatch(/^translate\(-\d+\.\d+px, -\d+\.\d+px\) scale\(0\.92, 0\.92\)$/);
    expect(f[2].transform).toMatch(/^translate\(0px, \d+\.\d+px\) scale\(1\.08, 0\.9\)$/);
    expect(f[3].transform).toBe('translate(0px, 0px) scale(1, 1)');
    expect(f[0].easing).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('наведение запускает один каскад по ступеням; повторное наведение во время цикла ничего не добавляет', async () => {
    const { calls, finish } = stubAnimate();
    renderLogo();
    const link = screen.getByRole('link', { name: /Контроль задач/ });
    const mark = link.querySelector('svg')!;
    // Наведение на надпись рядом со знаком — не запускает.
    fireEvent.pointerEnter(link.querySelector('.logo-text')!, { pointerType: 'mouse' });
    expect(calls).toHaveLength(0);
    fireEvent.pointerEnter(mark, { pointerType: 'mouse' });
    expect(calls.map((c) => c.cube)).toEqual(['0-3', '1-3', '2-3', '1-2', '2-2', '1-1', '2-1', '1-0', '2-0']);
    expect(calls.map((c) => c.delay)).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400]);
    expect(calls.every((c) => c.duration === LOGO_MOTION.duration)).toBe(true);
    // Весь каскад — около 1100 мс.
    expect(calls.at(-1)!.delay + calls.at(-1)!.duration).toBe(1100);
    fireEvent.pointerLeave(mark, { pointerType: 'mouse' });
    fireEvent.pointerEnter(mark, { pointerType: 'mouse' });
    expect(calls).toHaveLength(9);
    // После завершения цикла — снова можно.
    await act(async () => finish());
    fireEvent.pointerEnter(mark, { pointerType: 'mouse' });
    expect(calls).toHaveLength(18);
  });

  it('только наведение мышью: касание и фокус не запускают; при «уменьшении движения» — только прозрачность', () => {
    const { calls } = stubAnimate();
    renderLogo();
    const link = screen.getByRole('link', { name: /Контроль задач/ });
    const mark = link.querySelector('svg')!;
    fireEvent.pointerEnter(mark, { pointerType: 'touch' });
    fireEvent.pointerDown(mark, { pointerType: 'touch' });
    fireEvent.focus(link);
    expect(calls).toHaveLength(0);
    // jsdom без matchMedia: задаём «уменьшить движение» на время проверки.
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList);
    try {
      fireEvent.pointerEnter(mark, { pointerType: 'mouse' });
      expect(calls).toEqual([expect.objectContaining({ cube: 'svg' })]);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});
