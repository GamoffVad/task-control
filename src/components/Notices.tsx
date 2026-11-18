import type { NoticesState } from '../lib/useNotices';
import { Icon } from './Icons';

/** Предложение включить уведомления: один раз, пока пользователь не ответил. */
export const NoticesBanner = ({ push }: { push: NoticesState }) => {
  if (!push.supported || push.permission !== 'default' || push.pref) return push.error ? <p className="push-banner err" role="alert">{push.error}</p> : null;
  return (
    <div className="push-banner" role="region" aria-label="Уведомления в браузере">
      <Icon.Bell size={16} />
      <span>
        <b>Включите уведомления Chrome</b> — о новых задачах и сроках, заявках на отсутствие, отчётах и сообщениях. Они всплывают поверх любых окон, пока вкладка приложения открыта — даже в фоне или свёрнутая. Закрепите вкладку, чтобы она открывалась вместе с Chrome.
      </span>
      <span className="push-banner-actions">
        <button type="button" className="btn btn--primary" onClick={push.enable} disabled={push.busy}>
          Включить уведомления
        </button>
        <button type="button" className="text-action" onClick={push.later}>
          Не сейчас
        </button>
      </span>
    </div>
  );
};

/** Переключатель в подвале: состояние уведомлений этого браузера. */
export const NoticesToggle = ({ push }: { push: NoticesState }) => {
  if (push.insecure) return <button type="button" className="text-action push-state" onClick={push.enabled ? push.disable : push.enable} data-tip="Уведомления показываются внутри открытой вкладки приложения"><Icon.Bell size={13} />{push.enabled ? 'уведомления в приложении включены' : 'включить уведомления в приложении'}</button>;
  if (!push.supported) return null;
  if (push.permission === 'denied') {
    return (
      <span className="push-state off" data-tip="Уведомления запрещены в настройках Chrome: значок слева от адреса сайта → «Уведомления» → «Разрешить», затем обновите страницу.">
        <Icon.Bell size={13} /> уведомления запрещены в браузере
      </span>
    );
  }
  return push.enabled ? (
    <button type="button" className="text-action push-state on" onClick={push.disable} disabled={push.busy} data-tip="Выключить уведомления в этом браузере">
      <Icon.Bell size={13} /> уведомления включены
    </button>
  ) : (
    <button type="button" className="text-action push-state" onClick={push.enable} disabled={push.busy} data-tip="Уведомления Chrome о задачах, заявках, отчётах и сообщениях — пока вкладка приложения открыта">
      <Icon.Bell size={13} /> включить уведомления
    </button>
  );
};

/** На HTTP системные уведомления недоступны, поэтому события показываются внутри приложения. */
export const InAppNotices = ({ push }: { push: NoticesState }) => push.inAppNotices.length ? <div className="in-app-notices" aria-label="Новые уведомления" aria-live="polite">{push.inAppNotices.map((n) => <div className="in-app-notice" key={n.id}><div><strong>{n.title}</strong><p>{n.body}</p>{n.url.startsWith('/') && !n.url.startsWith('//') && <a href={n.url} onClick={() => push.dismissNotice(n.id)}>Открыть</a>}</div><button type="button" aria-label="Закрыть уведомление" onClick={() => push.dismissNotice(n.id)}>×</button></div>)}</div> : null;
