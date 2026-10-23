import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { StoreProvider } from '../lib/StoreProvider';
import { createSeed, DEFAULT_DICTIONARIES } from '../lib/seed';
import { loadState } from '../lib/store';
import { DEFAULT_USERS } from '../lib/access';
import { syncCategories, syncStaff } from '../lib/data';
import { DEFAULT_UNITS } from '../lib/units';
import { absColor } from '../components/absColor';
import { dictionaryColorName, eventLabel } from '../lib/eventPresentation';
import type { Absence, AppState } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
const NOW = new Date(2026, 9, 23, 12);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());
afterEach(() => { syncStaff(DEFAULT_USERS, DEFAULT_UNITS); syncCategories(DEFAULT_DICTIONARIES); });
const initial = (): AppState => {
  const state = createSeed(NOW);
  state.user = { email: 'user@example.com', employeeId: 1, role: 'administrator' };
  state.dictionaries = state.dictionaries.map((entry) => entry.dictionary === 'dutyType' ? { ...entry, color: '#006633' } : entry.dictionary === 'vacationType' ? { ...entry, color: '#AA5500' } : entry);
  state.dictionaries.push({ id: 'night', dictionary: 'dutyType', code: 'ночь', title: 'Ночное дежурство', color: '#174EA6' },
    { id: 'extra', dictionary: 'vacationType', code: 'ночь', title: 'Дополнительный отпуск', color: '#663399' });
  const period = (id: string, type: string, from: string, to: string, extra: Partial<Absence>): Absence => ({ id, employeeId: 3, type, from, to, status: 'approved', createdAt: NOW.toISOString(), decidedBy: 1, note: '', ...extra });
  state.absences = [period('regular', 'duty', '2026-10-02', '2026-10-05', {}), period('night', 'duty', '2026-10-07', '2026-10-11', { dutyType: 'ночь' }),
    period('annual', 'vacation', '2026-10-13', '2026-10-19', {}), period('extra', 'vacation', '2026-10-22', '2026-10-28', { vacationType: 'ночь' })];
  return state;
};
const renderAt = (path: string, state = initial()) => render(<StoreProvider initial={state}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></StoreProvider>);

it.each([
  ['Виды дежурств', 'Плановое дежурство', 'Цвет вида дежурства', 'dutyType'],
  ['Типы отпусков', 'Ежегодный отпуск', 'Цвет типа отпуска', 'vacationType'],
])('сохраняет отдельный цвет в словаре «%s» без изменения периодов', async (dictionary, title, colorLabel, kind) => {
  const state = initial(), user = userEvent.setup();
  renderAt('/admin', state);
  await user.click(screen.getByRole('button', { name: 'Словари' }));
  await user.click(screen.getByText(dictionary, { exact: true }));
  await user.click(screen.getByRole('button', { name: `Изменить значение ${title}` }));
  const dialog = screen.getByRole('dialog', { name: 'Изменить значение' });
  await user.click(within(dialog).getByRole('button', { name: new RegExp(`^${colorLabel}:`) }));
  await user.click(within(dialog).getByRole('option', { name: '#A35A1F' }));
  await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
  expect(loadState().dictionaries.find((entry) => entry.dictionary === kind && entry.title === title)?.color).toBe('#A35A1F');
  expect(loadState().absences).toEqual(state.absences);
});

it('на полосах показывает подтип и отдельный цвет; одинаковые коды разных словарей не смешиваются', () => {
  renderAt('/tetris');
  for (const [id, title, prefix] of [['regular', 'Плановое дежурство', 'duty-regular'], ['night', 'Ночное дежурство', 'duty-_43d__43e__447__44c_'],
    ['annual', 'Ежегодный отпуск', 'vacation-annual'], ['extra', 'Дополнительный отпуск', 'vacation-_43d__43e__447__44c_']]) {
    const bar = document.getElementById(`abs-${id}`)!;
    expect(bar.querySelector('.tl-bar-title')).toHaveTextContent(title);
    expect(bar.style.getPropertyValue('--c')).toContain(`var(--${prefix},`);
    expect(bar.getAttribute('data-tip')).toContain(title);
  }
  const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('');
  expect(css).toContain('--duty-_43d__43e__447__44c_: #174EA6');
  expect(css).toContain('--vacation-_43d__43e__447__44c_: #663399');
  expect(css).toContain(":root[data-theme='dark']");
});

it('старые записи без кода получают название основного подтипа, без отдельного цвета сохраняют общий', () => {
  expect(dictionaryColorName('taskCategory', 'custom_report')).toBe('--cat-custom_report');
  const state = initial(), dictionaries = state.dictionaries.map(({ color, ...entry }) => entry.dictionary === 'dutyType' || entry.dictionary === 'vacationType' ? entry : { ...entry, color });
  for (const a of [state.absences[0], state.absences[2]]) {
    expect(eventLabel(a, dictionaries)).toMatch(/Плановое дежурство|Ежегодный отпуск/);
    expect(absColor(a, dictionaries)).toEqual(absColor(a.type));
  }
});
