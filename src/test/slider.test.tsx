// Ползунок (src/kit/Slider.tsx) вместо системного <input type="range">.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Slider } from '../kit';

const Harness = ({ initial = 14 }: { initial?: number }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Slider value={value} min={12} max={20} step={0.5} onChange={setValue} label="Размер" format={(v) => `${v} px`} />
      <output>{value}</output>
    </>
  );
};

const value = () => document.querySelector('output')!.textContent;

describe('ползунок', () => {
  it('сообщает границы и текущее значение', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Размер' });
    expect(slider).toHaveAttribute('aria-valuemin', '12');
    expect(slider).toHaveAttribute('aria-valuemax', '20');
    expect(slider).toHaveAttribute('aria-valuenow', '14');
    expect(slider).toHaveAttribute('aria-valuetext', '14 px');
  });

  it('двигается стрелками с заданным шагом', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Размер' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(value()).toBe('14.5');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(value()).toBe('13.5');
    // PageUp — крупный шаг в пять делений.
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(value()).toBe('16');
  });

  it('Home и End ставят края и дальше не пускают', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Размер' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(value()).toBe('20');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(value()).toBe('20');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(value()).toBe('12');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(value()).toBe('12');
  });

  it('перетаскивается указателем', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Размер' });
    // В jsdom у элементов нет размеров: подменяем прямоугольник, чтобы проверить пересчёт доли.
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 160, height: 22, right: 160, bottom: 22, x: 0, y: 0, toJSON: () => ({}) });
    slider.setPointerCapture = () => {};
    fireEvent.pointerDown(slider, { clientX: 80, clientY: 10, pointerId: 1 });
    // Середина дорожки — середина диапазона.
    expect(value()).toBe('16');
  });

  it('недоступный ползунок не меняется и не получает фокус', () => {
    const onChange = vi.fn();
    render(<Slider value={14} min={12} max={20} onChange={onChange} label="Размер" disabled />);
    const slider = screen.getByRole('slider', { name: 'Размер' });
    expect(slider).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
