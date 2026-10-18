import { useEffect, useState } from 'react';
import { Button, Checkbox, Select, TextInput } from '../kit';
import { api, readSession } from '../lib/api';
import type { DatabaseConnectionDraft, DatabaseConnectionView, DatabaseProbe } from '../lib/databaseConnection';
import { useStore } from '../lib/store';

export const DatabaseSettings = () => {
  const { sync, reload } = useStore();
  const [loaded, setLoaded] = useState<DatabaseConnectionView | null>(null);
  const [draft, setDraft] = useState<DatabaseConnectionDraft | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<(DatabaseProbe & { saved?: boolean }) | null>(null);
  const token = () => { const value = readSession()?.token; if (!value) throw new Error('Войдите в приложение заново.'); return value; };
  useEffect(() => {
    if (sync.mode !== 'remote') return;
    let cancelled = false;
    Promise.resolve().then(() => api.databaseConnection(token())).then(value => {
      if (!cancelled) { setLoaded(value); setDraft(value); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить настройки.'); });
    return () => { cancelled = true; };
  }, [sync.mode]);
  const change = (patch: Partial<DatabaseConnectionDraft>) => { setDraft(current => current ? { ...current, ...patch } : null); setError(''); setResult(null); };
  const run = async (save: boolean) => {
    if (!draft || busy) return;
    setBusy(true); setError(''); setResult(null);
    const { hasPassword: _hasPassword, saved: _saved, ...fields } = draft as DatabaseConnectionView;
    const payload = { ...fields, ...(draft.auth === 'sql' && password ? { password } : {}) };
    try {
      if (save) {
        const value = await api.saveDatabaseConnection(token(), payload);
        setLoaded(value); setDraft(value); setPassword(''); setResult({ ...value, saved: true }); reload();
      } else setResult(await api.testDatabaseConnection(token(), payload));
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось проверить подключение.'); }
    finally { setBusy(false); }
  };
  return <div className="admin-section">
    <div className="card-head admin-content-head"><div><h2>База данных SQL Server</h2><p className="subtitle">Подключение серверной версии приложения к локальному Microsoft SQL Server 2025.</p></div></div>
    {sync.mode === 'local' ? <p className="help-note">Эта версия работает с данными в браузере. При публикации на Vercel SQL Server не используется. Настройки подключения доступны при локальном запуске и в IIS.</p> : <>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!draft && !error && <p role="status">Загрузка настроек подключения…</p>}
      {draft && <form className="form-stack database-settings-form" onSubmit={e => { e.preventDefault(); void run(true); }}>
        <p className="help-note">Настройки общие для приложения и сохраняются на сервере. При смене базы данные автоматически не переносятся. Если базы ещё нет, при сохранении она будет создана при наличии прав.</p>
        <div className="field-row">
          <label className="field"><span className="caps">Сервер SQL Server</span><TextInput value={draft.server} onChange={e => change({ server: e.target.value })} placeholder="localhost или localhost\SQLEXPRESS" maxLength={200} disabled={busy} /></label>
          <label className="field"><span className="caps">База данных</span><TextInput value={draft.database} onChange={e => change({ database: e.target.value })} placeholder="TaskControlDev" maxLength={121} disabled={busy} /></label>
          <label className="field"><span className="caps">Порт (необязательно)</span><TextInput inputMode="numeric" value={draft.port ?? ''} onChange={e => { if (/^\d{0,5}$/.test(e.target.value)) change({ port: e.target.value ? Number(e.target.value) : undefined }); }} placeholder="Автоматически" disabled={busy} /></label>
        </div>
        <div className="field"><span className="caps">Способ подключения</span><Select label="Способ подключения к SQL Server" value={draft.auth} options={[{ value: 'windows', label: 'Windows — учётная запись сервера приложения' }, { value: 'sql', label: 'Логин и пароль SQL Server' }]} onChange={auth => { change({ auth }); setPassword(''); }} disabled={busy} /></div>
        {draft.auth === 'windows' ? <p className="field-hint">SQL Server проверяет учётную запись, под которой запущен сервер приложения или пул IIS. Она должна иметь доступ к выбранной базе.</p> : <div className="field-row">
          <label className="field"><span className="caps">Логин SQL Server</span><TextInput value={draft.username} onChange={e => change({ username: e.target.value })} autoComplete="off" disabled={busy} /></label>
          <label className="field"><span className="caps">Пароль SQL Server</span><TextInput type="password" value={password} onChange={e => { setPassword(e.target.value); setResult(null); }} placeholder={loaded?.hasPassword ? 'Оставьте пустым, чтобы сохранить пароль' : 'Введите пароль'} autoComplete="new-password" disabled={busy} /><span className="field-hint">Сохранённый пароль в браузер не передаётся.</span></label>
        </div>}
        <Checkbox checked={draft.encrypt} onChange={encrypt => change({ encrypt })} disabled={busy}>Шифровать соединение с SQL Server</Checkbox>
        <Checkbox checked={draft.trustServerCertificate} onChange={trustServerCertificate => change({ trustServerCertificate })} disabled={busy}>Доверять сертификату локального SQL Server</Checkbox>
        <div className="form-actions"><Button onClick={() => void run(false)} disabled={busy}>{busy ? 'Подключение…' : 'Проверить подключение'}</Button><Button type="submit" variant="primary" disabled={busy}>Сохранить и подключиться</Button></div>
        {result && <p className="help-note ok" role="status">{result.saved ? 'Настройки сохранены. Подключение применено.' : 'Подключение успешно.'} SQL Server {result.version} · {result.edition}.{!result.databaseExists && ' Базы пока нет: она будет создана при сохранении.'}</p>}
      </form>}
    </>}
  </div>;
};
