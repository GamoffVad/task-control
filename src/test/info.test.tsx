import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { lightShot, parseManual } from '../lib/manual';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import raw from '../../docs/manual.html?raw';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

describe('информация', () => {
  it('разбирает документацию: главы, версия, нумерация рисунков, адреса скриншотов', () => {
    const chapters = parseManual(raw, { version: '9.9.9', tests: 42, shotUrl: (f) => `/x/${f}` });
    expect(chapters.map((c) => c.no)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17']);
    expect(chapters[16].title).toBe('Изменения в версии 9.9.9');
    expect(chapters[15].title).toBe('Администрирование');
    const all = chapters.map((c) => c.html).join('');
    // Примеры подстановок шаблонов в тексте допустимы; не должно остаться только служебных меток сборки.
    expect(all).not.toMatch(/\{\{(VERSION|TESTS)\}\}/);
    expect(all).toContain('{{отдел}}');
    expect(all).toContain('<span class="num">Рис. 1</span>');
    expect(all).toContain('src="/x/01-login.png"');
    expect(all).not.toContain('src="shots/');
  });

  it('светлый вариант скриншота лежит рядом с тёмным', () => {
    expect(lightShot('07-control.png')).toBe('07-control.light.png');
    const light = parseManual(raw, { version: '1', tests: 1, shotUrl: (f) => `/x/${lightShot(f)}` }).map((c) => c.html).join('');
    expect(light).toContain('src="/x/01-login.light.png"');
  });

  it('раздел «Информация» — последний в меню, с оглавлением и главами', () => {
    render(
      <StoreProvider initial={{ ...createSeed(), user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' } }}>
        <MemoryRouter initialEntries={['/info']}>
          <AppRoutes />
        </MemoryRouter>
      </StoreProvider>,
    );
    const links = within(screen.getByRole('navigation', { name: 'Разделы' })).getAllByRole('link');
    expect(links.at(-1)).toHaveTextContent('Информация');
    expect(screen.getByRole('heading', { level: 1, name: 'Информация' })).toBeInTheDocument();
    const toc = screen.getByRole('complementary', { name: 'Содержание' });
    expect(within(toc).getAllByRole('link')).toHaveLength(17);
    expect(screen.getByRole('heading', { level: 2, name: 'Тетрис' })).toBeInTheDocument();
  });

  it('рисунок открывается в окне просмотра и листается стрелками', () => {
    render(
      <StoreProvider initial={{ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } }}>
        <MemoryRouter initialEntries={['/info']}>
          <AppRoutes />
        </MemoryRouter>
      </StoreProvider>,
    );
    const pictures = screen.getAllByRole('button', { name: /^Открыть рисунок/ });
    expect(pictures.length).toBeGreaterThan(10);
    fireEvent.click(pictures[0]);
    const dialog = screen.getByRole('dialog', { name: 'Рис. 1' });
    expect(within(dialog).getByText(`1 / ${pictures.length}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Предыдущий рисунок' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Рис. 2' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // С клавиатуры — Enter на рисунке.
    fireEvent.keyDown(pictures[2], { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Рис. 3' })).toBeInTheDocument();
  });
});
