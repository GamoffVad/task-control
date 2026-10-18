import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { navFor } from '../components/nav';
import { loadAppearance, normalizeAppearance, storeAppearance } from '../lib/appearance';
import { moveNavItem, NAV, normalizeNavOrder } from '../lib/navigation';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import type { AppState, User } from '../lib/types';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));
afterEach(() => vi.restoreAllMocks());
const initial = (): AppState => ({ ...createSeed(new Date(2026, 9, 18)), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const at = (state = initial()) => render(<StoreProvider initial={state}><MemoryRouter initialEntries={['/admin']}><AppRoutes /></MemoryRouter></StoreProvider>);
const links = () => within(screen.getByRole('navigation', { name: 'Разделы' })).getAllByRole('link').map((el) => el.getAttribute('href'));
const openEditor = () => userEvent.setup().click(screen.getByRole('button', { name: 'Редактирование UI' }));
const cards = () => within(screen.getByRole('list', { name: 'Очередность разделов' })).getAllByRole('listitem');

describe('порядок навигации', () => {
  it('переносит отчётность после планирования и восстанавливает неполные или повреждённые настройки', () => {
    expect(NAV.slice(0, 3).map((n) => n.to)).toEqual(['/calendar', '/planning', '/reports']);
    for (const value of [undefined, null, {}, 'bad', 7]) expect(normalizeNavOrder(value)).toEqual(NAV.map((n) => n.to));
    const fixed = normalizeAppearance({ navOrder: ['/info', '/unknown', '/info', '/planning', 7] as never }).navOrder;
    expect(fixed.slice(0, 2)).toEqual(['/info', '/planning']);
    expect(new Set(fixed).size).toBe(NAV.length);
    expect(fixed).not.toContain('/unknown');
  });

  it('личный порядок не открывает закрытые по роли разделы и сохраняет их для других ролей', () => {
    const user: User = { employeeId: 3, email: 'sidorov@example.com', role: 'executor' };
    const next = moveNavItem(normalizeNavOrder(undefined), '/info', '/calendar');
    const visible = navFor(user, ['/reports', '/kpi', ...next]);
    expect(visible[0].to).toBe('/info');
    expect(visible.map((n) => n.to)).not.toEqual(expect.arrayContaining(['/reports', '/kpi']));
    expect(visible.find((n) => n.to === '/employees')?.label).toBe('Моя карточка');
    expect(next).toEqual(expect.arrayContaining(['/reports', '/kpi']));
  });

  it('меняет шапку кнопками и клавиатурой, сохраняет после открытия и сбрасывает только порядок', async () => {
    storeAppearance(normalizeAppearance({ dark: { accent: '#a32d22' } }), 1);
    const view = at();
    const user = userEvent.setup();
    expect(links().slice(0, 3)).toEqual(['/calendar', '/planning', '/reports']);
    await openEditor();
    await user.click(screen.getByRole('button', { name: 'Отчётность: влево' }));
    expect(links().slice(0, 3)).toEqual(['/calendar', '/reports', '/planning']);
    screen.getByRole('button', { name: 'Переместить: Отчётность' }).focus();
    await user.keyboard('{Home}');
    expect(links()[0]).toBe('/reports');
    expect(loadAppearance(1).navOrder[0]).toBe('/reports');
    view.unmount(); at(); await openEditor();
    expect(links()[0]).toBe('/reports');
    await user.click(screen.getByRole('button', { name: 'Вернуть порядок по умолчанию' }));
    expect(links()).toEqual(NAV.map((n) => n.to));
    expect(loadAppearance(1).dark.accent).toBe('#a32d22');
  });

  it('показывает исполнителю только доступные карточки', async () => {
    const state = initial(); state.user = { email: 'sidorov@example.com', employeeId: 3, role: 'executor' };
    at(state); await openEditor();
    expect(cards()).toHaveLength(7);
    expect(screen.queryByRole('button', { name: 'Переместить: Отчётность' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Переместить: Моя карточка' })).toBeInTheDocument();
  });

  it('переключает личные настройки при входе под другим пользователем', async () => {
    storeAppearance(normalizeAppearance({ navOrder: ['/info'] }), 3);
    at(); await openEditor(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Планирование: влево' }));
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await user.type(screen.getByLabelText('Логин'), 'sidorov');
    await user.type(screen.getByLabelText('Пароль'), '123456');
    await user.click(screen.getByRole('button', { name: /Войти/ }));
    expect(links()[0]).toBe('/info');
    expect(loadAppearance(1).navOrder[0]).toBe('/planning');
    expect(loadAppearance(3).navOrder[0]).toBe('/info');
  });

  it.each(['save', 'Escape', 'outside', 'cancel'])('перетаскивание: %s, предпросмотр не пишет настройки', async (action) => {
    at(); await openEditor();
    const board = screen.getByRole('list', { name: 'Очередность разделов' });
    const target = cards()[1];
    const descriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 600, bottom: 400 } as DOMRect);
    const p = { pointerId: 1, button: 0, isPrimary: true, clientX: 40, clientY: 30 };
    try {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Переместить: Календарь' }), p);
      fireEvent.pointerMove(board, { ...p, clientX: 200 });
      expect(cards()[0]).toHaveAttribute('data-nav-item', '/planning');
      expect(links()[0]).toBe('/calendar');
      expect(loadAppearance(1).navOrder[0]).toBe('/calendar');
      if (action === 'Escape') fireEvent.keyDown(board, { key: 'Escape' });
      else if (action === 'cancel') fireEvent.pointerCancel(board, p);
      else fireEvent.pointerUp(board, { ...p, clientX: action === 'outside' ? 700 : 200 });
      expect(links()[0]).toBe(action === 'save' ? '/planning' : '/calendar');
      expect(loadAppearance(1).navOrder[0]).toBe(action === 'save' ? '/planning' : '/calendar');
      expect(cards()[0]).toHaveAttribute('data-nav-item', action === 'save' ? '/planning' : '/calendar');
    } finally {
      if (descriptor) Object.defineProperty(document, 'elementFromPoint', descriptor);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
});
