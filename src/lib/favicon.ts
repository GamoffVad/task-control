// Значок вкладки строится из той же геометрии, что и знак приложения,
// поэтому цвета логотипа и значка всегда совпадают.
import { CELLS, SIZE, STEP, VIEW_BOX } from './logoSteps';

/** Поля вокруг знака: скруглённая подложка должна дышать. */
const PAD = 4.77;
const RADIUS = 10.7;

export type FaviconColors = { dark: string; accent: string; paper: string };

export const faviconSvg = ({ dark, accent, paper }: FaviconColors): string => {
  const x = VIEW_BOX.x - PAD;
  const y = VIEW_BOX.y - PAD;
  const side = VIEW_BOX.side + PAD * 2;
  const cubes = CELLS.map(
    ([cx, cy, tone]) =>
      `<rect x="${(cx * STEP).toFixed(1)}" y="${(cy * STEP).toFixed(1)}" width="${SIZE}" height="${SIZE}" rx="0.6" fill="${tone ? accent : dark}"/>`,
  ).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x.toFixed(2)} ${y.toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}">` +
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" rx="${RADIUS}" fill="${paper}"/>` +
    `<g transform="rotate(45)">${cubes}</g></svg>`
  );
};

/** Ссылка для <link rel="icon">: data-URI, ничего не загружается из сети. */
export const faviconHref = (colors: FaviconColors): string => `data:image/svg+xml,${encodeURIComponent(faviconSvg(colors))}`;
