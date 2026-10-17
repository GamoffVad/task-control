// Выпадающие списки внутри <label>: после выбора список закрывается и не открывается снова.
// Браузеры по-разному «пересылают» клик внутри подписи её первой кнопке — у Select это кнопка списка,
// и в части браузеров (Chrome 109) выбранный список сразу открывался снова. Клик внутри списка
// отменяется (preventDefault), и подпись его не пересылает.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField, DateTimeField, Dialog, MultiSelect, Select } from '../kit';

const clicks: MouseEvent[] = [];
const record = (e: MouseEvent) => clicks.push(e);
afterEach(() => {
  document.removeEventListener('click', record);
  clicks.length = 0;
});

describe('поиск во всех выпадающих списках', () => {
  it('фильтрует числовые значения по подписи без учёта регистра, ё и порядка слов', async () => {
    const change = vi.fn();
    render(<Select value={1} onChange={change} label="Сотрудник" options={[
      { value: 1, label: 'Иванов Иван' }, { value: 2, label: 'Фёдоров Пётр' },
    ]} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /Сотрудник:/ });
    await user.click(trigger);
    const search = screen.getByRole('combobox', { name: 'Поиск: Сотрудник' });
    expect(search).toHaveFocus();
    await user.type(search, ' ПЕТР фед ');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id);
    await user.keyboard('{Enter}');
    expect(change).toHaveBeenCalledWith(2);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('показывает пустой результат, очищает поиск кнопкой и не отправляет форму', async () => {
    const change = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><Select value="a" label="Раздел" onChange={change} options={[{ value: 'a', label: 'План' }]} /></form>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Раздел:/ }));
    const search = screen.getByRole('combobox');
    await user.type(search, 'нет такого');
    expect(screen.getByRole('status')).toHaveTextContent('Ничего не найдено');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(change).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Очистить поиск' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(change).not.toHaveBeenCalled();
  });

  it('Escape закрывает только список в диалоге; Tab и клик вне закрывают список', async () => {
    const close = vi.fn();
    render(<Dialog title="Сотрудник" onClose={close}><RoleField /><button>Дальше</button></Dialog>);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /Роль сотрудника:/ });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.type(screen.getByRole('combobox'), 'исп');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Дальше' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('множественный выбор сохраняет скрытые отметки, а «все» охватывает весь список', async () => {
    const Harness = () => {
      const [value, setValue] = useState(['a']);
      return <><MultiSelect label="Категории" allLabel="все категории" options={[
        { value: 'a', label: 'Отчёт отдела' }, { value: 'b', label: 'Отчёт группы' }, { value: 'c', label: 'Задача' },
      ]} value={value} onChange={setValue} /><output>{value.join(',')}</output></>;
    };
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Категории:/ }));
    const search = screen.getByRole('combobox');
    await user.type(search, 'группы');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('a,b'); // output имеет роль status.
    expect(search).toHaveFocus();
    expect(screen.getByRole('option', { name: 'Отчёт группы' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'все категории' }));
    expect(screen.getByRole('status')).toHaveTextContent('a,b,c');
    await user.click(screen.getByRole('option', { name: 'все категории' }));
    expect(screen.getByRole('status')).toHaveTextContent('');
    await user.clear(search);
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('пустой и отключённый Select не падают и не меняют значение', async () => {
    const change = vi.fn();
    render(<><Select value="" label="Пустой" options={[]} onChange={change} /><Select value="a" label="Отключённый" options={[{ value: 'a', label: 'А' }]} onChange={change} disabled /></>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Отключённый:/ }));
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Пустой:/ }));
    await user.keyboard('{ArrowUp}{ArrowDown}{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('Ничего не найдено');
    expect(change).not.toHaveBeenCalled();
  });

  it('поиск есть и в списке времени календаря', async () => {
    const change = vi.fn();
    render(<DateTimeField value="2026-10-05T09:00" onChange={change} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Выбрать дату и время' }));
    await user.type(screen.getByRole('searchbox', { name: 'Поиск времени' }), '14:');
    expect(within(screen.getByRole('listbox', { name: 'Время' })).getAllByRole('option')).toHaveLength(2);
    await user.click(screen.getByRole('option', { name: '14:30' }));
    expect(change).toHaveBeenCalledWith('2026-10-05T14:30');
  });
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
