import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { lightShot, parseManual } from '../lib/manual';
import { searchManual } from '../lib/manualSearch';
import { createSeed } from '../lib/seed';
import { StoreProvider } from '../lib/StoreProvider';
import raw from '../../docs/manual.html?raw';
import meta from '../../docs/manual.meta.json';

vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

describe('информация', () => {
  it('ищет фразы в содержимом через HTML-разметку, без учёта регистра, е/ё и пробелов', () => {
    const result = searchManual([{ no: '01', title: 'Правила', html: '<p>Подать <b>отчёт</b>\n за неделю.</p><a href="/secret" title="секрет">Ссылка</a><p hidden>скрытое слово</p>' }], 'ОТЧЕТ   за');
    expect(result).toHaveLength(1);
    expect(result[0].matches).toBe(1);
    expect(result[0].snippet).toContain('Подать отчёт за неделю.');
    const doc = new DOMParser().parseFromString(result[0].html, 'text/html');
    expect([...doc.querySelectorAll('mark')].map((e) => e.textContent).join('')).toMatch(/отчёт\s+за/);
    expect(doc.getElementById(result[0].target)).not.toBeNull();
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('/secret');
    expect(searchManual([{ no: '01', title: 'Правила', html: result[0].html }], 'секрет')).toHaveLength(0);
    expect(searchManual([{ no: '01', title: 'Правила', html: result[0].html }], 'скрытое')).toHaveLength(0);
  });

  it('ищет в заголовках, трактует специальные символы буквально и восстанавливает исходную разметку', () => {
    const chapters = [{ no: '01', title: 'Правила [1]', html: '<p>Формула (a+b)</p>' }];
    expect(searchManual(chapters, '[1]')[0]).toMatchObject({ matches: 1, target: 'ch-01', titleMatches: [{ start: 8, end: 11 }] });
    expect(searchManual(chapters, '(a+b)')[0].matches).toBe(1);
    expect(searchManual(chapters, '<script>')).toHaveLength(0);
    expect(searchManual(chapters, '  ')[0].html).toBe(chapters[0].html);
  });

  it('фильтрует главы по тексту, показывает контекст и переводит фокус на найденное место', () => {
    render(<StoreProvider initial={{ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } }}><MemoryRouter initialEntries={['/info']}><AppRoutes /></MemoryRouter></StoreProvider>);
    const input = screen.getByRole('searchbox', { name: 'Поиск по содержанию разделов' });
    fireEvent.change(input, { target: { value: 'Windows' } });
    const toc = screen.getByRole('complementary', { name: 'Содержание' });
    const links = within(toc).getAllByRole('link');
    expect(links.length).toBeLessThan(17);
    expect(document.querySelectorAll('.info-doc .info-match').length).toBeGreaterThan(0);
    expect(document.querySelector('.info-snippet')).not.toBeNull();
    const target = document.getElementById(links[0].getAttribute('href')!.slice(1))!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    fireEvent.click(links[0]);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    fireEvent.change(input, { target: { value: 'неттакогослова123' } });
    expect(within(toc).queryByRole('link')).toBeNull();
    expect(screen.getByText(/ничего не найдено/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(toc).getAllByRole('link')).toHaveLength(17);
    expect(document.querySelector('.info-match')).toBeNull();
  });

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
    expect(all).toContain('src="/x/12-filter-dropdown.png"');
    expect(all).not.toContain('src="shots/');
  });

  it('светлый вариант скриншота лежит рядом с тёмным', () => {
    expect(lightShot('07-control.png')).toBe('07-control.light.png');
    const light = parseManual(raw, { version: '1', tests: 1, shotUrl: (f) => `/x/${lightShot(f)}` }).map((c) => c.html).join('');
    expect(light).toContain('src="/x/12-filter-dropdown.light.png"');
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

  it('предлагает скачать инструкцию по публикации в IIS', () => {
    // Ссылка на PDF инструкции прописывается сборкой docs/build-iis-guide.mjs и ведёт на файл в public/manual.
    expect(meta.iisPdf).toMatch(/^\/manual\/Kontrol-zadach-IIS-v\d+\.\d+\.\d+\.pdf$/);
    render(
      <StoreProvider initial={{ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } }}>
        <MemoryRouter initialEntries={['/info']}>
          <AppRoutes />
        </MemoryRouter>
      </StoreProvider>,
    );
    const link = screen.getByRole('link', { name: /Инструкция по публикации в IIS/ });
    expect(link).toHaveAttribute('href', meta.iisPdf);
    expect(link).toHaveAttribute('download');
  });
});
