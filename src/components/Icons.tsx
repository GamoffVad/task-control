// SVG stroke-иконки, 15–17 px, цвет наследуется.
type P = { size?: number };

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const Icon = {
  Plus: (p: P) => <svg {...base(p.size)}><path d="M12 5v14M5 12h14" /></svg>,
  Trash: (p: P) => <svg {...base(p.size)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  Edit: (p: P) => <svg {...base(p.size)}><path d="M4 20h4l11-11a2.8 2.8 0 00-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>,
  Download: (p: P) => <svg {...base(p.size)}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  Send: (p: P) => <svg {...base(p.size)}><path d="M4 12l16-8-6 16-3-7z" /><path d="M11 13l9-9" /></svg>,
  Save: (p: P) => <svg {...base(p.size)}><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></svg>,
  Refresh: (p: P) => <svg {...base(p.size)}><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>,
  Print: (p: P) => <svg {...base(p.size)}><path d="M7 9V4h10v5M7 17H5v-7h14v7h-2M7 14h10v6H7z" /></svg>,
  Chevron: (p: P) => <svg {...base(p.size)}><path d="M9 6l6 6-6 6" /></svg>,
  ChevronLeft: (p: P) => <svg {...base(p.size)}><path d="M15 6l-6 6 6 6" /></svg>,
  Close: (p: P) => <svg {...base(p.size)}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  Check: (p: P) => <svg {...base(p.size)}><path d="M5 12l5 5 9-10" /></svg>,
  Bell: (p: P) => <svg {...base(p.size)}><path d="M6 16V11a6 6 0 1112 0v5l2 2H4z" /><path d="M10 20a2 2 0 004 0" /></svg>,
  Gear: (p: P) => <svg {...base(p.size)}><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.38a2 2 0 00-.73-2.73l-.15-.09a2 2 0 01-1-1.74v-.51a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>,
  Logout: (p: P) => <svg {...base(p.size)}><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" /></svg>,
  Enter: (p: P) => <svg {...base(p.size)}><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H8" /></svg>,
  Sun: (p: P) => <svg {...base(p.size)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  Moon: (p: P) => <svg {...base(p.size)}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>,
  Search: (p: P) => <svg {...base(p.size)}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>,
  Calendar: (p: P) => <svg {...base(p.size)}><path d="M5 6h14v14H5z" /><path d="M5 10h14M9 4v4M15 4v4" /></svg>,
  Clock: (p: P) => <svg {...base(p.size)}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>,
  Lock: (p: P) => <svg {...base(p.size)}><path d="M6 11h12v9H6z" /><path d="M8.5 11V8a3.5 3.5 0 017 0v3" /></svg>,
};
