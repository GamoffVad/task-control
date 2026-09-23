// Шаблоны текстовых документов (Администрирование → Шаблоны документов).
// Язык шаблона — простой и безопасный: {{имя}} подставляет значение, {{#список}}…{{/список}} повторяет блок
// для каждого элемента списка, {{^список}}…{{/список}} — блок, если список пуст. Внутри блока видны поля элемента
// и все значения уровнем выше. Никакого кода и HTML — только текст.

import type { DocumentTemplate, TemplateScope } from './types';

export type TemplateValue = string | number | TemplateContext[];
export type TemplateContext = { [key: string]: TemplateValue };

const TAG = /\{\{\s*([#^/]?)\s*([^{}]+?)\s*\}\}/g;

type Node = { type: 'text'; text: string } | { type: 'var'; name: string } | { type: 'block'; name: string; inverted: boolean; children: Node[] };

/** Разбор шаблона в дерево; незакрытые и лишние блоки — ошибка с понятным текстом. */
export const parseTemplate = (source: string): Node[] => {
  const root: Node[] = [];
  const stack: { name: string; nodes: Node[] }[] = [{ name: '', nodes: root }];
  let last = 0;
  for (const m of source.matchAll(TAG)) {
    const [whole, kind, rawName] = m;
    const name = rawName.trim();
    const top = stack[stack.length - 1];
    if (m.index! > last) top.nodes.push({ type: 'text', text: source.slice(last, m.index) });
    last = m.index! + whole.length;
    if (kind === '#' || kind === '^') {
      const block: Node = { type: 'block', name, inverted: kind === '^', children: [] };
      top.nodes.push(block);
      stack.push({ name, nodes: block.children });
    } else if (kind === '/') {
      if (stack.length === 1 || top.name !== name) throw new Error(`Лишний конец блока {{/${name}}}.`);
      stack.pop();
    } else top.nodes.push({ type: 'var', name });
  }
  if (last < source.length) stack[stack.length - 1].nodes.push({ type: 'text', text: source.slice(last) });
  if (stack.length > 1) throw new Error(`Блок {{#${stack[stack.length - 1].name}}} не закрыт: добавьте {{/${stack[stack.length - 1].name}}}.`);
  return root;
};

const lookup = (scopes: TemplateContext[], name: string): TemplateValue | undefined => {
  for (let i = scopes.length - 1; i >= 0; i--) if (name in scopes[i]) return scopes[i][name];
  return undefined;
};

const renderNodes = (nodes: Node[], scopes: TemplateContext[]): string =>
  nodes
    .map((n) => {
      if (n.type === 'text') return n.text;
      const value = lookup(scopes, n.name);
      if (n.type === 'var') return Array.isArray(value) ? String(value.length) : value === undefined ? '' : String(value);
      const list = Array.isArray(value) ? value : value ? [{}] : [];
      if (n.inverted) return list.length ? '' : renderNodes(n.children, scopes);
      return list.map((item) => renderNodes(n.children, [...scopes, item])).join('');
    })
    .join('');

/**
 * Готовый текст документа. Строки, где стоял только тег блока, убираются,
 * чтобы шаблон можно было писать «по строкам» без лишних пустых строк в результате.
 */
export const renderTemplate = (source: string, context: TemplateContext): string => {
  const tidy = source.replace(/^[ \t]*(\{\{\s*[#^/][^{}]*\}\})[ \t]*\r?\n/gm, '$1');
  return renderNodes(parseTemplate(tidy), [context]).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
};

export const TEMPLATE_SCOPES: { value: TemplateScope; label: string }[] = [
  { value: 'planning', label: 'Планирование' },
  { value: 'reports', label: 'Отчётность' },
];

/** Шаблоны, сохранённые до 5.3.0, раздела не имели: «Справка об исполнении» относится к отчётности. */
export const templateScope = (t: { id?: string; scope?: string | null }): TemplateScope =>
  t.scope === 'reports' || t.scope === 'planning' ? t.scope : t.id === 'tpl-plan-report' ? 'reports' : 'planning';

/** Подстановки для документов «Планирования» — подсказка в редакторе шаблона. */
export const PLAN_PLACEHOLDERS: { tag: string; hint: string }[] = [
  { tag: '{{отдел}}', hint: 'название отдела' },
  { tag: '{{неделя}}', hint: '«18 – 24 сентября»' },
  { tag: '{{год}}', hint: 'год плановой недели' },
  { tag: '{{с}} / {{по}}', hint: 'первый и последний день недели' },
  { tag: '{{дата}}', hint: 'дата формирования' },
  { tag: '{{составил}}', hint: 'кто сформировал документ' },
  { tag: '{{всего}}', hint: 'число мероприятий' },
  { tag: '{{#разделы}}…{{/разделы}}', hint: 'разделы плана верхнего уровня: {{код}}, {{раздел}}' },
  { tag: '{{#позиции}}…{{/позиции}}', hint: 'внутри раздела — позиции с мероприятиями: {{код}}, {{позиция}}' },
  { tag: '{{#мероприятия}}…{{/мероприятия}}', hint: '{{№}}, {{название}}, {{срок}}, {{исполнители}}, {{категория}}, {{статус}}, {{документ}}, {{результат}}' },
  { tag: '{{^мероприятия}}…{{/мероприятия}}', hint: 'текст, если мероприятий нет' },
];

/** Подстановки для документов «Отчётности». */
export const REPORT_PLACEHOLDERS: { tag: string; hint: string }[] = [
  { tag: '{{отдел}}', hint: 'название отдела' },
  { tag: '{{неделя}}', hint: 'отчётная неделя, «11 – 17 сентября»' },
  { tag: '{{год}}', hint: 'год отчётной недели' },
  { tag: '{{с}} / {{по}}', hint: 'первый и последний день недели' },
  { tag: '{{получен}}', hint: 'когда отчёт направлен' },
  { tag: '{{дата}}', hint: 'дата формирования' },
  { tag: '{{составил}}', hint: 'кто сформировал документ' },
  { tag: '{{всего}} / {{баллы}}', hint: 'число исполненных мероприятий и сумма баллов' },
  { tag: '{{#разделы}}…{{/разделы}}', hint: 'разделы плана: {{код}}, {{раздел}}, {{баллы}}' },
  { tag: '{{#позиции}}…{{/позиции}}', hint: 'внутри раздела: {{код}}, {{позиция}}' },
  { tag: '{{#мероприятия}}…{{/мероприятия}}', hint: '{{№}}, {{название}}, {{срок}}, {{исполнено}}, {{исполнители}}, {{статус}}, {{документ}}, {{результат}}, {{баллы}}' },
  { tag: '{{#сотрудники}}…{{/сотрудники}}', hint: 'итоги по исполнителям: {{сотрудник}}, {{фио}}, {{мероприятий}}, {{баллы}}' },
];

export const placeholdersFor = (scope: TemplateScope) => (scope === 'reports' ? REPORT_PLACEHOLDERS : PLAN_PLACEHOLDERS);

export const DEFAULT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'tpl-plan-week',
    name: 'План мероприятий на неделю',
    scope: 'planning',
    body: `ПЛАН МЕРОПРИЯТИЙ
{{отдел}} на неделю {{неделя}} {{год}} г.

{{#разделы}}
{{код}}. {{раздел}}
{{#позиции}}
  {{код}} {{позиция}}
{{#мероприятия}}
    {{№}}) {{название}} — срок {{срок}}; исполнитель: {{исполнители}}{{#документ}}; документ: {{документ}}{{/документ}}
{{/мероприятия}}
{{/позиции}}

{{/разделы}}
{{^разделы}}
На неделю мероприятия не запланированы.
{{/разделы}}
Всего мероприятий: {{всего}}.

Составил: {{составил}}, {{дата}}`,
  },
  {
    id: 'tpl-plan-report',
    name: 'Справка об исполнении',
    scope: 'reports',
    body: `СПРАВКА
об исполнении мероприятий: {{отдел}}, неделя {{неделя}} {{год}} г.

{{#разделы}}
{{код}}. {{раздел}} (баллов: {{баллы}})
{{#позиции}}
{{#мероприятия}}
  {{№}}) {{название}} ({{исполнители}}) — {{статус}}, {{исполнено}}{{#результат}}. {{результат}}{{/результат}}{{#документ}}; документ: {{документ}}{{/документ}}
{{/мероприятия}}
{{/позиции}}

{{/разделы}}
{{^разделы}}
За неделю исполненных мероприятий нет.
{{/разделы}}
Итоги по сотрудникам:
{{#сотрудники}}
  {{сотрудник}} — мероприятий: {{мероприятий}}, баллов: {{баллы}}
{{/сотрудники}}

Всего исполнено мероприятий: {{всего}}, баллов: {{баллы}}.

{{дата}}                                        {{составил}}`,
  },
];
