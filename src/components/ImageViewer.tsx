import { useEffect, useState } from 'react';
import { Dialog } from '../kit';
import { Icon } from './Icons';

export type ViewerImage = { src: string; no: string; caption: string };

/**
 * Просмотр рисунков документации в окне: рисунок по размеру окна или в натуральную величину
 * (клик по рисунку), листание стрелками ‹ › и клавишами ← →.
 */
export const ImageViewer = ({ images, index, onIndex, onClose }: { images: ViewerImage[]; index: number; onIndex: (i: number) => void; onClose: () => void }) => {
  const [actual, setActual] = useState(false);
  const image = images[index];
  const go = (i: number) => {
    if (i < 0 || i >= images.length) return;
    setActual(false);
    onIndex(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(index - 1);
      if (e.key === 'ArrowRight') go(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!image) return null;
  return (
    <Dialog title={image.no || 'Рисунок'} context={image.caption} onClose={onClose} className="modal--image">
      <div className={`zoom-view${actual ? ' actual' : ''}`}>
        <img
          src={image.src}
          alt={image.caption}
          onClick={() => setActual((a) => !a)}
          data-tip={actual ? 'Уместить в окно' : 'Натуральная величина'}
        />
      </div>
      <div className="zoom-nav">
        <button type="button" className="icon-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Предыдущий рисунок" data-tip="Предыдущий рисунок (←)">
          <Icon.ChevronLeft size={16} />
        </button>
        <span className="num">
          {index + 1} / {images.length}
        </span>
        <button type="button" className="icon-btn" onClick={() => go(index + 1)} disabled={index === images.length - 1} aria-label="Следующий рисунок" data-tip="Следующий рисунок (→)">
          <Icon.Chevron size={16} />
        </button>
        <span className="spacer" />
        <button type="button" className="text-action" onClick={() => setActual((a) => !a)}>
          {actual ? 'Уместить в окно' : 'Натуральная величина'}
        </button>
      </div>
    </Dialog>
  );
};
