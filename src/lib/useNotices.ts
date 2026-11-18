import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useStore } from './store';
import { backgroundTimer, noticePermission, noticesSupported, readNoticePref, readSince, showNotice, writeNoticePref, writeSince, type ServerNotice } from './notices';

/** Как часто вкладка спрашивает сервер о новых уведомлениях. */
export const NOTICE_POLL_MS = 20_000;
/** Сколько пропущенных уведомлений показать по отдельности, когда вкладку снова открыли; остальные — одной строкой. */
const MISSED_SHOWN = 3;

/** Уведомления Chrome этого браузера: состояние и действия. Вызывается один раз — в оболочке приложения. */
export const useNotices = () => {
  const { state, fetchNotices, reload } = useStore();
  const supported = !!fetchNotices && noticesSupported();
  const insecure = !!fetchNotices && typeof window !== 'undefined' && !window.isSecureContext;
  const [permission, setPermission] = useState<NotificationPermission>(noticePermission);
  const [pref, setPref] = useState(readNoticePref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inAppNotices, setInAppNotices] = useState<ServerNotice[]>([]);
  const me = state.user?.employeeId;
  const enabled = insecure ? pref !== 'off' && pref !== 'later' : supported && permission === 'granted' && pref !== 'off';
  const polling = useRef(false);

  useEffect(() => { setInAppNotices([]); }, [me]);
  useEffect(() => {
    if (!enabled || !fetchNotices || me === undefined) return;
    let active = true;
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const since = readSince(me);
        const { notices, now } = await fetchNotices(since);
        if (!active) return;
        if (!notices.length) { writeSince(me, now); return; }
        const shown = notices.slice(-MISSED_SHOWN);
        if (insecure) setInAppNotices((prev) => [...prev, ...notices.filter((n) => !prev.some((p) => p.id === n.id))].slice(-20));
        else for (const n of shown) await showNotice({ title: n.title, body: n.body, url: n.url, tag: n.id });
        if (!insecure && notices.length > shown.length) {
          await showNotice({ title: 'Контроль задач', body: `И ещё уведомлений: ${notices.length - shown.length}. Откройте приложение.`, url: '/', tag: `more-${now}` });
        }
        writeSince(me, notices.at(-1)?.at && notices.at(-1)!.at > now ? notices.at(-1)!.at : now);
        setError('');
        // Счётчики, задачи и сообщения на экране — тоже свежие.
        reload();
      } catch {
        setError('Не удалось получить или показать уведомления. Проверьте подключение и разрешение браузера; приложение повторит попытку.');
      } finally {
        polling.current = false;
      }
    };
    void poll();
    const stop = backgroundTimer(NOTICE_POLL_MS, () => void poll());
    return () => { active = false; stop(); };
  }, [enabled, fetchNotices, me, reload, insecure]);

  // Нажатие на уведомление: Service Worker просит вкладку открыть раздел.
  const navigate = useNavigate();
  useEffect(() => {
    if (!supported || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string' && e.data.url.startsWith('/')) navigate(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [supported, navigate]);

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      if (insecure) { writeNoticePref(null); setPref(null); return; }
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setError('Chrome не разрешил уведомления. Разрешите их: значок слева от адреса сайта → «Уведомления» → «Разрешить».');
        return;
      }
      writeNoticePref(null);
      setPref(null);
      await showNotice({ title: 'Уведомления включены', body: 'Задачи, сроки, заявки, отчёты и сообщения — пока вкладка приложения открыта, даже в фоне или свёрнутой.', url: '/', tag: 'notices-enabled' });
    } catch (e) {
      setError(`Не удалось включить уведомления: ${e instanceof Error ? e.message : 'ошибка браузера'}.`);
    } finally {
      setBusy(false);
    }
  };

  const disable = () => {
    writeNoticePref('off');
    setPref('off');
  };

  const later = () => {
    writeNoticePref('later');
    setPref('later');
  };

  return { supported, insecure, permission, pref, enabled, busy, error, enable, disable, later, inAppNotices, dismissNotice: (id: string) => setInAppNotices((items) => items.filter((item) => item.id !== id)) };
};

export type NoticesState = ReturnType<typeof useNotices>;
