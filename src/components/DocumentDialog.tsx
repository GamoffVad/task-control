import { useMemo, useState } from 'react';
import { Button, Dialog, Select } from '../kit';
import { saveFile } from '../lib/download';
import { renderTemplate, type TemplateContext } from '../lib/templates';
import type { DocumentTemplate } from '../lib/types';
import { Icon } from './Icons';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Документ для Word: строки текста — абзацы, отступы сохраняются. */
const toWordHtml = (title: string, text: string) =>
  `<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:'Times New Roman',serif;font-size:14pt">${text
    .split('\n')
    .map((line) => `<p style="margin:0;white-space:pre-wrap">${escapeHtml(line) || '&nbsp;'}</p>`)
    .join('')}</body></html>`;

/**
 * Структурированный текстовый документ по шаблону: предпросмотр, копирование, .doc и .txt.
 * Общий для «Планирования» и «Отчётности»; source — откуда берутся данные (подпись окна).
 * onCsv — выгрузка той же недели таблицей (как кнопка «Выгрузить CSV» раздела); от шаблона не зависит.
 */
export const DocumentDialog = ({ templates, context, fileBase, source, onCsv, onClose }: { templates: DocumentTemplate[]; context: TemplateContext; fileBase: string; source: string; onCsv?: () => void; onClose: () => void }) => {
  const [id, setId] = useState(templates[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const template = templates.find((t) => t.id === id);
  const result = useMemo(() => {
    if (!template) return { text: '', error: 'Шаблонов нет. Добавьте шаблон в разделе «Администрирование» → «Шаблоны документов».' };
    try {
      return { text: renderTemplate(template.body, context), error: '' };
    } catch (e) {
      return { text: '', error: `Шаблон содержит ошибку: ${(e as Error).message}` };
    }
  }, [template, context]);
  const copy = async () => {
    await navigator.clipboard?.writeText(result.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Dialog title="Документ по шаблону" context={source} onClose={onClose} wide>
      <div className="form-stack">
        <div className="field">
          <span className="caps">Шаблон</span>
          <Select<string> variant="light" label="Шаблон документа" value={id} options={templates.map((t) => ({ value: t.id, label: t.name }))} onChange={setId} disabled={templates.length === 0} />
        </div>
        {result.error ? <p className="field-error" role="alert">{result.error}</p> : <pre className="doc-preview" aria-label="Текст документа">{result.text}</pre>}
        <div className="form-actions">
          <span className="spacer" />
          <Button variant="primary" icon={<Icon.Save size={15} />} disabled={!!result.error} onClick={() => saveFile(`${fileBase}.doc`, toWordHtml(template?.name ?? '', result.text), 'application/msword')}>
            Скачать .doc
          </Button>
          <Button icon={<Icon.Download size={15} />} data-tip="Простой текст без оформления — для вставки в СЭД, почту или мессенджер" disabled={!!result.error} onClick={() => saveFile(`${fileBase}.txt`, '﻿' + result.text.replace(/\n/g, '\r\n'), 'text/plain;charset=utf-8')}>
            Скачать .txt
          </Button>
          {onCsv && (
            <Button icon={<Icon.Download size={15} />} data-tip="Таблица мероприятий для Excel — те же данные, что и кнопка «Выгрузить CSV»" onClick={onCsv}>
              Скачать CSV
            </Button>
          )}
          <Button disabled={!!result.error} onClick={copy}>{copied ? 'Скопировано' : 'Копировать'}</Button>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      </div>
    </Dialog>
  );
};
