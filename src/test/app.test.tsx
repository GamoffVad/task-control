import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { createSeed } from '../lib/seed';
import { loadState, STORAGE_KEY } from '../lib/store';
import { StoreProvider } from '../lib/StoreProvider';
import type { AppState } from '../lib/types';

// Основные тесты проверяют демоотдел из 7 человек; большой отдел — в bigdept.test.tsx.
vi.mock('../lib/staff', async (original) => ({ ...(await original<typeof import('../lib/staff')>()), STAFF_USERS: [] }));

// Демоданные строятся от текущей даты, а неделя плана начинается в пятницу —
// фиксируем «сегодня» (четверг), чтобы тесты не зависели от дня запуска. Таймеры остаются настоящими.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 17, 12, 0));
});
afterAll(() => vi.useRealTimers());

const loggedIn = (): AppState => ({ ...createSeed(), user: { email: 'user@example.com', employeeId: 1, role: 'administrator' } });
const executorIn = (): AppState => ({ ...createSeed(), user: { email: 'sidorov@example.com', employeeId: 3, role: 'executor' } });

const renderAt = (path: string, state: AppState = loggedIn()) =>
  render(
    <StoreProvider initial={state}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </StoreProvider>,
  );

describe('вход', () => {
  it('без входа перенаправляет на форму входа', () => {
    renderAt('/planning', createSeed());
    expect(screen.getByRole('heading', { name: 'Вход в систему' })).toBeInTheDocument();
  });

  it('показывает ошибку при неверном пароле и пускает с верным', async () => {
    const user = userEvent.setup();
    renderAt('/planning', createSeed());
    await user.type(screen.getByLabelText('Логин'), 'user@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: /Войти/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Неверный логин или пароль');

    await user.clear(screen.getByLabelText('Пароль'));
    await user.type(screen.getByLabelText('Пароль'), '123456');
    await user.click(screen.getByRole('button', { name: /Войти/ }));
    // Возврат на страницу, с которой пришли.
    expect(await screen.findByRole('heading', { name: 'Планирование' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).user.employeeId).toBe(1);
  });

  it('выход возвращает на форму входа', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(screen.getByRole('heading', { name: 'Вход в систему' })).toBeInTheDocument();
  });
});

describe('разделы', () => {
  it.each([
    ['/calendar', 'Календарь'],
    ['/planning', 'Планирование'],
    ['/control', 'Контроль исполнения'],
    ['/reports', 'Отчётность'],
    ['/kpi', 'Показатели эффективности'],
    ['/employees/3', 'Сидоров Дмитрий Евгеньевич'],
    ['/chat', 'Переписка'],
    ['/nowhere', 'Страница не найдена'],
  ])('%s открывается', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('/employees открывает карточку вошедшего сотрудника', () => {
    renderAt('/employees');
    expect(screen.getByRole('heading', { level: 1, name: 'Иванов Алексей Борисович' })).toBeInTheDocument();
  });

  it('несуществующий сотрудник — понятное сообщение', () => {
    renderAt('/employees/99');
    expect(screen.getByRole('heading', { name: 'Сотрудник не найден' })).toBeInTheDocument();
  });
});

describe('задачи', () => {
  it('создаёт задачу из календаря и проверяет форму', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    await user.click(screen.getByRole('button', { name: /Новая задача/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(within(dialog).getByText('Введите название задачи.')).toBeInTheDocument();
    expect(within(dialog).getByText('Выберите хотя бы одного исполнителя.')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Название'), 'Проверить сборку');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Сидоров Д.Е.' }));
    const doneBox = within(dialog).getByRole('checkbox', { name: /Отметка доступна/ });
    expect(doneBox).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(loadState().tasks.some((t) => t.title === 'Проверить сборку' && t.assigneeIds[0] === 3)).toBe(true);
  });

  it('отмечает исполнение только после описания результата', async () => {
    const user = userEvent.setup();
    renderAt('/control');
    const overdue = screen.getByRole('region', { name: 'Просроченные' });
    const card = within(overdue).getAllByRole('button').find((b) => b.classList.contains('task-card'))!;
    const title = card.querySelector('.title')!.textContent!;
    await user.click(card);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Результат исполнения'), 'Сделано');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Отметить как исполненное' }));
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(within(overdue).queryByText(title)).not.toBeInTheDocument();
  });

  it('удаляет задачу после подтверждения', async () => {
    const user = userEvent.setup();
    renderAt('/employees/7');
    const before = loadState().tasks.length || createSeed().tasks.length;
    const titleBtn = screen.getByRole('button', { name: 'Обновить руководство пользователя' });
    await user.click(titleBtn);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Удалить/ }));
    expect(within(dialog).getByRole('button', { name: /Точно удалить/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Точно удалить/ }));
    expect(screen.queryByRole('button', { name: 'Обновить руководство пользователя' })).not.toBeInTheDocument();
    expect(loadState().tasks.length).toBe(before - 1);
  });

  it('добавляет в ячейку матрицы несколько задач: «+ задача» остаётся под первой', async () => {
    const user = userEvent.setup();
    renderAt('/planning');
    const addIn = (n: number) =>
      screen.getByRole('button', { name: `Добавить задачу — 3.6 Резервное копирование, Сердюк С.О. (задач: ${n})` });
    await user.click(addIn(0));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Сердюк С.О.' })).toHaveAttribute('aria-checked', 'true');
    await user.type(within(dialog).getByLabelText('Название'), 'Копия почтового сервера');
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));

    const more = addIn(1);
    expect(more).toHaveClass('more');
    expect(more.closest('td')).toHaveTextContent('Копия почтового сервера');
    await user.click(more);
    dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Название'), 'Копия файлового сервера');
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    const cell = addIn(2).closest('td')!;
    expect(cell.querySelectorAll('.chip')).toHaveLength(2);
  });
});

