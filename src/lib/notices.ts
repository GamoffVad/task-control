// Уведомления Chrome без внешних служб: открытая вкладка приложения (в том числе в фоне или свёрнутая)
// забирает новые уведомления сотрудника у своего сервера и показывает их системными уведомлениями.
// Для работы нужен защищённый адрес (HTTPS) — так требует Chrome для любых уведомлений.

export type ServerNotice = { id: string; at: string; title: string; body: string; url: string };

/** Выбор пользователя в этом браузере: 'off' — выключил сам, 'later' — отложил предложение. */
export const NOTICE_PREF_KEY = 'task-control:notices';
const SINCE_KEY = 'task-control:notices-since';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Хранилище недоступно — выбор действует до перезагрузки.
  }
};

export const readNoticePref = () => read(NOTICE_PREF_KEY);
export const writeNoticePref = (value: string | null) => write(NOTICE_PREF_KEY, value);
/** С какого момента забирать уведомления сотрудника — общий для всех вкладок этого браузера. */
export const readSince = (employeeId: number) => read(`${SINCE_KEY}:${employeeId}`);
export const writeSince = (employeeId: number, iso: string) => write(`${SINCE_KEY}:${employeeId}`, iso);

export const noticesSupported = (): boolean => typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window;
export const noticePermission = (): NotificationPermission => (noticesSupported() ? Notification.permission : 'denied');

/** Service Worker нужен только для нажатия на уведомление: он открывает вкладку приложения на нужной странице. */
const registration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
};

const ICON = '/images/notify-192.png';

/** Показывает системное уведомление Chrome. tag — id уведомления: из нескольких вкладок покажется одно. */
export const showNotice = async (n: { title: string; body: string; url: string; tag: string }) => {
  const options: NotificationOptions = { body: n.body, tag: n.tag, icon: ICON, badge: '/images/notify-96.png', lang: 'ru', data: { url: n.url } };
  const reg = await registration();
  if (reg) return reg.showNotification(n.title, options);
  // Без Service Worker — обычное уведомление страницы; нажатие открывает вкладку приложения.
  const note = new Notification(n.title, options);
  note.onclick = () => {
    window.focus();
    window.location.assign(n.url);
  };
};

/**
 * Таймер, который Chrome не замедляет в фоновой вкладке: отдельный поток (Worker).
 * Обычный setInterval в скрытой вкладке срабатывает не чаще раза в минуту.
 */
export const backgroundTimer = (ms: number, tick: () => void): (() => void) => {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !URL.createObjectURL) {
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }
  const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = tick;
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
};
