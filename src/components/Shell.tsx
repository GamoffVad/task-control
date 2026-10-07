import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { initials, shortName } from '../lib/data';
import { hasPermission, roleLabel } from '../lib/access';
import { overdueTasks } from '../lib/logic';
import { countLabel, unreadMessages } from '../lib/chat';
import { canOpenAdmin, isManager } from '../lib/permissions';
import { useStore } from '../lib/store';
import { Icon } from './Icons';
import { LogoMark } from './LogoMark';
import { useLogoSteps } from '../lib/logoSteps';
import { navFor } from './nav';
import { ThemeToggle } from './ThemeToggle';
import { NoticesBanner, NoticesToggle } from './Notices';
import { useNotices } from '../lib/useNotices';
import { TaskEditorProvider } from './TaskModal';
import { APP_VERSION } from '../version';
import { fmtTime } from '../lib/dates';

export const Logo = ({ context }: { context?: string }) => {
  // «Ступени»: один цикл прыжков — только при наведении курсора на сам знак.
  const { svg, play } = useLogoSteps();
  return (
    <Link to="/" className="logo" aria-label="Контроль задач — на главную">
      <LogoMark className="logo-mark" svgRef={svg} onPointerEnter={(e) => e.pointerType === 'mouse' && play()} />
      <span className="logo-text" style={{ minWidth: 0 }}>
        <span className="logo-name" style={{ display: 'block' }}>Контроль задач</span>
        {context && <span className="logo-context" style={{ display: 'block' }}>{context}</span>}
      </span>
    </Link>
  );
};