describe('отчёт и показатели', () => {
  it('отправляет отчёт из планирования и показывает его в отчётности', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/planning');
    await user.click(screen.getByRole('button', { name: /Направить в отчёт/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Отчёт отправлен: \d+ запис/);
    expect(screen.getByRole('button', { name: /Обновить отчёт/ })).toBeInTheDocument();
    unmount();

    renderAt('/reports', loadState());
    await user.click(screen.getByRole('button', { name: 'Неделя: вперёд' }));
    expect(screen.getByText(/получен/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Итого баллов' })).toBeInTheDocument();
  });

  it('отчёт прошлой недели доступен сразу', () => {
    renderAt('/reports');
    expect(screen.getByRole('button', { name: /Выгрузить CSV/ })).toBeEnabled();
    expect(screen.getByText('Документы внесены, проверены и подписаны')).toBeInTheDocument();
  });

  it('баллы за исполнение задаются в карточке задачи и попадают в отчёт', async () => {
    const user = userEvent.setup();
    renderAt('/planning');
    expect(screen.queryByRole('textbox', { name: /Вес позиции/ })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Провести планёрку/ })[0]);
    let dialog = screen.getByRole('dialog');
    const score = within(dialog).getByLabelText('Баллы за исполнение');
    expect(score).toHaveValue('5');
    expect(within(dialog).getByRole('button', { name: /Сбросить к базовому/ })).toBeDisabled();
    await user.clear(score);
    await user.type(score, '9');
    expect(within(dialog).getByText(/изменено/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    await user.click(screen.getByRole('button', { name: /Направить в отчёт/ }));
    const report = loadState().reports.at(-1)!;
    expect(report.entries.filter((e) => e.rowId === '1.2').every((e) => e.score === 9)).toBe(true);

    await user.click(screen.getAllByRole('button', { name: /Провести планёрку/ })[0]);
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Сбросить к базовому/ }));
    expect(within(dialog).getByLabelText('Баллы за исполнение')).toHaveValue('5');
    await user.clear(within(dialog).getByLabelText('Баллы за исполнение'));
    await user.type(within(dialog).getByLabelText('Баллы за исполнение'), '99');
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(within(dialog).getByText('Баллы — число от 0,1 до 15.')).toBeInTheDocument();
  });

  it('переключает период показателей', async () => {
    const user = userEvent.setup();
    renderAt('/kpi');
    await user.click(screen.getByRole('button', { name: 'Месяц' }));
    expect(screen.getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('region', { name: 'Баллы по сотрудникам' })).getAllByRole('link')).toHaveLength(7);
  });
});

describe('переписка', () => {
  it('отправляет сообщение по Enter', async () => {
    const user = userEvent.setup();
    renderAt('/chat');
    const box = screen.getByLabelText('Сообщение');
    await user.type(box, 'Всем привет{Enter}');
    expect(screen.getByText('Всем привет')).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect(screen.getByRole('button', { name: /Отправить/ })).toBeDisabled();
  });

  it('показывает непрочитанные в меню и разделитель «Новые сообщения»', async () => {
    const state = loggedIn();
    const last = state.messages.filter((m) => m.authorId !== 1).at(-1)!;
    // Прочитано всё, кроме последнего чужого сообщения.
    state.chatReads = [{ employeeId: 1, readAt: new Date(new Date(last.sentAt).getTime() - 1000).toISOString() }];
    const { unmount } = renderAt('/control', state);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(nav).getByLabelText('непрочитанных сообщений: 1')).toHaveTextContent('1');
    unmount();
    renderAt('/chat', state);
    expect(screen.getByRole('separator', { name: 'Новые сообщения' })).toHaveTextContent('Новые сообщения · 1');
    // Открытая переписка считается прочитанной: счётчик пропадает, разделитель остаётся до ухода со страницы.
    expect(within(screen.getByRole('navigation', { name: 'Разделы' })).queryByLabelText(/непрочитанных сообщений/)).toBeNull();
    expect(screen.getByRole('separator', { name: 'Новые сообщения' })).toBeInTheDocument();
  });
});

describe('категории из словаря', () => {
  const withNewCategory = (): AppState => {
    const st = loggedIn();
    st.dictionaries = [...st.dictionaries, { id: 'dict-cat-plan', dictionary: 'taskCategory', code: 'deptPlan', title: 'План отдела', color: '#7A5312' }];
    return st;
  };

  it('добавленная в словаре категория появляется в фильтрах и в окне задачи', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/calendar', withNewCategory());
    await user.click(screen.getByRole('button', { name: /^Категории мероприятий: все категории/ }));
    expect(screen.getByRole('option', { name: 'План отдела' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // В окне задачи — в выпадающем списке категории.
    await user.click(screen.getByRole('button', { name: /Новая задача/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Категория:/ }));
    expect(screen.getByRole('option', { name: 'План отдела' })).toBeInTheDocument();
    unmount();

    renderAt('/control', withNewCategory());
    await user.click(screen.getByRole('button', { name: /^Категории задач: все категории/ }));
    expect(screen.getByRole('option', { name: 'План отдела' })).toBeInTheDocument();
  });
});

describe('контроль: фильтры и выгрузка', () => {
  it('по умолчанию на доске задачи в работе; исполненные добавляются отметкой и видны бледными', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/control');
    const cards = () => [...container.querySelectorAll('.task-card')];
    expect(cards().length).toBeGreaterThan(0);
    expect(cards().some((c) => c.classList.contains('done'))).toBe(false);
    await user.click(screen.getByRole('button', { name: /^Исполнение: В работе$/ }));
    await user.click(screen.getByRole('option', { name: 'Исполненные' }));
    await user.keyboard('{Escape}');
    expect(cards().some((c) => c.classList.contains('done'))).toBe(true);
    expect(cards().some((c) => !c.classList.contains('done'))).toBe(true);
  });

  it('фильтры категорий и сроков убирают карточки и колонки', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/control');
    const cards = () => container.querySelectorAll('.task-card').length;
    const all = cards();
    await user.click(screen.getByRole('button', { name: /^Категории задач: все категории/ }));
    await user.click(screen.getByRole('option', { name: 'Иное' }));
    await user.keyboard('{Escape}');
    expect(cards()).toBeLessThan(all);

    expect(screen.getByRole('region', { name: 'Просроченные' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Сроки: все сроки/ }));
    await user.click(screen.getByRole('option', { name: 'Просроченные' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Просроченные' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Сегодня' })).toBeInTheDocument();
  });

  it('кнопка выгрузки в Word сохраняет файл', async () => {
    const user = userEvent.setup();
    const saved: { name: string; type: string; size: number }[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, type: 'a', size: 1 });
    };
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => undefined;
    try {
      renderAt('/control');
      await user.click(screen.getByRole('button', { name: /Выгрузить в Word/ }));
      expect(saved).toEqual([expect.objectContaining({ name: expect.stringMatching(/^kontrol-\d{4}-\d{2}-\d{2}\.doc$/) })]);
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
  });
});

