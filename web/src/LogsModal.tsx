// События бота. Таблица logs пишется с первого дня, но посмотреть её было
// негде — теперь сценарий можно отлаживать, не открывая Telegram.
import { useEffect, useState } from 'react';
import { api } from './api';
import { useT } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { logLabel } from './logLabels';
import { useModalA11y } from './useModalA11y';
import { X } from './icons';

interface LogRow {
  id: number;
  user_id: number | null;
  event: string;
  ts: number;
}

export function LogsModal({ botId, onClose }: { botId: string; onClose: () => void }) {
  const t = useT();
  const { language } = useSettings();
  const locale = language === 'en' ? 'en-GB' : 'ru-RU';
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Esc + фокус-треп (WU-05/UX-02).
  const modalRef = useModalA11y<HTMLDivElement>(onClose);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const uid = userFilter.trim() ? Number(userFilter.trim()) : null;
      const r = await api.logs(botId, 200, Number.isFinite(uid as number) ? (uid as number) : null);
      setLogs(r.logs ?? []);
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [botId]);

  const shown = onlyErrors ? logs.filter((l) => /fail|error|blocked/.test(l.event)) : logs;

  async function clear() {
    if (!window.confirm(t('logs.clearConfirm'))) return;
    setClearing(true);
    setErr('');
    try {
      await api.clearLogs(botId);
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('logs.title')}</h2>
          </div>
          <button
            className="ghost icon-btn"
            onClick={onClose}
            aria-label={t('common.close.title')}
            title={t('common.close.title')}
          >
            <X />
          </button>
        </header>
        <div className="modal-body">
          <section className="modal-section">
            <div className="callout">{t('logs.explanation')}</div>
          </section>
          <section className="modal-section">
            <div className="search-row">
              <input
                placeholder={t('logs.userId')}
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') load();
                }}
              />
              <label className="checkline">
                <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                {t('logs.onlyErrors')}
              </label>
              <button onClick={load} disabled={loading}>
                {loading ? t('auth.busy') : t('logs.refresh')}
              </button>
            </div>
          </section>
          <section className="modal-section">
            {err && <div className="err">{err}</div>}
            {!loading && shown.length === 0 && <p className="muted">{t('logs.empty')}</p>}
            <div className="log-list">
              {shown.map((l) => (
                <div className="log-row" key={l.id}>
                  <span className="log-ts mono">{new Date(l.ts).toLocaleString(locale)}</span>
                  <span className="log-user mono">{l.user_id ?? '—'}</span>
                  <span className="log-event-wrap">
                    <span className={`log-event${/fail|error|blocked/.test(l.event) ? ' bad' : ''}`}>{logLabel(l.event, t)}</span>
                    <span className="log-raw mono" title={l.event}>{l.event}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <footer className="modal-foot">
          <button className="danger-action foot-left" onClick={() => void clear()} disabled={clearing || loading}>
            {t('logs.clear')}
          </button>
          <button className="ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
