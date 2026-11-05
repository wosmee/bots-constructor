// Страница «Пользователи» (staff-only): поиск аккаунта по логину, его боты со
// статусами версий, логи отдельного бота (LogsModal) и агрегированные события
// по всем ботам владельца. Read-only: никаких записей чужих данных отсюда нет.
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type AdminLogRow,
  type AdminUserBot,
  type AdminUserProfile,
} from './api';
import { useT, type TKey } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { logLabel } from './logLabels';
import { LogsModal } from './LogsModal';
import { ArrowLeft, Bot, Search } from './icons';

// Роль — подписанный ключ словаря; неизвестная роль рендерится как есть.
function roleKey(role: string): TKey | null {
  return role === 'admin' || role === 'moderator' || role === 'user'
    ? (`admin.user.role.${role}` as TKey)
    : null;
}

export function AdminPage({ onBack }: { onBack: () => void }) {
  const t = useT();
  const settings = useSettings();
  const locale = settings.language === 'en' ? 'en-GB' : 'ru-RU';

  const [loginInput, setLoginInput] = useState('');
  const [searchedLogin, setSearchedLogin] = useState('');
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // агрегированные логи
  const [logs, setLogs] = useState<AdminLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [botFilter, setBotFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [limit, setLimit] = useState(100);

  // логи одного бота — существующая модалка (те же /api/bots/:id/logs)
  const [logsBot, setLogsBot] = useState<{ id: string; name: string } | null>(null);

  const loadLogs = useCallback(
    async (login: string) => {
      setLogsLoading(true);
      try {
        const uid = userFilter.trim() ? Number(userFilter.trim()) : null;
        const r = await api.admin.userLogs(login, {
          limit,
          botId: botFilter || undefined,
          userId: Number.isFinite(uid as number) ? (uid as number) : undefined,
        });
        setLogs(r.logs ?? []);
      } catch (e: any) {
        setErr(friendlyApiError(e, settings.language));
      } finally {
        setLogsLoading(false);
      }
    },
    [botFilter, userFilter, limit, settings.language]
  );

  async function search(loginRaw: string) {
    const login = loginRaw.trim();
    if (!login || loading) return;
    setLoading(true);
    setErr('');
    setNotFound(false);
    setProfile(null);
    setLogs([]);
    setSearchedLogin(login);
    try {
      const r = await api.admin.user(login);
      setProfile(r);
      setBotFilter('');
      setUserFilter('');
      await loadLogs(login);
    } catch (e: any) {
      // 404 — «аккаунт не найден»: не ошибка, а результат поиска.
      if ((e as any)?.status === 404) setNotFound(true);
      else setErr(friendlyApiError(e, settings.language));
    } finally {
      setLoading(false);
    }
  }

  // Фильтр бота и лимит меняют выборку сразу; user_id — по Enter/кнопке,
  // чтобы не дёргать сервер на каждую клавишу.
  useEffect(() => {
    if (profile) void loadLogs(searchedLogin);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [botFilter, limit]);

  return (
    <div className="app">
      <header className="topbar data-topbar">
        <button className="back-control" onClick={onBack} aria-label={t('nav.toBots')}>
          <ArrowLeft /> {t('nav.toBots')}
        </button>
        <div className="brand data-brand">
          <span className="logo"><Bot /></span>
          <span>{t('app.brand')}</span>
        </div>
        <span className="who">{t('admin.nav')}</span>
        <div className="spacer" />
        <div className="topbar-group" aria-hidden="true" />
      </header>

      <main className="data-page">
        <h1 className="sr-only">{t('admin.title')}</h1>
        <div className="data-head">
          <h1>{t('admin.title')}</h1>
        </div>
        <div className="callout">{t('admin.hint')}</div>

        <div className="data-toolbar">
          <input
            placeholder={t('admin.search.placeholder')}
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search(loginInput);
            }}
          />
          <button className="primary" onClick={() => void search(loginInput)} disabled={loading || !loginInput.trim()}>
            <Search /> {loading ? t('admin.searching') : t('admin.search.submit')}
          </button>
        </div>

        {err && <div className="err">{err}</div>}
        {notFound && <div className="err">{t('admin.notFound')}</div>}

        {profile && (
          <>
            <div className="data-card">
              <h3>{t('admin.user.login')}: {profile.user.login}</h3>
              <div className="muted">
                {t('admin.user.role')}: <span className="badge neutral">{roleKey(profile.user.role) ? t(roleKey(profile.user.role)!) : profile.user.role}</span>
                {' · '}
                {t('admin.user.registered')}: {new Date(profile.user.created_at).toLocaleDateString(locale)}
              </div>
              <div className="muted mono">{t('admin.user.id')}: {profile.user.id}</div>
              <div className="muted">{t('admin.user.totals', { bots: profile.totals.bots, events: profile.totals.logEvents })}</div>
            </div>

            <div className="data-card">
              <h3>{t('admin.bots.title')}</h3>
              {profile.bots.length === 0 ? (
                <p className="muted">{t('admin.bots.empty')}</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('admin.bots.name')}</th>
                        <th>{t('admin.bots.status')}</th>
                        <th>{t('admin.bots.versions')}</th>
                        <th>{t('admin.bots.created')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {profile.bots.map((b: AdminUserBot) => (
                        <tr key={b.id}>
                          <td>
                            {b.name}
                            <div className="muted mono">{b.id.slice(0, 8)}</div>
                          </td>
                          <td>
                            <span className={`badge ${b.active ? 'ok' : 'neutral'}`}>
                              {b.active ? t('admin.bots.status.published') : t('admin.bots.status.draft')}
                            </span>
                          </td>
                          <td className="mono">
                            v{b.scenario_version ?? '—'} / {b.published_version != null ? `v${b.published_version}` : '—'}
                          </td>
                          <td>{new Date(b.created_at).toLocaleDateString(locale)}</td>
                          <td>
                            <button onClick={() => setLogsBot({ id: b.id, name: b.name })}>
                              {t('admin.bots.logs')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="data-card">
              <h3>{t('admin.logs.title')}</h3>
              <div className="muted">{t('admin.logs.hint')}</div>
              <div className="data-toolbar">
                <select
                  value={botFilter}
                  onChange={(e) => setBotFilter(e.target.value)}
                  aria-label={t('admin.logs.botFilter')}
                >
                  <option value="">{t('admin.logs.botFilter.all')}</option>
                  {profile.bots.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <input
                  placeholder={t('admin.logs.userId')}
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadLogs(searchedLogin);
                  }}
                />
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  aria-label={t('admin.logs.limit')}
                >
                  {[50, 100, 200, 500].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button onClick={() => void loadLogs(searchedLogin)} disabled={logsLoading}>
                  {logsLoading ? t('auth.busy') : t('admin.logs.refresh')}
                </button>
              </div>
              {!logsLoading && logs.length === 0 ? (
                <p className="muted">{t('admin.logs.empty')}</p>
              ) : (
                <div className="log-list">
                  {logs.map((l) => (
                    <div className="log-row" key={`${l.bot_id}:${l.id}`}>
                      <span className="log-ts mono">{new Date(l.ts).toLocaleString(locale)}</span>
                      <span className="log-user mono" title={t('admin.logs.bot')}>{l.bot_name}</span>
                      <span className="log-user mono">{l.user_id ?? '—'}</span>
                      <span className="log-event-wrap">
                        <span className={`log-event${/fail|error|blocked/.test(l.event) ? ' bad' : ''}`}>{logLabel(l.event, t)}</span>
                        <span className="log-raw mono" title={l.event}>{l.event}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Логи одного бота: та же модалка, что у владельца. Staff-доступ к
            GET /api/bots/:id/logs разрешён canAccessAnyBot на воркере. */}
        {logsBot && <LogsModal botId={logsBot.id} onClose={() => setLogsBot(null)} />}
      </main>
    </div>
  );
}

export default AdminPage;