describe('выпадающий список', () => {
  it('фильтрует доску по сотруднику и закрывается по Escape', async () => {
    const user = userEvent.setup();
    renderAt('/control');
    await user.click(screen.getByRole('button', { name: /^Сотрудник: Все сотрудники/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Сотрудник: Все сотрудники/ }));
    await user.click(screen.getByRole('option', { name: 'Смирнова О.Л.' }));
    const cards = document.querySelectorAll('.task-card');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(c).toHaveTextContent('Смирнова О.Л.'));
  });
});

describe('планирование: фильтр по группе', () => {
  it('сужает матрицу до группы и сбрасывает сотрудника из другой группы', async () => {
    const user = userEvent.setup();
    renderAt('/planning');
    const heads = () => screen.getAllByRole('columnheader').slice(1).map((h) => h.textContent?.replace(/[А-ЯЁа-яё ]+$/u, ''));
    expect(heads()).toHaveLength(7);

    await user.click(screen.getByRole('button', { name: /^Группа: Весь отдел/ }));
    await user.click(screen.getByRole('option', { name: 'Проектная группа 1' }));
    expect(heads()).toEqual(['Сидоров Д.Е.', 'Кузнецов М.П.']);

    // В списке сотрудников — только группа.
    await user.click(screen.getByRole('button', { name: /^Сотрудник: Вся группа/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Вся группа', 'Сидоров Д.Е.', 'Кузнецов М.П.']);
    await user.click(screen.getByRole('option', { name: 'Кузнецов М.П.' }));
    expect(heads()).toEqual(['Кузнецов М.П.']);

    await user.click(screen.getByRole('button', { name: /^Группа: Проектная группа 1/ }));
    await user.click(screen.getByRole('option', { name: 'Проектная группа 2' }));
    expect(heads()).toEqual(['Петренко П.А.', 'Сердюк С.О.']);
    expect(screen.getByRole('button', { name: /^Сотрудник: Вся группа/ })).toBeInTheDocument();
  });

  it('исполнитель фильтра групп не видит', () => {
    renderAt('/planning', executorIn());
    expect(screen.queryByRole('button', { name: /^Группа:/ })).not.toBeInTheDocument();
  });
});

describe('метки отсутствия у фамилий', () => {
  it('в «Планировании» у сотрудника в отпуске — красная метка, в карточке — тоже', () => {
    const { unmount } = renderAt('/planning');
    const petrov = screen.getAllByRole('columnheader').find((h) => h.textContent?.startsWith('Петров В.С.'))!;
    expect(within(petrov).getByRole('img', { name: /^отпуск · с 14\.09\. Ежегодный отпуск: 14\.09–25\.09/ })).toHaveClass('absent-dot');
    const ivanov = screen.getAllByRole('columnheader').find((h) => h.textContent?.startsWith('Иванов А.Б.'))!;
    expect(ivanov.querySelector('.absent-dot')).toBeNull();
    unmount();
    renderAt('/employees/2');
    expect(screen.getByText(/^отпуск · до /)).toHaveClass('absent-tag');
    // В списке сотрудников — точка у фамилии Петрова, у Иванова — нет.
    const tree = screen.getByRole('complementary', { name: 'Структура подразделения' });
    expect(within(tree).getByRole('link', { name: /Петров В\.С\./ }).querySelector('.absent-dot')).not.toBeNull();
    expect(within(tree).getByRole('link', { name: /Иванов А\.Б\./ }).querySelector('.absent-dot')).toBeNull();
  });
});

describe('планирование: выгрузка и документ', () => {
  it('открывает документ по шаблону с мероприятиями недели', async () => {
    const user = userEvent.setup();
    renderAt('/planning');
    expect(screen.queryByRole('button', { name: /Выгрузить CSV/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Документ' }));
    const dialog = screen.getByRole('dialog', { name: 'Документ по шаблону' });
    expect(within(dialog).getByLabelText('Текст документа')).toHaveTextContent(/ПЛАН МЕРОПРИЯТИЙ/);
    expect(within(dialog).getByRole('button', { name: /Скачать CSV/ })).toBeEnabled();
    // В «Планировании» — только шаблоны планирования.
    await user.click(within(dialog).getByRole('button', { name: /^Шаблон документа:/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['План мероприятий на неделю']);
  });

  it('в «Отчётности» документ собирается из отправленного отчёта', async () => {
    const user = userEvent.setup();
    renderAt('/reports');
    await user.click(screen.getByRole('button', { name: /^Неделя: назад/ }));
    await user.click(screen.getByRole('button', { name: 'Документ' }));
    const dialog = screen.getByRole('dialog', { name: 'Документ по шаблону' });
    const text = within(dialog).getByLabelText('Текст документа');
    expect(text).toHaveTextContent(/СПРАВКА/);
    expect(text).toHaveTextContent(/Итоги по сотрудникам/);
    expect(text).toHaveTextContent(/исполнено в срок/);
    expect(within(dialog).getByRole('button', { name: /Скачать CSV/ })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: /^Шаблон документа:/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Справка об исполнении']);
  });
});

describe('календарь: поиск и категории', () => {
  it('ищет по содержанию и переходит к найденной задаче', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    await user.type(screen.getByLabelText('Поиск мероприятий по содержанию'), 'коммутатор');
    const results = screen.getByRole('region', { name: 'Результаты поиска' });
    expect(within(results).getByRole('status')).toHaveTextContent('Найдено: 1');
    await user.click(within(results).getByRole('button', { name: /Модернизация/ }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Название')).toHaveValue('Модернизация коммутаторов на 3 этаже');
  });

  it('сообщает, если ничего не найдено', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    await user.type(screen.getByLabelText('Поиск мероприятий по содержанию'), 'несуществующее');
    expect(screen.getByText(/Ничего не найдено/)).toBeInTheDocument();
  });

  it('скрывает и показывает категории выпадающим списком', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    const events = () => document.querySelectorAll('.cal-event').length;
    const all = events();
    await user.click(screen.getByRole('button', { name: /^Категории мероприятий: все категории/ }));
    await user.click(screen.getByRole('option', { name: 'Иное' }));
    expect(events()).toBeLessThan(all);
    expect(screen.getByRole('button', { name: /^Категории мероприятий: .*4 из 5/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'все категории' }));
    expect(events()).toBe(all);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('вошедший сотрудник получает свою тему и своё оформление', async () => {
    localStorage.clear();
    // У руководителя (1) светлая тема и красный акцент, у исполнителя (3) — тёмная без правок.
    localStorage.setItem('task-control:theme:1', 'light');
    localStorage.setItem('task-control:theme:3', 'dark');
    localStorage.setItem('task-control:appearance:1', JSON.stringify({ light: { accent: '#a32d22' } }));
    const css = () => [...document.querySelectorAll('style')].map((st) => st.textContent).join(' ');

    const first = renderAt('/calendar', loggedIn());
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(css()).toContain('--accent: #a32d22;');
    first.unmount();

    renderAt('/calendar', executorIn());
    expect(document.documentElement.dataset.theme).toBe('dark');
    // Оформление первого сотрудника у второго не появляется.
    expect(css()).not.toContain('--accent: #a32d22;');
    localStorage.clear();
  });

  it('переключение темы запоминается за сотрудником', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    renderAt('/calendar', executorIn());
    const before = document.documentElement.dataset.theme;
    await user.click(screen.getByRole('button', { name: /Включить .* тему/ }));
    const after = document.documentElement.dataset.theme;
    expect(after).not.toBe(before);
    expect(localStorage.getItem('task-control:theme:3')).toBe(after);
    // Чужой личный ключ не тронут.
    expect(localStorage.getItem('task-control:theme:1')).toBeNull();
    localStorage.clear();
  });

  it('переключатель «Светлая / Тёмная» в редакторе включает тему во всём приложении и следует за шапкой', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(screen.getByRole('button', { name: 'Редактирование UI' }));
    const group = screen.getByRole('group', { name: 'Тема, цвета которой правятся' });
    const pressed = (name: string) => within(group).getByRole('button', { name }).getAttribute('aria-pressed');
    // Стартуем на тёмной: она и выбрана.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(pressed('Тёмная')).toBe('true');

    // Выбор «Светлая» включает светлую тему во всём приложении и запоминает её за сотрудником.
    await user.click(within(group).getByRole('button', { name: 'Светлая' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('task-control:theme:1')).toBe('light');
    expect(pressed('Светлая')).toBe('true');

    // Переключатель в шапке возвращает тёмную — и выбор в редакторе следует за ним.
    await user.click(screen.getByRole('button', { name: /Включить тёмную тему/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(pressed('Тёмная')).toBe('true');
    localStorage.clear();
  });

  it('у каждой вкладки администрирования своё разрешение', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(screen.getByRole('button', { name: 'Роли и разрешения' }));
    // Список разрешений покрывает все девять вкладок, включая «Редактирование UI».
    for (const label of [
      'Открывать администрирование',
      'Пользователи: вести и назначать роли',
      'Подразделения: вести дерево',
      'Роли и разрешения: настраивать',
      'Аутентификация: настраивать способ входа',
      'Оценка: настраивать правила подсчёта баллов',
      'Словари: редактировать значения',
      'Разделы планирования: вести план',
      'Шаблоны документов: редактировать',
      'Редактирование UI: настраивать своё оформление',
    ]) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
  });

  it('редактор оформления меняет цвет и возвращает его по умолчанию', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(screen.getByRole('button', { name: 'Редактирование UI' }));
    // Редактор открывается на теме страницы; в тестах это тёмная.
    const trigger = screen.getByRole('button', { name: 'Цвет: Акцент: #93B9F0' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: '#A32D22' }));
    // Переопределение попадает в правило своей темы вместе со спутником «-rgb».
    const css = () => [...document.querySelectorAll('style')].map((s) => s.textContent).join(' ');
    expect(css()).toContain("[data-theme='dark']");
    expect(css()).toContain('--accent: #a32d22;');
    expect(css()).toContain('--accent-rgb: 163 45 34;');
    const row = trigger.closest('.ui-color')!;
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'по умолчанию' }));
    expect(css()).not.toContain('--accent: #a32d22;');
  });

  it('размер текста ограничивается допустимыми значениями', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(screen.getByRole('button', { name: 'Редактирование UI' }));
    // Ползунок доходит до края клавишей End — дальше границы он не пускает.
    const slider = screen.getByRole('slider', { name: 'Основной текст, пикселей' });
    fireEvent.keyDown(slider, { key: 'End' });
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join(' ');
    expect(css).toContain('--size-base: 20px;');
    expect(slider).toHaveAttribute('aria-valuenow', '20');
    // Образец набран тем же размером.
    expect(screen.getByText('Согласовать бюджет и обновить смету')).toHaveStyle({ fontSize: '20px' });
  });

  it('состояние мероприятия видно по классам: исполнено, просрочено, исполнитель отсутствует', () => {
    renderAt('/calendar');
    const events = [...document.querySelectorAll('.cal-event')];
    expect(events.length).toBeGreaterThan(0);
    // Исполнено и просрочено исключают друг друга: у события не может быть обоих состояний.
    expect(events.every((e) => !(e.classList.contains('done') && e.classList.contains('overdue')))).toBe(true);
    // Отсутствие исполнителя отмечается только у неисполненных.
    expect(events.filter((e) => e.classList.contains('absent')).every((e) => !e.classList.contains('done'))).toBe(true);
  });

  it('исполнитель виден на каждом мероприятии календаря', () => {
    renderAt('/calendar');
    const events = [...document.querySelectorAll('.cal-event')];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const who = event.querySelector('.who');
      expect(who).not.toBeNull();
      expect(who!.textContent!.replace(/[·\s]/g, '').length).toBeGreaterThan(3);
    }
  });

  it('подсказка мероприятия называет исполнителя и состояние', () => {
    renderAt('/calendar');
    const tips = [...document.querySelectorAll('.cal-event')].map((e) => e.getAttribute('data-tip') ?? '');
    expect(tips.some((t) => t.includes('Просрочено'))).toBe(true);
    expect(tips.every((t) => t.includes(' · '))).toBe(true);
  });

  it('задаёт категорию в карточке задачи', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    await user.click(screen.getByRole('button', { name: /Новая задача/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Название'), 'Доклад о ходе работ');
    await user.click(within(dialog).getByRole('button', { name: /^Категория:/ }));
    await user.click(within(dialog).getByRole('option', { name: 'Доклад руководству ведомства' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Иванов А.Б.' }));
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(loadState().tasks.at(-1)).toMatchObject({ title: 'Доклад о ходе работ', category: 'reportAgency' });
  });
});

describe('исполнитель', () => {
  it('не видит отчётность, показатели и сброс данных', () => {
    renderAt('/calendar', executorIn());
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(nav).queryByRole('link', { name: 'Отчётность' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Показатели' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Моя карточка' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /демонстрационные данные/ })).not.toBeInTheDocument();
  });

  it.each(['/reports', '/kpi'])('%s перенаправляет в календарь', (path) => {
    renderAt(path, executorIn());
    expect(screen.getByRole('heading', { level: 1, name: 'Календарь' })).toBeInTheDocument();
  });

  it('в планировании видит только свой столбец и не отправляет отчёт', () => {
    renderAt('/planning', executorIn());
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Разделы планирования', 'Сидоров Д.Е.Ведущий специалист']);
    expect(screen.queryByRole('button', { name: /Направить в отчёт/ })).not.toBeInTheDocument();
  });

  it('в своей задаче меняет только исполнение, баллы не редактирует', async () => {
    const user = userEvent.setup();
    renderAt('/control', executorIn());
    await user.click(screen.getByRole('button', { name: /Проверить резервные копии/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('note')).toHaveTextContent('Содержание и сроки задачи определяет руководитель');
    expect(within(dialog).getByLabelText('Название')).toHaveAttribute('readonly');
    // Исполнитель баллы в окне задачи не видит — только в своей карточке.
    expect(within(dialog).queryByLabelText('Баллы за исполнение')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Результат исполнения'), 'Копии проверены');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Отметить как исполненное' }));
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(loadState().tasks.find((t) => t.title === 'Проверить резервные копии баз данных')).toMatchObject({ done: true, result: 'Копии проверены' });
  });

  it('чужую задачу только просматривает', async () => {
    const user = userEvent.setup();
    renderAt('/calendar', executorIn());
    await user.click(screen.getByRole('button', { name: /^Сотрудник: / }));
    await user.click(screen.getByRole('option', { name: 'Все сотрудники' }));
    await user.click(screen.getAllByRole('button', { name: /Исправить ошибки в модуле отчётов/ })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('note')).toHaveTextContent('доступен только просмотр');
    expect(within(dialog).queryByRole('button', { name: /Сохранить/ })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Результат исполнения')).toHaveAttribute('readonly');
    expect(dialog).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('контроль показывает только свои задачи, карточка — только своя', () => {
    const { unmount } = renderAt('/control', executorIn());
    const cards = document.querySelectorAll('.task-card');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(c).toHaveTextContent('Сидоров Д.Е.'));
    expect(screen.queryByRole('button', { name: /^Сотрудник:/ })).not.toBeInTheDocument();
    unmount();
    renderAt('/employees/7', executorIn());
    expect(screen.getByRole('heading', { level: 1, name: 'Сидоров Дмитрий Евгеньевич' })).toBeInTheDocument();
  });

  it('входит как исполнитель', async () => {
    const user = userEvent.setup();
    renderAt('/login', createSeed());
    await user.type(screen.getByLabelText('Логин'), 'sidorov@example.com');
    await user.type(screen.getByLabelText('Пароль'), '123456');
    await user.click(screen.getByRole('button', { name: /Войти/ }));
    expect(await screen.findByText(/исполнитель/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).user).toMatchObject({ employeeId: 3, role: 'executor' });
  });
});

describe('тема', () => {
  it('по умолчанию тёмная, переключается на светлую и запоминается', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('task-control:theme');
    renderAt('/calendar');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Включить светлую тему' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('task-control:theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Включить тёмную тему' })).toBeInTheDocument();
  });
});

describe('администрирование', () => {
  it('администратор управляет пользователями, словарями и позициями плана, исполнитель не открывает раздел', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/admin');
    expect(screen.getByRole('heading', { name: 'Администрирование' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Администрирование' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Пользователи' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Аутентификация' })).toBeInTheDocument();
    expect(screen.getByText('Иванов Алексей Борисович')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Добавить пользователя' }));
    const addDialog = screen.getByRole('dialog', { name: 'Добавить сотрудника' });
    await user.type(within(addDialog).getByRole('combobox', { name: /ФИО/ }), 'Кудр');
    await user.click(await within(addDialog).findByRole('option', { name: /Кудрявцев Олег Игоревич/ }));
    expect(within(addDialog).getByDisplayValue('kudryavtsev.oi')).toBeInTheDocument();
    await user.click(within(addDialog).getByRole('button', { name: 'Добавить' }));
    expect(screen.getByText('Кудрявцев Олег Игоревич')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Редактировать пользователя Сидоров Дмитрий Евгеньевич' }));
    const editDialog = screen.getByRole('dialog', { name: 'Редактировать сотрудника' });
    const login = within(editDialog).getByLabelText('Windows-логин');
    await user.clear(login);
    await user.type(login, 'sidorov-ad');
    // Правятся и личные данные: ФИО, должность и почта — без Active Directory.
    const fullName = within(editDialog).getByLabelText('ФИО');
    await user.clear(fullName);
    await user.type(fullName, 'Сидоров Дмитрий Евгеньевич-Второй');
    const position = within(editDialog).getByLabelText('Должность');
    await user.clear(position);
    await user.type(position, 'Главный специалист');
    await user.click(within(editDialog).getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('sidorov-ad')).toBeInTheDocument();
    expect(screen.getByText('Сидоров Дмитрий Евгеньевич-Второй')).toBeInTheDocument();
    expect(screen.getByText('Главный специалист')).toBeInTheDocument();
    expect(loadState().users.find((u) => u.employeeId === 3)).toMatchObject({ fullName: 'Сидоров Дмитрий Евгеньевич-Второй', position: 'Главный специалист', windowsLogin: 'sidorov-ad' });

    await user.click(screen.getByRole('button', { name: 'Удалить пользователя Кудрявцев Олег Игоревич' }));
    const deleteDialog = screen.getByRole('dialog', { name: 'Удалить пользователя?' });
    expect(within(deleteDialog).getByText(/потеряет доступ/)).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole('button', { name: 'Удалить' }));
    expect(screen.queryByText('Кудрявцев Олег Игоревич')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Аутентификация' }));
    expect(screen.getByRole('heading', { name: 'Способ входа' })).toBeInTheDocument();
    // Режим Windows выбирается всегда; когда сервер не настроен, об этом пишет подсказка и проверка настройки.
    expect(screen.getByRole('radio', { name: /Windows/ })).toBeEnabled();
    expect(screen.getByText('Windows не настроен')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить настройку' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Словари' }));
    // Значения справочника добавляются и меняются через форму в окне.
    await user.click(screen.getByRole('button', { name: 'Добавить значение' }));
    const dictDialog = screen.getByRole('dialog', { name: 'Добавить значение' });
    await user.type(within(dictDialog).getByLabelText('Код'), 'review');
    await user.type(within(dictDialog).getByLabelText('Название'), 'Внутренняя проверка');
    await user.click(within(dictDialog).getByRole('button', { name: 'Добавить' }));
    expect(screen.getByText('Внутренняя проверка')).toBeInTheDocument();
    // Виды отсутствий: цвет выбирается в форме и сразу применяется к --abs-<код>.
    await user.click(screen.getByText('Виды отсутствий'));
    await user.click(screen.getByRole('button', { name: 'Изменить значение Отпуск' }));
    const colorDialog = screen.getByRole('dialog', { name: 'Изменить значение' });
    // Цвет выбирается в своей панели: сначала открываем её, потом берём образец из палитры.
    await user.click(within(colorDialog).getByRole('button', { name: /^Цвет вида отсутствия:/ }));
    await user.click(within(colorDialog).getByRole('option', { name: '#2C6B45' }));
    await user.click(within(colorDialog).getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('#2C6B45')).toBeInTheDocument();
    expect([...document.querySelectorAll('style')].some((st) => st.textContent?.includes('--abs-vacation: #2C6B45'))).toBe(true);
    // Категории задач: цвет применяется к --cat-<код> (карточки Календаря, точки, фильтр).
    await user.click(screen.getByText('Категории задач'));
    await user.click(screen.getByRole('button', { name: 'Изменить значение Доклад руководству отдела' }));
    const catDialog = screen.getByRole('dialog', { name: 'Изменить значение' });
    await user.click(within(catDialog).getByRole('button', { name: /^Цвет категории:/ }));
    expect(within(catDialog).getByRole('option', { name: '#2F5480' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(catDialog).getByRole('option', { name: '#A35A1F' }));
    await user.click(within(catDialog).getByRole('button', { name: 'Сохранить' }));
    expect([...document.querySelectorAll('style')].some((st) => st.textContent?.includes('--cat-reportDept: #A35A1F'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Разделы планирования' }));
    await user.click(screen.getByRole('button', { name: 'Добавить позицию' }));
    const planDialog = screen.getByRole('dialog', { name: 'Добавить позицию' });
    // Родитель выбирается из разделов, код собирается сам: следующий номер в разделе «1».
    await user.click(within(planDialog).getByRole('button', { name: /^Родитель:/ }));
    await user.click(screen.getByRole('option', { name: /Организационные мероприятия/ }));
    expect(within(planDialog).getByText('1.4')).toBeInTheDocument();
    await user.type(within(planDialog).getByLabelText('Название'), 'Работа с обращениями');
    await user.click(within(planDialog).getByRole('button', { name: 'Добавить' }));
    expect(screen.getByText('Работа с обращениями')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Редактировать позицию 1.4 Работа с обращениями' }));
    const editPlanDialog = screen.getByRole('dialog', { name: 'Редактировать позицию' });
    const planTitle = within(editPlanDialog).getByLabelText('Название');
    await user.clear(planTitle);
    await user.type(planTitle, 'Работа с обращениями граждан');
    // Перенос в другой раздел.
    await user.click(within(editPlanDialog).getByRole('button', { name: /^Родитель:/ }));
    await user.click(screen.getByRole('option', { name: /Финансово-хозяйственная деятельность/ }));
    expect(within(editPlanDialog).getByText('2.3')).toBeInTheDocument();
    await user.click(within(editPlanDialog).getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('button', { name: 'Редактировать позицию 2.3 Работа с обращениями граждан' })).toBeInTheDocument();
    // Свёртывание раздела скрывает вложенные позиции.
    await user.click(screen.getByRole('button', { name: 'Свернуть раздел 2' }));
    expect(screen.queryByText('Работа с обращениями граждан')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Развернуть раздел 2' }));
    await user.click(screen.getByRole('link', { name: 'Планирование' }));
    expect(screen.getByText('Работа с обращениями граждан')).toBeInTheDocument();

    unmount();
    // Исполнитель тоже открывает раздел, но видит в нём только своё оформление.
    renderAt('/admin', executorIn());
    expect(screen.getByRole('heading', { name: 'Администрирование' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Администрирование' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Редактирование UI' })).toBeInTheDocument();
    for (const tab of ['Пользователи', 'Подразделения', 'Роли и разрешения', 'Аутентификация', 'Оценка', 'Словари', 'Разделы планирования', 'Шаблоны документов']) {
      expect(screen.queryByRole('button', { name: tab }), tab).toBeNull();
    }
    expect(screen.getByRole('heading', { name: 'Редактирование UI' })).toBeInTheDocument();
  });
});

describe('версия', () => {
  it('показывает версию из package.json в подвале и на экране входа', async () => {
    const { version } = (await import('../../package.json')).default;
    const { unmount } = renderAt('/calendar');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`версия ${version}`);
    unmount();
    renderAt('/login', createSeed());
    expect(screen.getByText(version)).toBeInTheDocument();
  });
});

describe('баллы', () => {
  it('в планировании нет колонки баллов, руководитель видит баллы в окне задачи', async () => {
    const user = userEvent.setup();
    renderAt('/planning');
    expect(screen.queryByRole('columnheader', { name: 'Баллы' })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Провести планёрку/ })[0]);
    expect(within(screen.getByRole('dialog')).getByLabelText('Баллы за исполнение')).toHaveValue('5');
  });

  it('у задачи вне плана поле баллов пустое и неактивно, категория — «Иное»', async () => {
    const user = userEvent.setup();
    renderAt('/calendar');
    await user.click(screen.getByRole('button', { name: /Новая задача/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /^Раздел планирования: Вне плана/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Категория: Иное/ })).toBeInTheDocument();
    const score = within(dialog).getByLabelText('Баллы за исполнение');
    expect(score).toBeDisabled();
    expect(score).toHaveValue('');
    expect(score).toHaveAccessibleDescription('Базовый вес позиции указывается только за задачи из основных категорий.');
  });

  it('исполнитель видит свои баллы в карточке сотрудника', () => {
    renderAt('/employees/3', executorIn());
    expect(screen.getByText('Баллы')).toBeInTheDocument();
    expect(screen.getByText('К среднему по отделу')).toBeInTheDocument();
    expect(screen.getByText('Вклад в баллы отдела')).toBeInTheDocument();
  });
});

describe('отсутствия', () => {
  it('показывает график, пересечения и заявки руководителю', () => {
    renderAt('/tetris');
    expect(screen.getByRole('heading', { level: 1, name: 'Тетрис' })).toBeInTheDocument();
    const clashes = screen.getByRole('region', { name: 'Пересечения со сроками задач' });
    expect(within(clashes).getByRole('button', { name: 'Согласовать бюджет и обновить смету' })).toBeInTheDocument();
    expect(within(clashes).getByRole('button', { name: 'Закрыть журнал регистрации за неделю' })).toBeInTheDocument();
    const requests = screen.getByRole('region', { name: 'Заявки' });
    expect(within(requests).getAllByRole('button', { name: 'Согласовать' }).length).toBeGreaterThan(0);
  });

  it('виды событий — выпадающий список с отметками; легенда под графиком', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/tetris');
    const bars = () => container.querySelectorAll('.tl-bar').length;
    const all = bars();
    await user.click(screen.getByRole('button', { name: 'Виды событий: все виды' }));
    await user.click(screen.getByRole('option', { name: 'Отпуск' }));
    // Список остаётся открытым — можно снять ещё один вид.
    expect(screen.getByRole('listbox', { name: 'Виды событий' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Виды событий: .*4 из 5/ })).toBeInTheDocument();
    expect(bars()).toBeLessThan(all);
    await user.click(screen.getByRole('option', { name: 'все виды' }));
    expect(bars()).toBe(all);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Легенда — после графика.
    const grid = screen.getByRole('grid');
    const legend = container.querySelector('.tt-legend')!;
    expect(grid.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('показывает пик отпусков и предупреждает о превышении 30%', () => {
    const state = loggedIn();
    const extra = [2, 3, 4].map((employeeId, i) => ({
      id: `peak-${i}`,
      employeeId,
      type: 'vacation' as const,
      from: '2026-09-28',
      to: '2026-09-30',
      status: 'approved' as const,
      note: '',
      decidedBy: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
    }));
    renderAt('/tetris', { ...state, absences: [...state.absences, ...extra] });
    const summary = screen.getByRole('region', { name: 'Сводка' });
    expect(within(summary).getByText('Пик отпусков')).toBeInTheDocument();
    expect(within(summary).getByText('43%')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/В отпуске больше 30% отдела.*28–30\.09/);
    expect(document.querySelectorAll('.tl-dh.over')).toHaveLength(3);
  });

  it('итоговая строка показывает процент отсутствующих по дням', () => {
    renderAt('/tetris');
    expect(screen.getByText('Отсутствуют, %')).toBeInTheDocument();
    const cells = [...document.querySelectorAll('.tl-foot')];
    expect(cells).toHaveLength(30);
    // 17 сентября: Петров (отпуск) и Смирнова (больничный) — 2 из 7.
    expect(cells[16]).toHaveTextContent('29%');
    expect(cells[16].getAttribute('data-tip')).toMatch(/2 из 7 — Петров В\.С\., Смирнова О\.Л\./);
    expect(cells[0]).toHaveTextContent('—');
  });

  it('раздел называется «Тетрис», старый адрес /absences ведёт в него', () => {
    renderAt('/absences');
    expect(screen.getByRole('heading', { level: 1, name: 'Тетрис' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Тетрис' })).toHaveAttribute('aria-current', 'page');
  });

  it('согласует заявку', async () => {
    const user = userEvent.setup();
    renderAt('/tetris');
    const requests = screen.getByRole('region', { name: 'Заявки' });
    const before = within(requests).getAllByRole('button', { name: 'Согласовать' }).length;
    await user.click(within(requests).getAllByRole('button', { name: 'Согласовать' })[0]);
    expect(within(requests).queryAllByRole('button', { name: 'Согласовать' })).toHaveLength(before - 1);
    expect(loadState().absences.filter((a) => a.status === 'request')).toHaveLength(before - 1);
  });

  it('создаёт отсутствие и предупреждает о задачах в этот период', async () => {
    const user = userEvent.setup();
    renderAt('/tetris');
    await user.click(screen.getByRole('button', { name: /^Событие$/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Сотрудник:/ }));
    await user.click(within(dialog).getByRole('option', { name: 'Кузнецов М.П.' }));
    fireEvent.change(within(dialog).getByLabelText('С'), { target: { value: '2026-09-18' } });
    fireEvent.change(within(dialog).getByLabelText('По (включительно)'), { target: { value: '2026-09-18' } });
    expect(within(dialog).getByText(/Пересекается со сроками/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(loadState().absences.some((a) => a.employeeId === 4 && a.from === '2026-09-18' && a.status === 'approved')).toBe(true);
  });

  it('перенос первого дня события двигает последний, сохраняя длительность', async () => {
    const user = userEvent.setup();
    renderAt('/tetris');
    await user.click(screen.getByRole('button', { name: /^Событие$/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('С'), { target: { value: '2026-10-05' } });
    const to = within(dialog).getByLabelText('По (включительно)');
    fireEvent.change(to, { target: { value: '2026-10-09' } });
    // Поле держит набранный текст до потери фокуса, поэтому уводим фокус, как это делает пользователь.
    fireEvent.blur(to);
    // Переносим начало вперёд за прежний конец: конец должен уехать вместе с ним.
    fireEvent.change(within(dialog).getByLabelText('С'), { target: { value: '2026-10-20' } });
    expect(within(dialog).queryByText(/Последний день раньше первого/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    // Длительность сохранена: пять дней, как и было.
    expect(loadState().absences.at(-1)).toMatchObject({ from: '2026-10-20', to: '2026-10-24' });
  });

  it('последний день раньше первого — ошибка видна сразу, сохранить нельзя', async () => {
    const user = userEvent.setup();
    renderAt('/tetris');
    await user.click(screen.getByRole('button', { name: /^Событие$/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('С'), { target: { value: '2026-10-05' } });
    fireEvent.change(within(dialog).getByLabelText('По (включительно)'), { target: { value: '2026-10-01' } });
    // Ошибка появляется до нажатия «Сохранить».
    expect(within(dialog).getByText(/Последний день раньше первого/)).toBeInTheDocument();
    const before = loadState().absences.length;
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(loadState().absences.length).toBe(before);
  });

  it('не даёт пересечь два отсутствия одного сотрудника', async () => {
    const user = userEvent.setup();
    renderAt('/tetris');
    await user.click(screen.getByRole('button', { name: /^Событие$/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Сотрудник:/ }));
    await user.click(within(dialog).getByRole('option', { name: 'Петров В.С.' }));
    fireEvent.change(within(dialog).getByLabelText('С'), { target: { value: '2026-09-16' } });
    fireEvent.change(within(dialog).getByLabelText('По (включительно)'), { target: { value: '2026-09-17' } });
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/ }));
    expect(within(dialog).getByText(/Даты пересекаются с другим событием/)).toBeInTheDocument();
  });

  it('исполнитель подаёт заявку только на себя', async () => {
    const user = userEvent.setup();
    renderAt('/tetris', executorIn());
    await user.click(screen.getByRole('button', { name: /Заявка на событие/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /^Сотрудник:/ })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('С'), { target: { value: '2026-10-05' } });
    fireEvent.change(within(dialog).getByLabelText('По (включительно)'), { target: { value: '2026-10-09' } });
    await user.click(within(dialog).getByRole('button', { name: /Подать заявку/ }));
    expect(loadState().absences.at(-1)).toMatchObject({ employeeId: 3, status: 'request', from: '2026-10-05' });
  });

  it('помечает задачу, срок которой приходится на отсутствие', async () => {
    const user = userEvent.setup();
    renderAt('/control');
    expect(screen.getAllByText(/Петров В\.С\. отсутствует: отпуск/).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: /Согласовать бюджет/ })[0]);
    expect(within(screen.getByRole('dialog')).getByText('Срок приходится на отсутствие исполнителя.')).toBeInTheDocument();
  });

  it('карточка сотрудника показывает остатки, руководитель меняет нормы', async () => {
    const user = userEvent.setup();
    renderAt('/employees/2');
    const panel = screen.getByRole('region', { name: 'Отсутствия сотрудника' });
    expect(within(panel).getByText(/осталось|остался/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /изменить$/ }));
    const input = within(panel).getByLabelText('Перенесено');
    await user.clear(input);
    await user.type(input, '10');
    await user.click(within(panel).getByRole('button', { name: /Сохранить нормы/ }));
    expect(loadState().entitlements.find((e) => e.employeeId === 2 && e.year === 2026)?.carriedOver).toBe(10);
  });
});
