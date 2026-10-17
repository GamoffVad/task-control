import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icons';
import { ImageViewer, type ViewerImage } from '../components/ImageViewer';
import { PageHeader, SearchField } from '../kit';
import { lightShot, parseManual } from '../lib/manual';
import { searchManual } from '../lib/manualSearch';
import { plural } from '../lib/dates';
import { useTheme } from '../lib/theme';
import { APP_VERSION } from '../version';
import raw from '../../docs/manual.html?raw';
import './info.css';
import metaRaw from '../../docs/manual.meta.json?raw';

// Скриншоты документации попадают в сборку как отдельные файлы и грузятся по мере прокрутки.
const SHOTS = import.meta.glob('../../docs/shots/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const shotUrl = (file: string) => SHOTS[`../../docs/shots/${file}`] ?? null;

const meta = JSON.parse(metaRaw) as { version: string; tests: number | null; pdf?: string; iisPdf?: string };

const markedText = (text: string, ranges: { start: number; end: number }[]) => {
  let offset = 0;
  const fragments = ranges.map((range) => {
    const before = text.slice(offset, range.start);
    offset = range.end;
    return <span key={range.start}>{before}<mark className="info-match">{text.slice(range.start, range.end)}</mark></span>;
  });
  return <>{fragments}{text.slice(offset)}</>;
};

/** Раздел «Информация»: документация — та же, что в PDF, — с оглавлением. Скриншоты — в теме, выбранной сейчас. */
export const Info = () => {
  const theme = useTheme();
  const chapters = useMemo(
    () => parseManual(raw, { version: APP_VERSION, tests: meta.tests, shotUrl: (file) => (theme === 'light' ? shotUrl(lightShot(file)) : null) ?? shotUrl(file) }),
    [theme],
  );
  const [active, setActive] = useState(chapters[0]?.no ?? '');
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchManual(chapters, query), [chapters, query]);
  const searching = query.trim().length > 0;
  const matchCount = results.reduce((sum, c) => sum + c.matches, 0);
  const activeChapter = results.some((c) => c.no === active) ? active : results[0]?.no;
  // Просмотр рисунка: список берётся со страницы в момент открытия — в теме, которая сейчас включена.
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const openImage = (target: EventTarget) => {
    const img = (target as HTMLElement).closest?.('img[data-zoom]');
    const doc = img?.closest('.info-doc');
    if (!img || !doc) return false;
    const all = [...doc.querySelectorAll<HTMLImageElement>('img[data-zoom]')];
    setViewer({ images: all.map((el) => ({ src: el.currentSrc || el.src, no: el.dataset.no ?? '', caption: el.dataset.caption ?? '' })), index: all.indexOf(img as HTMLImageElement) });
    return true;
  };

  // Подсветка текущей главы в оглавлении при прокрутке.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
        const first = results.find((c) => seen.get(`ch-${c.no}`));
        if (first) setActive(first.no);
      },
      { rootMargin: '-120px 0px -55% 0px' },
    );
    results.forEach((c) => {
      const el = document.getElementById(`ch-${c.no}`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [results]);

  const go = (no: string) => {
    const target = document.getElementById(results.find((c) => c.no === no)?.target ?? `ch-${no}`);
    target?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    target?.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
    setActive(no);
  };

  return (
    <>
      <PageHeader
        title="Информация"
        subtitle={
          <>
            Возможности и руководство пользователя. Документация к версии <span className="num">{meta.version}</span>
            {meta.version !== APP_VERSION && <> (приложение — {APP_VERSION})</>}.
          </>
        }
        actions={
          <>
            {meta.pdf && (
              <a className="btn btn--primary" href={meta.pdf} download>
                <Icon.Download size={15} /> Скачать PDF
              </a>
            )}
            {/* Инструкция администратора по публикации в IIS (docs/iis-guide.md) — тем, кто разворачивает приложение. */}
            {meta.iisPdf && (
              <a className="btn" href={meta.iisPdf} download>
                <Icon.Download size={15} /> Инструкция по публикации в IIS
              </a>
            )}
            <Link className="btn" to="/kit">
              Библиотека компонентов
            </Link>
          </>
        }
      />
      <div className="info-search">
        <SearchField value={query} onChange={setQuery} label="Поиск по содержанию разделов" placeholder="Поиск по руководству…" maxLength={200} />
        <p className="field-hint" role="status">{searching ? `${matchCount} ${plural(matchCount, 'совпадение', 'совпадения', 'совпадений')} · ${results.length} ${plural(results.length, 'раздел', 'раздела', 'разделов')}` : 'Поиск по заголовкам и тексту всех разделов.'}</p>
      </div>
      <div className="split split--300 info-layout">
        <aside className="panel info-toc" aria-label="Содержание">
          <span className="caps">Содержание</span>
          <ol>
            {results.map((c) => (
              <li key={c.no}>
                <a
                  href={`#${c.target}`}
                  aria-current={activeChapter === c.no ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(c.no);
                  }}
                >
                  <span className="num">{c.no}</span>
                  <span className="info-toc-text">{markedText(c.title, c.titleMatches)}{searching && <><small className="info-hit-count">{c.matches} {plural(c.matches, 'совпадение', 'совпадения', 'совпадений')}</small>{c.snippet && <small className="info-snippet">{markedText(c.snippet, c.snippetMatches)}</small>}</>}</span>
                </a>
              </li>
            ))}
          </ol>
        </aside>
        <article
          className="info-doc"
          onClick={(e) => openImage(e.target)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && openImage(e.target)) e.preventDefault();
          }}
        >
          {searching && results.length === 0 && <p className="info-empty">По запросу «{query.trim()}» ничего не найдено. Попробуйте другое слово или очистите поиск.</p>}
          {results.map((c) => (
            <section key={c.no} id={`ch-${c.no}`} className="info-ch" aria-labelledby={`ch-${c.no}-t`}>
              <header className="chapter-head">
                <span className="no">{c.no}</span>
                <h2 id={`ch-${c.no}-t`}>{markedText(c.title, c.titleMatches)}</h2>
              </header>
              {/* Содержимое — собственная документация проекта из docs/manual.html. */}
              <div dangerouslySetInnerHTML={{ __html: c.html }} />
            </section>
          ))}
        </article>
      </div>
      {viewer && <ImageViewer images={viewer.images} index={viewer.index} onIndex={(index) => setViewer((v) => v && { ...v, index })} onClose={() => setViewer(null)} />}
    </>
  );
};