export const Shell = () => {
  const { state, dispatch, sync, reload } = useStore();
  const [confirmReset, setConfirmReset] = useState(false);
  const user = state.user!;
  const manager = isManager(user);
  // Раздел администрирования виден, если доступна хоть одна его вкладка (по умолчанию — «Редактирование UI»).
  const canAdmin = canOpenAdmin(user);
  const managedAccount = state.users.find((account) => account.employeeId === user.employeeId);
  const managedParts = managedAccount?.fullName.trim().split(/\s+/) ?? [];
  const managedShortName = managedAccount && managedParts.length > 1 ? `${managedParts[0]} ${managedParts.slice(1, 3).map((part) => `${part[0]}.`).join('')}` : shortName(user.employeeId);
  const managedInitials = managedAccount && managedParts.length > 1 ? `${managedParts[0]?.[0] ?? ''}${managedParts[1]?.[0] ?? ''}` : initials(user.employeeId);
  // Исполнителю — только его просроченные задачи.
  const overdue = useMemo(
    () => overdueTasks(manager ? state.tasks : state.tasks.filter((t) => t.assigneeIds.includes(user.employeeId))).length,
    [state.tasks, manager, user.employeeId],
  );

  const notices = useNotices();
  const unread = useMemo(() => unreadMessages(state.messages, state.chatReads, user.employeeId).length, [state.messages, state.chatReads, user.employeeId]);
  // Заявки на отсутствие ждут решения у тех, кто их согласует (свои заявки не считаются).
  const requests = useMemo(
    () => (hasPermission(user, 'absences.manage') ? state.absences.filter((a) => a.status === 'request' && a.employeeId !== user.employeeId).length : 0),
    [state.absences, user],
  );
  // Колокольчик — общее число событий, о которых приходят уведомления и которые ждут внимания.
  const events = overdue + unread + requests;
  const eventParts = [
    overdue > 0 && `просроченных задач: ${overdue}`,
    unread > 0 && `непрочитанных сообщений: ${unread}`,
    requests > 0 && `заявок на отсутствие: ${requests}`,
  ].filter(Boolean);
  const eventsTip = events > 0 ? `События: ${events} — ${eventParts.join(', ')}` : 'Новых событий нет';
  const eventsTo = overdue > 0 ? '/control' : unread > 0 ? '/chat' : requests > 0 ? '/tetris' : '/control';
  // Непрочитанные видны и на вкладке браузера: «(3) Контроль задач».
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = unread > 0 ? `(${countLabel(unread)}) ${base}` : base;
  }, [unread]);

  // Высота шапки меняется (одна или две строки) — липкие панели и прокрутка к элементам отступают на неё.
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbar.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty('--topbar-h', `${Math.round(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty('--topbar-h');
    };
  }, []);

  // На узком экране строка разделов прокручивается — текущий раздел держим в поле зрения.
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const show = () => {
      const el = nav.current;
      const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!el || !active) return;
      const n = el.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      if (a.left < n.left) el.scrollLeft += a.left - n.left - 16;
      else if (a.right > n.right) el.scrollLeft += a.right - n.right + 16;
    };
    show();
    // Ширина пунктов меняется, когда догружается шрифт или появляется счётчик просрочки, — пересчитываем.
    const links = nav.current?.querySelectorAll('a');
    if (!links || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(show);
    links.forEach((a) => ro.observe(a));
    return () => ro.disconnect();
  }, [pathname]);

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    dispatch({ type: 'reset' });
    setConfirmReset(false);
  };

  return (
    <TaskEditorProvider>
      <div className="app-shell">
        <div className="app-card">
          <header className="topbar" ref={topbar}>
            <Logo context={`отдел разработки · ${managedShortName} · ${roleLabel(user.role, state.roles).toLowerCase()}`} />
            <nav className="topnav" aria-label="Разделы" ref={nav}>
              {navFor(user).map((n) => (
                <NavLink key={n.to} to={n.to}>
                  {n.label}
                  {n.to === '/control' && overdue > 0 && (
                    <span className="count" aria-label={`просрочено: ${overdue}`}>{overdue}</span>
                  )}
                  {n.to === '/chat' && unread > 0 && (
                    <span className="unread-pill" aria-label={`непрочитанных сообщений: ${unread}`}>{countLabel(unread)}</span>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="top-actions">
              <Link to={eventsTo} className="icon-btn" aria-label={eventsTip} data-tip={eventsTip}>
                <Icon.Bell size={16} />
                {events > 0 && <span className="badge">{countLabel(events)}</span>}
              </Link>
              <ThemeToggle />
              {canAdmin && (
                <Link to="/admin" className="icon-btn" aria-label="Администрирование" data-tip="Администрирование">
                  <Icon.Gear size={16} />
                </Link>
              )}
              {/* Демонстрационные данные — только в локальном режиме без сервера; в опубликованном приложении их нет. */}
              {sync.mode === 'local' && hasPermission(user, 'data.reset') && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={reset}
                  aria-label={confirmReset ? 'Нажмите ещё раз, чтобы восстановить демонстрационные данные' : 'Восстановить демонстрационные данные'}
                  data-tip={confirmReset ? 'Нажмите ещё раз для подтверждения' : 'Восстановить демонстрационные данные'}
                  style={confirmReset ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
                >
                  <Icon.Refresh size={16} />
                </button>
              )}
              <Link to={`/employees/${user.employeeId}`} className="avatar-btn" data-tip={`Моя карточка: ${managedShortName}`} aria-label={`Моя карточка: ${managedShortName}`}>
                {managedInitials}
              </Link>
              {state.authentication.mode !== 'windows' && <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'logout' })} aria-label="Выйти" data-tip="Выйти">
                <Icon.Logout size={16} />
              </button>}
            </div>
          </header>
          {confirmReset && (
            <p className="status err" role="status" style={{ marginTop: 10 }}>
              Все изменения будут заменены демонстрационными данными. Нажмите кнопку ещё раз для подтверждения.
            </p>
          )}
          <NoticesBanner push={notices} />
          {sync.error && (
            <div className="sync-banner" role="alert">
              <span>{sync.error}</span>
              <button type="button" className="text-action" onClick={reload}>
                Повторить
              </button>
            </div>
          )}
          <main>{sync.loading ? <p className="loading-screen" role="status">Загрузка данных из базы…</p> : <Outlet />}</main>
          <footer className="app-footer">
            Контроль задач · версия <span className="num">{APP_VERSION}</span>
            {sync.mode === 'remote' && (
              <span className={`sync-state${sync.error ? ' error' : sync.saving ? ' saving' : ''}`} role="status">
                <i aria-hidden />
                {sync.error
                  ? 'нет связи с базой'
                  : sync.saving
                    ? 'сохранение…'
                    : sync.syncedAt
                      ? `сохранено в базе · ${fmtTime(sync.syncedAt)}`
                      : 'база данных'}
              </span>
            )}
            {sync.mode === 'local' && <span className="sync-state">данные в этом браузере</span>}
            <NoticesToggle push={notices} />
          </footer>
        </div>
      </div>
    </TaskEditorProvider>
  );
};
