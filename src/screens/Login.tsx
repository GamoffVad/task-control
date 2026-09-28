import { TextInput } from '../kit';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Icon } from '../components/Icons';
import { Logo } from '../components/Shell';
import { ThemeToggle } from '../components/ThemeToggle';
import { useStore } from '../lib/store';
import { APP_VERSION } from '../version';

const FEATURES = [
  ['Календарь', 'День, неделя, рабочая неделя и месяц. Задачи создаются кликом по сетке.'],
  ['Планирование', 'Матрица «позиция плана × сотрудник» на неделю с пятницы по четверг.'],
  ['Контроль', 'Просроченные и предстоящие задачи по срокам в пяти колонках.'],
  ['Отчётность', 'Недельный отчёт об исполнении: печать и выгрузка в CSV.'],
  ['Показатели', 'Баллы сотрудников за месяц, квартал, полугодие и год.'],
  ['Переписка', 'Общий канал отдела для коротких сообщений.'],
];

export const Login = () => {
  const { state, signIn, signInWindows, windowsAuthAvailable, authenticationReady } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const automaticAttempt = useRef(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/calendar';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (login.trim().length < 2 || /\s/.test(login.trim())) {
      setError('Укажите корпоративный логин без пробелов.');
      return;
    }
    if (password.length < 6) {
      setError('Пароль короче 6 символов: проверьте раскладку и повторите ввод.');
      return;
    }
    setPending(true);
    const failure = await signIn(login, password);
    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    navigate(from, { replace: true });
  };

  const submitWindows = async () => {
    setPending(true);
    setError('');
    const failure = await signInWindows();
    setPending(false);
    if (failure) return setError(failure);
    navigate(from, { replace: true });
  };

  useEffect(() => {
    if (state.user || !authenticationReady || state.authentication.mode !== 'windows' || !windowsAuthAvailable || automaticAttempt.current) return;
    automaticAttempt.current = true;
    void submitWindows();
    // Автоматическая попытка выполняется один раз после загрузки публичной настройки входа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticationReady, state.authentication.mode, state.user, windowsAuthAvailable]);

  // Режим Windows выбран, но сервер его не выполняет: пускаем по форме, иначе войти было бы нельзя.
  const windowsFallback = state.authentication.mode === 'windows' && authenticationReady && !windowsAuthAvailable;
  const showForm = state.authentication.mode === 'form' || emergency || windowsFallback;

  if (state.user) return <Navigate to={from} replace />;
  if (!authenticationReady) return <div className="login-page"><div className="login-side"><p className="loading-screen" role="status">Проверка способа входа…</p></div></div>;

  return (
    <div className="login-page">
      <div className="login-side">
        <div className="login-card">
          <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Logo context="планирование и контроль исполнения" />
            <ThemeToggle />
          </div>
          <h1 style={{ fontSize: 24 }}>Вход в систему</h1>
          <p className="subtitle">{showForm ? 'Введите рабочую почту и пароль.' : 'Используйте доменную учётную запись Windows.'}</p>
          {state.authentication.mode === 'windows' && !emergency && <div className="windows-login-panel">
            <p className="windows-auto-status" role="status"><Icon.Lock size={16} /> {pending ? 'Выполняется вход через Windows…' : 'Ожидание корпоративной учётной записи…'}</p>
            {!windowsAuthAvailable && <p className="field-error" role="alert">Windows-аутентификация не настроена на этом сервере.</p>}
            {error && <p className="field-error" role="alert">{error}</p>}
            {state.authentication.allowEmergencyForm && <button type="button" className="text-action" onClick={() => { setEmergency(true); setError(''); }}>Резервный вход администратора</button>}
          </div>}
          {windowsFallback && <p className="help-note amber" style={{ marginTop: 16 }}>
            Администратор выбрал вход через Windows, но сервер пока не получает доменного пользователя, поэтому вход выполняется по логину и паролю.
            Настройку можно проверить в разделе «Администрирование» → «Аутентификация».
          </p>}
          {showForm && <form className="form-stack" style={{ marginTop: 20 }} onSubmit={submit} noValidate>
            <label className="field">
              <span className="caps">Логин</span>
              <TextInput
                type="text"
                autoComplete="username"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="ivanov"
                invalid={!!error}
              />
            </label>
            <label className="field">
              <span className="caps">Пароль</span>
              <TextInput
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Не менее 6 символов"
                invalid={!!error}
              />
            </label>
            <div className="status err" role="alert">{error}</div>
            <button type="submit" className="btn btn--primary" style={{ minHeight: 46 }} disabled={pending}>
              <Icon.Enter size={15} /> {pending ? 'Вход…' : 'Войти'}
            </button>
          </form>}
          {state.authentication.mode === 'windows' && emergency && <button type="button" className="text-action login-back" onClick={() => { setEmergency(false); setError(''); }}>Вернуться к входу через Windows</button>}
          {showForm && <div className="demo-hint">
            Демонстрационный доступ, пароль <span className="num">123456</span>:
            <br />
            администратор — <span className="num">user</span>
            <br />
            исполнитель — <span className="num">sidorov</span>
          </div>}
          <p className="app-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
            Версия <span className="num">{APP_VERSION}</span>
          </p>
        </div>
      </div>
      <section className="login-intro" aria-label="О приложении">
        <p className="caps">Отдел разработки</p>
        <p className="lead">Планирование задач и контроль исполнения в одном месте</p>
        <ul className="feature-list">
          {FEATURES.map(([t, d]) => (
            <li key={t}>
              <b>{t}</b>
              {d}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
