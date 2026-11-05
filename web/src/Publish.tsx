import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Scenario } from '../../shared/types';
import { validateScenario, countIssues, type Issue } from '../../shared/validate';
import type { Platform } from '../../shared/platform';
import { canPublishScenario, friendlyApiError, publishStepLabelKey, validationIssueMessage } from './journey';
import { BLOCK_META, nodeLabel } from './blocks';
import { api } from './api';
import { useT } from './i18n';
import { useModalA11y } from './useModalA11y';
import { useSettings } from './settings';
import { AlertTriangle, Check, Minus, X } from './icons';

interface Step {
  key: string;
  label: string;
  status: 'ok' | 'fail' | 'skipped';
  detail?: string;
}

const STEP_ICON: Record<Step['status'], ReactNode> = {
  ok: <Check />,
  fail: <X />,
  skipped: <Minus />,
};

export function PublishModal({
  botId,
  name,
  scenario,
  platform,
  onClose,
  onSelectBlock,
  onSaved,
  onVersion,
}: {
  botId: string;
  name: string;
  scenario: Scenario;
  /** F3-301/304: платформа бота — валидация модалки обязана совпадать с
   *  серверной, иначе «зелёная» публикация VK-бота падает 422 на сервере. */
  platform?: Platform;
  onClose: () => void;
  onSelectBlock: (id: string) => void;
  onSaved?: () => void;
  /** Синхронизация версии сценария: публикация пишет её на сервере даже при
   *  отказе валидации, а следующее сохранение обязано идти от свежей (WU-03). */
  onVersion?: (version: number) => void;
}) {
  const t = useT();
  const { language, skill_level } = useSettings();
  const issues = useMemo(() => validateScenario(scenario, { platform }), [scenario, platform]);
  const counts = useMemo(() => countIssues(issues), [issues]);

  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [err, setErr] = useState('');
  const [status, setStatus] = useState<{ active: number; version: number; publishedVersion: number | null; webhook?: unknown } | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Esc + фокус-треп (WU-05/UX-02).
  const modalRef = useModalA11y<HTMLDivElement>(onClose);

  useEffect(() => {
    api.getStatus(botId).then(setStatus).catch(() => setStatus(null));
  }, [botId]);

  const blockTitle = (issue: Issue) => {
    const b = issue.blockId ? scenario.blocks[issue.blockId] : undefined;
    if (!b) return '';
    return nodeLabel(b, language);
  };

  async function publish() {
    if (running || !canPublishScenario(issues) || !confirmed) return;
    setRunning(true);
    setErr('');
    setSteps([]);
    try {
      const r = await api.publish(botId, name, JSON.stringify(scenario));
      setSteps(r.steps ?? []);
      setVersion(r.version ?? null);
      setDone(r.ok ? 'ok' : 'fail');
      if (r.ok) {
        setStatus({ active: 1, version: r.version ?? 0, publishedVersion: r.version ?? null, webhook: r.webhook });
        if (typeof r.version === 'number') onVersion?.(r.version);
        onSaved?.();
      }
    } catch (e: any) {
      // 422 приходит вместе со списком замечаний — показываем их, а не «ошибку сети».
      const body = e?.body;
      if (body?.steps) {
        setSteps(body.steps);
        setVersion(body.version ?? null);
        if (body.error) setErr(friendlyApiError(e, language));
        setDone('fail');
        if (typeof body.version === 'number') onVersion?.(body.version);
      } else {
        setErr(friendlyApiError(e, language) || t('publish.error'));
        setDone('fail');
      }
    } finally {
      setRunning(false);
    }
  }

  async function unpublish() {
    setRunning(true);
    setErr('');
    try {
      const r = await api.unpublish(botId);
      setSteps(r.steps ?? []);
      setDone(r.ok ? 'idle' : 'fail');
      setStatus((s) => (s ? { ...s, active: 0, publishedVersion: null } : s));
    } catch (e: any) {
      setErr(friendlyApiError(e, language) || t('publish.unpublishError'));
    } finally {
      setRunning(false);
    }
  }

  const ordered = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  const visibleVersion = version ?? status?.publishedVersion ?? null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal publish" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('publish.title')}</h2>
            <p className="modal-subtitle muted">
              {name}
              {status && (
                <>
                  {' · '}
                  {status.active && status.publishedVersion !== null ? t('publish.published') : t('publish.draft')}
                  {visibleVersion !== null && (
                    <>
                      {' · '}
                      {t('publish.version')} {visibleVersion}
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          <button className="ghost icon-btn" onClick={onClose} title={t('publish.close.title')} aria-label={t('publish.close.title')}>
            <X />
          </button>
        </header>

        <div className="modal-body">
          <div className="publish-summary">
            <div className={counts.errors ? 'pill bad' : 'pill good'}>
              {counts.errors ? t('publish.errors', { n: counts.errors }) : t('publish.noErrors')}
            </div>
            <div className={counts.warnings ? 'pill warn' : 'pill good'}>
              {counts.warnings ? t('publish.warnings', { n: counts.warnings }) : t('publish.noWarnings')}
            </div>
            <div className="spacer" />
            <span className="muted">{t('publish.blocks', { n: Object.keys(scenario.blocks ?? {}).length })}</span>
          </div>

          {ordered.length > 0 && (
            <div className="issue-list">
              {ordered.map((it, i) => {
                const b = it.blockId ? scenario.blocks[it.blockId] : undefined;
                return (
                  <button
                    key={`${it.code}-${i}`}
                    className={`issue ${it.level}`}
                    onClick={() => {
                      if (it.blockId) onSelectBlock(it.blockId);
                      onClose();
                    }}
                  >
                    <span className="issue-mark">
                      {it.level === 'error' ? <X size={10} /> : <AlertTriangle size={10} />}
                    </span>
                    <span className="issue-text">
                      {b && (
                        <span className="issue-block">
                          <span className="dot" style={{ background: BLOCK_META[b.type]?.color ?? '#64748b' }} />
                          {blockTitle(it)}
                        </span>
                      )}
                      {/* Профи видит код и точное имя поля, новичок — человеческое
                          объяснение. Это одни и те же проблемы, два изложения. */}
                      {skill_level === 'high' ? (
                        <>
                          <span className="issue-msg mono">{it.code}</span>
                          {it.blockId && <span className="muted mono">block: {it.blockId}</span>}
                          <span className="muted">{validationIssueMessage(it, language)}</span>
                        </>
                      ) : (
                        <>
                          <span className="issue-msg">{validationIssueMessage(it, language)}</span>
                          {it.hint && <span className="muted">{it.hint}</span>}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!!steps.length && (
            <div className="steps">
              {steps.map((s) => (
                <div key={s.key} className={`step ${s.status}`}>
                  <span className="step-icon">{STEP_ICON[s.status]}</span>
                  <span className="step-label">{t(publishStepLabelKey(s.key), { fallback: s.label })}</span>
                  {s.detail && <span className="muted">{s.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {done === 'ok' && (
            <div className="callout">
              <b>{t('publish.ok')}</b> {t('publish.ok.text')}
            </div>
          )}

          {err && <div className="err">{err}</div>}

          {!steps.length && counts.errors === 0 && (
            <label className="checkline publish-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{t('publish.confirm')}</span>
            </label>
          )}

          {!steps.length && <div className="muted">{t('publish.intro')}</div>}
        </div>

        <footer className="modal-foot">
          {status?.active === 1 && (
            <button className="danger foot-left" disabled={running} onClick={unpublish}>
              {t('publish.unpublish')}
            </button>
          )}
          <span className="muted spacer">{counts.errors ? t('publish.fixErrors') : ''}</span>
          {/* Отказ — ghost: primary в этом подвале ровно один, и это публикация. */}
          <button className="ghost" onClick={onClose}>{t('publish.close')}</button>
          <button className="primary" disabled={running || counts.errors > 0 || !confirmed} onClick={publish}>
            {running ? t('publish.publishing') : t('editor.publish')}
          </button>
        </footer>
      </div>
    </div>
  );
}
