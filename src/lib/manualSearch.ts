import type { ManualChapter } from './manual';

type Range = { start: number; end: number };
type IndexedText = { text: string; starts: number[]; ends: number[] };
export type ManualSearchResult = ManualChapter & { matches: number; target: string; snippet: string; snippetMatches: Range[]; titleMatches: Range[] };

/** Регистр, е/ё и лишние пробелы не влияют на поиск; сохраняем смещения исходного текста. */
const indexText = (source: string): IndexedText => {
  const text: string[] = [], starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const character = /\s/u.test(source[i]) ? ' ' : source[i];
    if (character === ' ' && text.at(-1) === ' ') { ends[ends.length - 1] = i + 1; continue; }
    text.push(character); starts.push(i); ends.push(i + 1);
  }
  return { text: text.join(''), starts, ends };
};
const normalize = (s: string) => s.toLocaleLowerCase('ru').replaceAll('ё', 'е');
const findMatches = (text: string, query: string): Range[] => {
  const ranges: Range[] = [];
  const haystack = normalize(text);
  for (let start = haystack.indexOf(query); start !== -1; start = haystack.indexOf(query, start + query.length)) ranges.push({ start, end: start + query.length });
  return ranges;
};
const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|H[1-6]|HR|LI|OL|P|PRE|SECTION|TABLE|TBODY|TD|TH|THEAD|TR|UL)$/;

/** Ищет только в видимом тексте, сохраняя HTML, ссылки и рисунки руководства. */
export const searchManual = (chapters: ManualChapter[], search: string): ManualSearchResult[] => {
  const query = normalize(indexText(search).text.trim());
  return chapters.flatMap((chapter) => {
    if (!query) return [{ ...chapter, matches: 0, target: `ch-${chapter.no}`, snippet: '', snippetMatches: [], titleMatches: [] }];
    const doc = new DOMParser().parseFromString(chapter.html, 'text/html');
    const nodes: { node: Text; start: number; end: number }[] = [];
    let source = '';
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        nodes.push({ node: node as Text, start: source.length, end: source.length + (node.textContent?.length ?? 0) });
        source += node.textContent;
      } else if (node instanceof Element && !node.matches('script, style, [hidden], [aria-hidden="true"]')) {
        const block = BLOCK.test(node.tagName) || node.matches('.feature > b, .flow .t, .stats span, .stats b, .stats small, figcaption > .num, .feature .n');
        if (block) source += '\n';
        node.childNodes.forEach(walk);
        if (block) source += '\n';
      }
    };
    walk(doc.body);
    const indexed = indexText(source);
    const bodyMatches = findMatches(indexed.text, query);
    const titleIndex = indexText(chapter.title);
    const titleMatches = findMatches(titleIndex.text, query).map((range) => ({ start: titleIndex.starts[range.start], end: titleIndex.ends[range.end - 1] }));
    const matches = bodyMatches.length + titleMatches.length;
    if (!matches) return [];
    const rawMatches = bodyMatches.map((range, i) => ({ start: indexed.starts[range.start], end: indexed.ends[range.end - 1], id: `info-hit-${chapter.no}-${i}` }));
    const assigned = new Set<string>();
    for (const { node, start, end } of nodes) {
      const hits = rawMatches.filter((range) => range.start < end && range.end > start);
      if (!hits.length) continue;
      const fragment = doc.createDocumentFragment();
      const text = node.data;
      let offset = 0;
      for (const hit of hits) {
        const left = Math.max(hit.start - start, 0), right = Math.min(hit.end - start, text.length);
        fragment.append(text.slice(offset, left));
        const mark = doc.createElement('mark');
        mark.className = 'info-match';
        if (!assigned.has(hit.id)) { mark.id = hit.id; assigned.add(hit.id); }
        mark.textContent = text.slice(left, right);
        fragment.append(mark);
        offset = right;
      }
      fragment.append(text.slice(offset));
      node.replaceWith(fragment);
    }
    const first = bodyMatches[0];
    const snippetStart = first ? Math.max(0, first.start - 55) : 0;
    const snippetEnd = first ? Math.min(indexed.text.length, first.end + 95) : 0;
    const prefix = snippetStart > 0 ? '…' : '';
    const snippet = first ? `${prefix}${indexed.text.slice(snippetStart, snippetEnd)}${snippetEnd < indexed.text.length ? '…' : ''}` : '';
    const snippetMatches = bodyMatches.filter((range) => range.start >= snippetStart && range.end <= snippetEnd).map((range) => ({ start: range.start - snippetStart + prefix.length, end: range.end - snippetStart + prefix.length }));
    return [{ ...chapter, html: doc.body.innerHTML, matches, target: first ? `info-hit-${chapter.no}-0` : `ch-${chapter.no}`, snippet, snippetMatches, titleMatches }];
  });
};
