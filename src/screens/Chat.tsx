import { Fragment, useEffect, useRef, useState } from 'react';
import { PageHeader, TextArea } from '../kit';
import { Icon } from '../components/Icons';
import { initials, shortName } from '../lib/data';
import { fmtDayMonth, fmtTime, isSameDay, addDays } from '../lib/dates';
import { useStore } from '../lib/store';
import { chatReadAt, unreadMessages } from '../lib/chat';

const MAX = 1000;
/** На странице переписки сообщения перечитываются чаще, чем в остальном приложении. */
const CHAT_REFRESH_MS = 15_000;

const dayLabel = (d: Date, now: Date) => {
  if (isSameDay(d, now)) return 'Сегодня';
  if (isSameDay(d, addDays(now, -1))) return 'Вчера';
  return fmtDayMonth(d);
};

export const Chat = () => {
  const { state, dispatch, sync, reload } = useStore();
  const [text, setText] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const newSep = useRef<HTMLDivElement>(null);
  const me = state.user?.employeeId;
  const now = new Date();
  // Отметка «прочитано» на момент открытия: по ней ставится разделитель «Новые сообщения».
  // undefined — данные ещё загружаются, отметку снимать рано.
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const ready = since !== undefined;
  if (!ready && !sync.loading) setSince(chatReadAt(state.chatReads, me));
  const isNew = (m: (typeof state.messages)[number]) => ready && m.authorId !== me && (since === null || m.sentAt > since);
  const firstNew = ready ? state.messages.find(isNew)?.id : undefined;
  const newCount = ready ? state.messages.filter(isNew).length : 0;

  // Всё, что пришло, пока страница открыта и видна, сразу считается прочитанным.
  const unread = unreadMessages(state.messages, state.chatReads, me).length;
  useEffect(() => {
    if (!ready || unread === 0) return;
    const mark = () => {
      if (document.visibilityState !== 'hidden') dispatch({ type: 'markChatRead' });
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [ready, unread, dispatch]);

  useEffect(() => {
    const tick = window.setInterval(reload, CHAT_REFRESH_MS);
    return () => window.clearInterval(tick);
  }, [reload]);

  // При открытии — к первому новому сообщению, дальше — к последнему.
  const opened = useRef(false);
  useEffect(() => {
    const el = feed.current;
    if (!el || !ready) return;
    // Прокручивается только лента, а не вся страница (лента — ближайший позиционированный предок).
    if (!opened.current && newSep.current) el.scrollTop = Math.max(0, newSep.current.offsetTop - 12);
    else el.scrollTop = el.scrollHeight;
    opened.current = true;
  }, [ready, state.messages.length]);

  const send = () => {
    if (!text.trim()) return;
    dispatch({ type: 'sendMessage', text });
    setText('');
  };

  return (
    <div className="chat-page">
      <PageHeader title="Переписка" subtitle="Общий канал отдела. Сообщения видят все сотрудники." />
      <div className="chat">
        <div className="chat-feed" ref={feed} role="log" aria-live="polite" aria-label="Сообщения">
          {state.messages.length === 0 && <p className="empty">Сообщений пока нет. Напишите первое.</p>}
          {state.messages.map((m, i) => {
            const d = new Date(m.sentAt);
            const prev = state.messages[i - 1];
            const newDay = !prev || !isSameDay(new Date(prev.sentAt), d);
            const mine = m.authorId === me;
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="day-sep">
                    <span>{dayLabel(d, now)}</span>
                  </div>
                )}
                {m.id === firstNew && (
                  <div className="day-sep new-sep" ref={newSep} role="separator" aria-label="Новые сообщения">
                    <span>Новые сообщения · {newCount}</span>
                  </div>
                )}
                <div className={`msg${mine ? ' mine' : ''}${isNew(m) ? ' unread' : ''}`}>
                  <span className="avatar">{initials(m.authorId)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="who">
                      {shortName(m.authorId)}
                      {mine && <span className="faint" style={{ fontWeight: 400 }}> (Вы)</span>}
                      <span className="when">{fmtTime(d)}</span>
                    </div>
                    <div className="text">{m.text}</div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className="sr-only" htmlFor="chat-input">Сообщение</label>
          <TextArea
            id="chat-input"
            rows={1}
            maxLength={MAX}
            value={text}
            placeholder="Сообщение. Enter — отправить, Shift+Enter — новая строка"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
            <Icon.Send size={15} /> Отправить
          </button>
        </form>
        {text.length > MAX * 0.9 && <p className="status muted">{text.length} / {MAX}</p>}
      </div>
    </div>
  );
};
