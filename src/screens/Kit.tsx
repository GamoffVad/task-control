import { useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Button,
  Checkbox,
  DateField,
  DateTimeField,
  Dialog,
  Field,
  FieldRow,
  FilterBar,
  FilterCard,
  IconButton,
  PageHeader,
  SearchField,
  Segmented,
  Select,
  Stepper,
  TextArea,
  TextButton,
  TextInput,
} from '../kit';

const TOKENS = ['--paper', '--sheet', '--ink', '--ink-3', '--accent', '--accent-2', '--ok', '--amber', '--danger', '--dash'];

/** Витрина библиотеки компонентов: все элементы интерфейса в текущей теме. */
export const Kit = () => {
  const [date, setDate] = useState('2026-09-17');
  const [dateTime, setDateTime] = useState('2026-09-17T10:00');
  const [query, setQuery] = useState('отчёт');
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [group, setGroup] = useState('all');
  const [checked, setChecked] = useState(true);
  const [done, setDone] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [month, setMonth] = useState(8);
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  return (
    <div className="kit-page">
      <PageHeader
        title="Библиотека компонентов"
        subtitle="Элементы интерфейса «Контроля задач» в стиле «Тёплый мел». Стандартные элементы браузера — календарь, подсказки, списки, флажки, полосы прокрутки — заменены своими. Переключите тему в шапке, чтобы увидеть оба варианта."
      />

      <section>
        <h2>Цвета</h2>
        <p className="kit-desc">Токены темы. Компоненты берут цвета только отсюда, поэтому светлая и тёмная темы меняются целиком.</p>
        <div className="kit-swatches">
          {TOKENS.map((t) => (
            <div key={t} className="kit-swatch">
              <i style={{ background: `var(${t})` }} />
              <code>{t}</code>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Кнопки</h2>
        <p className="kit-desc">Button — основная, обычная и опасная; IconButton — квадратная с подсказкой; TextButton — действие с пунктирным подчёркиванием.</p>
        <div className="kit-row">
          <Button variant="primary" icon={<Icon.Plus size={15} />}>Новая задача</Button>
          <Button icon={<Icon.Download size={15} />}>Скачать</Button>
          <Button variant="danger" icon={<Icon.Trash size={15} />}>Удалить</Button>
          <Button variant="primary" disabled>Недоступно</Button>
          <IconButton label="Уведомления" badge={6}>
            <Icon.Bell size={16} />
          </IconButton>
          <IconButton label="Обновить">
            <Icon.Refresh size={16} />
          </IconButton>
          <TextButton>Сбросить к базовому</TextButton>
          <TextButton tone="ok">Согласовать</TextButton>
          <TextButton tone="danger">Отклонить</TextButton>
        </div>
      </section>

      <section>
        <h2>Поля ввода</h2>
        <p className="kit-desc">Field — подпись капителью, ошибка или подсказка под полем. TextInput, TextArea, SearchField (Escape очищает).</p>
        <div className="kit-grid">
          <Field label="Название" hint="Коротко: что нужно сделать">
            <TextInput defaultValue="Подготовить отчёт за квартал" />
          </Field>
          <Field label="Номер документа">
            <TextInput mono defaultValue="ПР-37" />
          </Field>
          <Field label="Баллы за исполнение" error="Введите число от 0,1 до 15">
            <TextInput mono invalid defaultValue="20" />
          </Field>
          <Field label="Результат исполнения">
            <TextArea rows={2} defaultValue="Отчёт согласован и направлен руководству." />
          </Field>
          <Field label="Поиск">
            <SearchField value={query} onChange={setQuery} label="Поиск по содержанию" placeholder="Название, результат…" />
          </Field>
          <Field label="Только чтение">
            <TextInput readOnly defaultValue="Назначено руководителем" />
          </Field>
        </div>
      </section>

      <section>
        <h2>Дата и время</h2>
        <p className="kit-desc">
          DateField и DateTimeField вместо системного календаря: неделя с понедельника, выходные приглушены, сегодня обведено. Дату можно ввести с клавиатуры («17.09.2026 10:00»); в календаре — стрелки, PageUp/PageDown, Enter, Escape.
        </p>
        <FieldRow>
          <Field label="Дата">
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label="Дата и время">
            <DateTimeField value={dateTime} onChange={setDateTime} step={15} />
          </Field>
          <Field label="Недоступно">
            <DateField value="" onChange={() => {}} disabled placeholder="не известна" />
          </Field>
        </FieldRow>
      </section>

      <section>
        <h2>Выбор</h2>
        <p className="kit-desc">Select — список со стрелками и Escape; Segmented — переключатель; Checkbox — флажок, зелёный для исполнения; Stepper — листалка периода.</p>
        <div className="kit-row">
          <div style={{ minWidth: 220 }}>
            <Select
              label="Группа"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: 'Весь отдел' },
                { value: 'g1', label: 'Проектная группа 1' },
                { value: 'g2', label: 'Проектная группа 2' },
              ]}
            />
          </div>
          <Segmented
            label="Вид"
            value={view}
            onChange={setView}
            options={[
              { value: 'day', label: 'День' },
              { value: 'week', label: 'Неделя' },
              { value: 'month', label: 'Месяц' },
            ]}
          />
          <Checkbox checked={checked} onChange={setChecked}>
            Сидоров Д.Е.
          </Checkbox>
          <Checkbox tone="ok" checked={done} onChange={setDone}>
            Исполнено
          </Checkbox>
          <Checkbox checked={false} onChange={() => {}} disabled>
            Недоступно
          </Checkbox>
          <Stepper
            label="Месяц"
            value={`${months[month]} 2026`}
            onPrev={() => setMonth((m) => (m + 11) % 12)}
            onNext={() => setMonth((m) => (m + 1) % 12)}
            onToday={() => setMonth(8)}
            todayLabel="Текущий"
          />
        </div>
      </section>

      <section>
        <h2>Строка фильтров</h2>
        <p className="kit-desc">FilterBar и FilterCard — ячейки с подписью, разделённые пунктиром.</p>
        <FilterBar>
          <FilterCard label="Плановая неделя">
            <Stepper label="Неделя" value="11 – 17 сентября" onPrev={() => {}} onNext={() => {}} onToday={() => {}} todayLabel="Текущая" />
          </FilterCard>
          <FilterCard label="Группа">
            <Select label="Группа" value={group} onChange={setGroup} options={[{ value: 'all', label: 'Весь отдел' }, { value: 'g1', label: 'Проектная группа 1' }]} />
          </FilterCard>
          <FilterCard label="Поиск">
            <SearchField value={query} onChange={setQuery} label="Поиск" />
          </FilterCard>
        </FilterBar>
      </section>

      <section>
        <h2>Подсказки и окно</h2>
        <p className="kit-desc">Подсказка — атрибут data-tip у любого элемента: появляется при наведении и при фокусе с клавиатуры. Dialog — окно с затемнением, Escape и удержанием фокуса.</p>
        <div className="kit-row">
          <span className="text-action" tabIndex={0} data-tip="Срок приходится на отпуск исполнителя">
            Наведите на меня
          </span>
          <Button onClick={() => setDialog(true)}>Открыть окно</Button>
        </div>
      </section>

      {dialog && (
        <Dialog title="Пример окна" context="Иванов А.Б. · руководитель" onClose={() => setDialog(false)}>
          <div className="form-stack">
            <Field label="Срок">
              <DateTimeField value={dateTime} onChange={setDateTime} step={15} />
            </Field>
            <div className="form-actions">
              <span className="spacer" />
              <Button variant="primary" onClick={() => setDialog(false)}>
                Готово
              </Button>
              <Button onClick={() => setDialog(false)}>Отмена</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
