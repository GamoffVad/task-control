import { Fragment, useEffect, useRef, useState } from 'react';
import { Button, DateField, Dialog, IconButton, PageHeader, TextArea, TextButton } from '../kit';
import { Icon } from '../components/Icons';
import { hasPermission } from '../lib/access';
import { initials, shortName } from '../lib/data';
import { fmtDayMonth, fmtTime, isSameDay, addDays, startOfDay, toDateKey } from '../lib/dates';
import { useStore } from '../lib/store';
import { chatReadAt, unreadMessages } from '../lib/chat';
import type { Message } from '../lib/types';

const MAX = 1000;
/** На странице переписки сообщения перечитываются чаще, чем в остальном приложении. */
const CHAT_REFRESH_MS = 15_000;
/** Период по умолчанию — последние две недели, включая сегодня. */
const PERIOD_DAYS = 14;
const defaultFrom = () => toDateKey(addDays(startOfDay(new Date()), -(PERIOD_DAYS - 1)));

const dayLabel = (d: Date, now: Date) => {
  if (isSameDay(d, now)) return 'Сегодня';
  if (isSameDay(d, addDays(now, -1))) return 'Вчера';
  return fmtDayMonth(d);
};

export const Chat = () => {
  const { state, dispatch, sync, reload } = useStore();
  const [text, setText] = useState('');
  // Период: «с» по умолчанию — две недели назад; пустое «по» — по сегодня, и новые сообщения сразу видны.
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState('');
  const [deleting, setDeleting] = useState<Message | null>(null);
  const canModerate = hasPermission(state.user, 'chat.moderate');
  const inPeriod = (m: Message) => {
    const day = toDateKey(new Date(m.sentAt));
    return (!from || day >= from) && (!to || day <= to);
  };
  const shown = state.messages.filter(inPeriod);
  const earlier = from ? state.messages.filter((m) => toDateKey(new Date(m.sentAt)) < from).length : 0;
  const isDefaultPeriod = from === defaultFrom() && !to;
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
  const firstNew = ready ? shown.find(isNew)?.id : undefined;
  const newCount = ready ? shown.filter(isNew).length : 0;

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
  }, [ready, shown.length]);

  const send = () => {
    if (!text.trim()) return;
    dispatch({ type: 'sendMessage', text });
    setText('');
  };

  return (
    <div className="chat-page">
      <PageHeader
        title="Переписка"
        toolbar={
          <div className="tool chat-period">
            <span className="caps">Период</span>
            <span className="chat-period-fields">
              <span className="faint">с</span>
              <DateField value={from} onChange={setFrom} placeholder="начала" invalid={!!from && !!to && from > to} />
              <span className="faint">по</span>
              <DateField value={to} onChange={setTo} placeholder="сегодня" invalid={!!from && !!to && from > to} />
            </span>
            {!isDefaultPeriod && (
              <TextButton
                onClick={() => {
                  setFrom(defaultFrom());
                  setTo('');
                }}
              >
                2 недели
              </TextButton>
            )}
          </div>
        }
      />
      <div className="chat">
        <div className="chat-feed" ref={feed} role="log" aria-live="polite" aria-label="Сообщения">
          {earlier > 0 && (
            <p className="chat-earlier muted">
              Более ранних сообщений: {earlier}.{' '}
              <TextButton onClick={() => setFrom('')}>Показать все</TextButton>
            </p>
          )}
          {state.messages.length === 0 && <p className="empty">Сообщений пока нет. Напишите первое.</p>}
          {state.messages.length > 0 && shown.length === 0 && <p className="empty">За выбранный период сообщений нет.</p>}
          {shown.map((m, i) => {
            const d = new Date(m.sentAt);
            const prev = shown[i - 1];
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
                      {canModerate && (
                        <IconButton label="Удалить сообщение" className="msg-delete" onClick={() => setDeleting(m)}>
                          <Icon.Trash size={13} />
                        </IconButton>
                      )}
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
      {deleting && (
        <Dialog title="Удалить сообщение?" context="Сообщение исчезнет у всех сотрудников" onClose={() => setDeleting(null)}>
          <div className="delete-user-dialog">
            <div className="delete-user-warning">
              <Icon.Trash size={18} />
              <div>
                <strong>
                  {shortName(deleting.authorId)}, {fmtDayMonth(new Date(deleting.sentAt))} {fmtTime(new Date(deleting.sentAt))}
                </strong>
                <p className="chat-delete-text">{deleting.text}</p>
              </div>
            </div>
            <div className="form-actions">
              <Button
                variant="danger"
                icon={<Icon.Trash size={15} />}
                onClick={() => {
                  dispatch({ type: 'deleteMessage', id: deleting.id });
                  setDeleting(null);
                }}
              >
                Удалить
              </Button>
              <Button onClick={() => setDeleting(null)}>Отмена</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
