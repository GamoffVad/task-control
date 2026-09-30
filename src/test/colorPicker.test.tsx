// Выбор цвета (src/kit/ColorPicker.tsx) и цветовая математика к нему.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { ColorPicker } from '../kit';
import { clamp, hexToHsv, hsvToHex, isHex, readableInk } from '../kit/color';

const Harness = ({ initial = '#2F5480' }: { initial?: string }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ColorPicker value={value} onChange={setValue} label="Цвет категории" />
      <output>{value}</output>
    </>
  );
};

describe('цветовая математика', () => {
  it('переводит цвет в HSV и обратно без потерь', () => {
    for (const hex of ['#2f5480', '#a32d22', '#ffffff', '#000000', '#1e7268']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    // Короткая запись тоже разбирается.
    expect(hsvToHex(hexToHsv('#fff'))).toBe('#ffffff');
  });

  it('оттенок серого не получает случайный тон', () => {
    expect(hexToHsv('#808080').s).toBe(0);
    expect(hexToHsv('#000000').v).toBe(0);
  });

  it('текст поверх цвета выбирается по яркости', () => {
    expect(readableInk('#1F3A5F')).toBe('#FFFFFF');
    expect(readableInk('#F1EDE6')).toBe('#1F2B3A');
  });

  it('доля не выходит за границы', () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(5)).toBe(1);
    expect(clamp(400, 0, 360)).toBe(360);
    expect(isHex('#2F5480')).toBe(true);
    expect(isHex('#2F54')).toBe(false);
  });
});

describe('стили', () => {
  it('тени не строятся из цвета текста', () => {
    // В тёмной теме --ink-rgb почти белый: такая «тень» превращается в свечение.
    const css = readFileSync('src/kit/kit.css', 'utf8') + readFileSync('src/index.css', 'utf8');
    const shadows = css.match(/box-shadow[^;]*--ink-rgb[^;]*/g) ?? [];
    expect(shadows).toEqual([]);
  });
});

describe('выбор цвета', () => {
  it('панель открывается и закрывается, образец показывает текущий цвет', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Цвет категории: #2F5480' });
    await user.click(trigger);
    const pop = screen.getByRole('dialog', { name: 'Цвет категории' });
    expect(within(pop).getByRole('slider', { name: 'Тон' })).toBeInTheDocument();
    // Escape закрывает только панель.
    fireEvent.keyDown(pop, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('цвет выбирается из палитры приложения', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Цвет категории:/ }));
    expect(screen.getByRole('option', { name: '#2F5480' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: '#A32D22' }));
    expect(document.querySelector('output')!.textContent).toBe('#A32D22');
  });

  it('код можно ввести с клавиатуры; незаконченный не применяется', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Цвет категории:/ }));
    const hex = screen.getByLabelText('Цвет категории: код');
    fireEvent.change(hex, { target: { value: '#1e72' } });
    expect(document.querySelector('output')!.textContent).toBe('#2F5480');
    fireEvent.change(hex, { target: { value: '#1e7268' } });
    expect(document.querySelector('output')!.textContent).toBe('#1e7268');
  });

  it('полоса тона и поле насыщенности двигаются стрелками', async () => {
    const user = userEvent.setup();
    render(<Harness initial="#2f5480" />);
    await user.click(screen.getByRole('button', { name: /^Цвет категории:/ }));
    const hue = screen.getByRole('slider', { name: 'Тон' });
    const before = document.querySelector('output')!.textContent;
    fireEvent.keyDown(hue, { key: 'ArrowRight' });
    expect(document.querySelector('output')!.textContent).not.toBe(before);
    const area = screen.getByRole('slider', { name: 'Насыщенность и яркость' });
    const afterHue = document.querySelector('output')!.textContent;
    fireEvent.keyDown(area, { key: 'ArrowUp' });
    expect(document.querySelector('output')!.textContent).not.toBe(afterHue);
  });

  it('тянется указателем по полю насыщенности', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Цвет категории:/ }));
    const area = screen.getByRole('slider', { name: 'Насыщенность и яркость' });
    // В jsdom у элементов нет размеров: подменяем прямоугольник, чтобы проверить пересчёт доли.
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    area.setPointerCapture = () => {};
    fireEvent.pointerDown(area, { clientX: 200, clientY: 0, pointerId: 1 });
    // Правый верхний угол — чистый насыщенный тон.
    expect(document.querySelector('output')!.textContent).toBe(hsvToHex({ h: hexToHsv('#2F5480').h, s: 1, v: 1 }));
  });

  it('недоступное поле не открывается', async () => {
    const user = userEvent.setup();
    render(<ColorPicker value="#8C816C" onChange={() => {}} disabled />);
    await user.click(screen.getByRole('button', { name: /^Цвет:/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
