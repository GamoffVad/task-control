import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icons';
import { ImageViewer, type ViewerImage } from '../components/ImageViewer';
import { PageHeader } from '../kit';
import { lightShot, parseManual } from '../lib/manual';
import { useTheme } from '../lib/theme';
import { APP_VERSION } from '../version';
import raw from '../../docs/manual.html?raw';
import './info.css';
import metaRaw from '../../docs/manual.meta.json?raw';

// Скриншоты документации попадают в сборку как отдельные файлы и грузятся по мере прокрутки.
const SHOTS = import.meta.glob('../../docs/shots/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const shotUrl = (file: string) => SHOTS[`../../docs/shots/${file}`] ?? null;

const meta = JSON.parse(metaRaw) as { version: string; tests: number | null; pdf?: string };

/** Раздел «Информация»: документация — та же, что в PDF, — с оглавлением. Скриншоты — в теме, выбранной сейчас. */
export const Info = () => {
  const theme = useTheme();
  const chapters = useMemo(
    () => parseManual(raw, { version: APP_VERSION, tests: meta.tests, shotUrl: (file) => (theme === 'light' ? shotUrl(lightShot(file)) : null) ?? shotUrl(file) }),
    [theme],
  );
  const [active, setActive] = useState(chapters[0]?.no ?? '');
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
        const first = chapters.find((c) => seen.get(`ch-${c.no}`));
        if (first) setActive(first.no);
      },
      { rootMargin: '-120px 0px -55% 0px' },
    );
    chapters.forEach((c) => {
      const el = document.getElementById(`ch-${c.no}`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [chapters]);

  const go = (no: string) => {
    document.getElementById(`ch-${no}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            <Link className="btn" to="/kit">
              Библиотека компонентов
            </Link>
          </>
        }
      />
      <div className="split split--300 info-layout">
        <aside className="panel info-toc" aria-label="Содержание">
          <span className="caps">Содержание</span>
          <ol>
            {chapters.map((c) => (
              <li key={c.no}>
                <a
                  href={`#ch-${c.no}`}
                  aria-current={active === c.no ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(c.no);
                  }}
                >
                  <span className="num">{c.no}</span>
                  {c.title}
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
          {chapters.map((c) => (
            <section key={c.no} id={`ch-${c.no}`} className="info-ch" aria-labelledby={`ch-${c.no}-t`}>
              <header className="chapter-head">
                <span className="no">{c.no}</span>
                <h2 id={`ch-${c.no}-t`}>{c.title}</h2>
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
