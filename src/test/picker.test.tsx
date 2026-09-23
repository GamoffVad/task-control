import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AssigneePicker } from '../components/AssigneePicker';
import { matchesEmployee } from '../lib/logic';
import { employees } from '../lib/data';
import type { Employee } from '../lib/types';

// Основные тесты проверяют демоотдел из 7 человек; большой отдел — в bigdept.test.tsx.
vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

// Большой отдел: к семи демосотрудникам добавляем 23 без группы.
const many: Employee[] = [
  ...employees,
  ...Array.from({ length: 23 }, (_, i) => ({
    id: 100 + i,
    role: 'executor' as const,
    lastname: i === 0 ? 'Фёдоров' : `Сотрудник${i}`,
    name: 'Иван',
    patronymic: 'Петрович',
    position: i === 0 ? 'Аналитик' : 'Специалист',
  })),
];

function Harness({ choices, initial = [], absence }: { choices: Employee[]; initial?: number[]; absence?: (id: number) => string | null }) {
  const [ids, setIds] = useState(initial);
  return (
    <>
      <AssigneePicker choices={choices} selected={ids} onChange={(update) => setIds(update)} absence={absence} />
      <output data-testid="ids">{ids.join(',')}</output>
    </>
  );
}

describe('выбор исполнителей', () => {
  it('ищет по фамилии, имени и должности без учёта регистра и «ё»', () => {
    const f = many.find((e) => e.id === 100)!;
    expect(matchesEmployee(f, 'федор')).toBe(true);
    expect(matchesEmployee(f, 'АНАЛИТ')).toBe(true);
    expect(matchesEmployee(f, 'Сидоров')).toBe(false);
    expect(matchesEmployee(f, '  ')).toBe(true);
  });

  it('в маленьком отделе поиска нет, выбор и снятие работают', async () => {
    const user = userEvent.setup();
    render(<Harness choices={employees} />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByText('Никто не выбран')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Сидоров Д.Е.' }));
    await user.click(screen.getByRole('checkbox', { name: 'Иванов А.Б.' }));
    expect(screen.getByTestId('ids')).toHaveTextContent('1,3');
    await user.click(screen.getByRole('button', { name: 'Убрать: Сидоров Д.Е.' }));
    expect(screen.getByTestId('ids')).toHaveTextContent(/^1$/);
  });

  it('в большом отделе есть поиск, список по группам и счётчик', async () => {
    const user = userEvent.setup();
    render(<Harness choices={many} />);
    const search = screen.getByRole('searchbox', { name: 'Найти сотрудника' });
    expect(screen.getByText('выбрано 0 из 30')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Без группы' })).toBeInTheDocument();
    await user.type(search, 'федор');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: 'Фёдоров И.П.' }));
    await user.clear(search);
    await user.type(search, 'нет такого');
    expect(screen.getByText('Никого не найдено')).toBeInTheDocument();
    // Escape очищает поиск и не доходит до окна.
    let reached = false;
    const onDoc = () => (reached = true);
    document.addEventListener('keydown', onDoc);
    fireEvent.keyDown(search, { key: 'Escape' });
    document.removeEventListener('keydown', onDoc);
    expect(reached).toBe(false);
    expect(search).toHaveValue('');
    expect(screen.getByText('выбрано 1 из 30')).toBeInTheDocument();
  });

  it('выбирает и снимает группу целиком', async () => {
    const user = userEvent.setup();
    render(<Harness choices={employees} initial={[1]} />);
    const group = screen.getByRole('group', { name: 'Проектная группа 1' });
    await user.click(within(group).getByRole('button', { name: 'выбрать группу' }));
    expect(screen.getByTestId('ids')).toHaveTextContent('1,3,4');
    await user.click(within(group).getByRole('button', { name: 'снять группу' }));
    expect(screen.getByTestId('ids')).toHaveTextContent(/^1$/);
  });

  it('помечает отсутствующих в день срока', () => {
    render(<Harness choices={employees} initial={[3]} absence={(id) => (id === 3 ? 'отпуск' : null)} />);
    expect(document.querySelector('[data-tip^="Сидоров Дмитрий Евгеньевич — отпуск в день срока"]')).not.toBeNull();
    const marked = screen.getAllByRole('checkbox').filter((c) => c.textContent?.includes('отпуск'));
    expect(marked.map((c) => c.textContent)).toEqual(['Сидоров Д.Е. · отпуск']);
  });

  it('только для чтения — показывает выбранных без списка', () => {
    render(<AssigneePicker choices={employees} selected={[3]} onChange={() => {}} readOnly />);
    expect(screen.getByText('Сидоров Д.Е.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
