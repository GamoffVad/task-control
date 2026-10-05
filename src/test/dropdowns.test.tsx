// Выпадающие списки внутри <label>: после выбора список закрывается и не открывается снова.
// Браузеры по-разному «пересылают» клик внутри подписи её первой кнопке — у Select это кнопка списка,
// и в части браузеров (Chrome 109) выбранный список сразу открывался снова. Клик внутри списка
// отменяется (preventDefault), и подпись его не пересылает.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateField, MultiSelect, Select } from '../kit';

const clicks: MouseEvent[] = [];
const record = (e: MouseEvent) => clicks.push(e);
afterEach(() => {
  document.removeEventListener('click', record);
  clicks.length = 0;
});

const RoleField = () => {
  const [role, setRole] = useState('manager');
  return (
    <label className="field">
      <span className="caps">Роль</span>
      <Select value={role} label="Роль сотрудника" options={[{ value: 'administrator', label: 'Администратор' }, { value: 'manager', label: 'Руководитель' }, { value: 'executor', label: 'Исполнитель' }]} onChange={setRole} />
    </label>
  );
};

describe('выпадающие списки в подписи поля', () => {
  it('Select закрывается после выбора, клик не уходит подписи', async () => {
    render(<RoleField />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Роль сотрудника/ }));
    document.addEventListener('click', record);
    await user.click(screen.getByRole('option', { name: 'Исполнитель' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Роль сотрудника: Исполнитель' })).toBeInTheDocument();
    expect(clicks.length).toBeGreaterThan(0);
    expect(clicks.every((e) => e.defaultPrevented)).toBe(true);
  });

  it('MultiSelect и календарь DateField тоже не пересылают клик подписи', async () => {
    const Both = () => {
      const [cats, setCats] = useState<string[]>(['a']);
      const [day, setDay] = useState('2026-10-05');
      return (
        <>
          <label className="field"><span>Категории</span><MultiSelect<string> label="Категории" allLabel="все" options={[{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }]} value={cats} onChange={setCats} /></label>
          <label className="field"><span>Дата</span><DateField value={day} onChange={setDay} /></label>
        </>
      );
    };
    render(<Both />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Категории/ }));
    document.addEventListener('click', record);
    fireEvent.click(screen.getByRole('option', { name: 'Б' }));
    expect(clicks.at(-1)?.defaultPrevented).toBe(true);
    document.removeEventListener('click', record);

    await user.click(screen.getByRole('button', { name: 'Выбрать дату в календаре' }));
    document.addEventListener('click', record);
    fireEvent.click(screen.getAllByRole('gridcell')[10].querySelector('button') ?? screen.getAllByRole('gridcell')[10]);
    expect(clicks.at(-1)?.defaultPrevented).toBe(true);
  });
});
