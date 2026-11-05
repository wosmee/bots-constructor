// История версий сценария и откат. Все версии давно сохраняются в D1
// (каждое сохранение = новая строка), но UI к ним не было.
import { useEffect, useState } from 'react';
import { api } from './api';
import { useT } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { useModalA11y } from './useModalA11y';
import { X } from './icons';

interface VersionRow {
  version: number;
  name: string;
  updated_at: number;
  size: number;
}

interface PublicationState {
  active: boolean;
  publishedVersion: number | null;
}

export function VersionsModal({
  botId,
  onClose,
  onRollback,
}: {
  botId: string;
  onClose: () => void;
  /** version — новая версия, которую сервер записал при откате (WU-03). */
  onRollback: (flowJson: string, version?: number) => void;
}) {
  const t = useT();
  const { language } = useSettings();
  const locale = language === 'en' ? 'en-GB' : 'ru-RU';
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [publication, setPublication] = useState<PublicationState>({ active: false, publishedVersion: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [publishing, setPublishing] = useState<number | null>(null);
  // Esc + фокус-треп (WU-05/UX-02).
  const modalRef = useModalA11y<HTMLDivElement>(onClose);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const r = await api.versions(botId);
      setVersions(r.versions ?? []);
      setPublication({ active: Boolean(r.active), publishedVersion: r.publishedVersion ?? null });
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

  async function rollback(version: number) {
    if (!window.confirm(t('versions.confirm', { v: version }))) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.rollback(botId, version);
      onRollback(r.flow_json, r.version);
      onClose();
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setBusy(false);
    }
  }

  async function publish(version: number) {
    if (!window.confirm(t('versions.publishConfirm', { v: version }))) return;
    setPublishing(version);
    setErr('');
    try {
      await api.publishVersion(botId, version);
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setPublishing(null);
    }
  }

  async function remove(version: number) {
    if (!window.confirm(t('versions.deleteConfirm', { v: version }))) return;
    setBusy(true);
    setErr('');
    try {
      await api.deleteVersion(botId, version);
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm(t('versions.deleteAllConfirm'))) return;
    setBusy(true);
    setErr('');
    try {
      await api.clearVersions(botId);
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('versions.title')}</h2>
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
            {err && <div className="err">{err}</div>}
            {loading && <p className="muted">{t('versions.loading')}</p>}
            {!loading && versions.length === 0 && <p className="muted">{t('versions.empty')}</p>}
            {versions.map((v, i) => {
              const isPublished = publication.active && publication.publishedVersion !== null && v.version === publication.publishedVersion;
              return (
                <div className="ver-row" key={v.version}>
                  <div>
                    <b className="mono">v{v.version}</b> <span className="muted">{v.name}</span>
                    {isPublished && <span className="tag">{t('versions.published')}</span>}
                    {!isPublished && i === 0 && <span className="tag">{t('versions.current')}</span>}
                </div>
                <div className="muted">
                  {new Date(v.updated_at).toLocaleString(locale)} · {t('versions.kb', { size: (v.size / 1024).toFixed(1) })}
                </div>
                <div className="ver-actions">
                  {i !== 0 && <button onClick={() => rollback(v.version)} disabled={busy || publishing !== null}>{t('versions.rollback')}</button>}
                  <button onClick={() => publish(v.version)} disabled={busy || publishing !== null}>
                    {publishing === v.version ? t('publish.publishing') : t('versions.publish')}
                  </button>
                  <button className="danger-action" onClick={() => void remove(v.version)} disabled={busy || publishing !== null || isPublished || i === 0}>
                    {t('versions.delete')}
                  </button>
                </div>
                </div>
              );
            })}
          </section>
        </div>
        <footer className="modal-foot">
          <button className="danger-action foot-left" onClick={() => void clearHistory()} disabled={busy || versions.length === 0}>
            {t('versions.deleteAll')}
          </button>
          <button className="ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
