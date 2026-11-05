// Страница «Библиотека»: подсценарии владельца — именованные переиспользуемые
// фрагменты сценария с входами/выходами и историей ревизий. Уровень АККАУНТА,
// а не бота: библиотека личная, любой бот владельца может вызывать её
// фрагменты блоком «Подсценарий». Правка содержимого (flow_json) живёт в
// конструкторе — здесь управление списком: создание, имя/описание, копия,
// удаление, ревизии и пробный прогон.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useT } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { useModalA11y } from './useModalA11y';
import { ExitHost } from './Surface';
import { ArrowLeft, Bot, Copy, History, Play, Plus, RefreshCw, Trash, X } from './icons';
import './subflows.css';

// Вход/выход фрагмента (shared/subflow.ts, SubflowIoDef).
interface IoDef {
  name: string;
  description: string;
  required: boolean;
}

interface SubflowItem {
  id: string;
  name: string;
  description: string;
  revision: number;
  inputs: IoDef[];
  outputs: IoDef[];
  created_at: number;
  updated_at: number;
  used_by_bots?: number;
}

interface VersionItem {
  revision: number;
  name: string;
  created_at: number;
  size: number;
  current: boolean;
}

// Замечания раскрытия из /preview — данные с воркера (shared/subflow.ts,
// SubflowIssue), а не UI-строки: message/hint приходят готовым текстом.
interface PreviewIssue {
  level?: 'error' | 'warn';
  code?: string;
  message?: string;
  hint?: string;
}

interface PreviewResult {
  ok: boolean;
  issues: PreviewIssue[];
  log: { who: 'bot' | 'user'; text: string }[];
}

function fmtTs(ts: number, locale: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(ts);
  }
}

export function SubflowsPage({ onBack, onOpenGuide }: { onBack: () => void; onOpenGuide?: () => void }) {
  const t = useT();
  const settings = useSettings();
  const locale = settings.language === 'en' ? 'en-GB' : 'ru-RU';

  const [items, setItems] = useState<SubflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  // создание / правка имени и описания
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  // Данные правки живы и во время выхода модалки (ExitHost): editing при
  // закрытии обнуляется сразу, а ref хранит последний объект до конца анимации.
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  const editingRef = useRef<{ id: string; name: string; description: string } | null>(null);
  if (editing) editingRef.current = editing;
  const editTarget = editing ?? editingRef.current;

  // удаление с явным предупреждением (встроенное подтверждение, как в «Оплате»)
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // история ревизий: объект модалки живёт в ref, чтобы ExitHost дорисовал выход
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const versionsForRef = useRef<string | null>(null);
  if (versionsFor) versionsForRef.current = versionsFor;
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // пробный прогон
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const previewForRef = useRef<string | null>(null);
  if (previewFor) previewForRef.current = previewFor;
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Esc + фокус-треп инлайн-модалок (WU-05/UX-02).
  const editModalRef = useModalA11y<HTMLDivElement>(() => setEditing(null));
  const versionsModalRef = useModalA11y<HTMLDivElement>(() => setVersionsFor(null));
  const previewModalRef = useModalA11y<HTMLDivElement>(() => setPreviewFor(null));

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.subflows.list();
      setItems((r.subflows ?? []) as SubflowItem[]);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setLoading(false);
    }
  }, [settings.language]);

  useEffect(() => {
    void load();
  }, [load]);

  // Поиск локальный: список и так целиком на клиенте, сервер дёргать нечего.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (f) => f.name.toLowerCase().includes(needle) || (f.description ?? '').toLowerCase().includes(needle)
    );
  }, [items, q]);

  const byId = useCallback((id: string | null) => items.find((f) => f.id === id) ?? null, [items]);

  // ---------------- создание / правка / копия / удаление ----------------

  async function createSubflow() {
    const nameVal = newName.trim();
    if (!nameVal || busy) return;
    setBusy(true);
    setErr('');
    try {
      // Стартовое содержимое: сообщение + возврат — минимальный валидный
      // фрагмент (движок требует start + blocks и блок subflow_return).
      const starter = {
        version: 1,
        start: 'f1',
        blocks: {
          f1: { id: 'f1', type: 'message', params: { text: t('subflows.create.starter') }, next: 'r1' },
          r1: { id: 'r1', type: 'subflow_return', params: {} },
        },
      };
      await api.subflows.create({
        name: nameVal,
        description: newDesc.trim(),
        flow_json: JSON.stringify(starter),
      });
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      setNote(t('subflows.create.done'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    if (!editing || busy) return;
    const nameVal = editing.name.trim();
    if (!nameVal) return;
    setBusy(true);
    setErr('');
    try {
      // PUT принимает частичные поля: flow_json не отправляем — содержимое
      // фрагмента не меняется, только имя/описание (новая ревизия на воркере).
      await api.subflows.save(editing.id, { name: nameVal, description: editing.description.trim() });
      setEditing(null);
      setNote(t('subflows.saved'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(f: SubflowItem) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.subflows.get(f.id);
      const src = r.subflow;
      await api.subflows.create({
        name: `${f.name}${t('subflows.copySuffix')}`.slice(0, 64),
        description: src?.description ?? f.description,
        flow_json: src?.flow_json ?? '',
        inputs: src?.inputs ?? [],
        outputs: src?.outputs ?? [],
      });
      setNote(t('subflows.duplicate.done'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: SubflowItem) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.subflows.remove(f.id);
      setConfirmingId(null);
      setNote(t('subflows.deleted'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  // ---------------- ревизии ----------------

  const loadVersions = useCallback(async (id: string) => {
    setVersionsLoading(true);
    setErr('');
    try {
      const r = await api.subflows.versions(id);
      setVersions(r.versions ?? []);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setVersionsLoading(false);
    }
  }, [settings.language]);

  function openVersions(f: SubflowItem) {
    setVersionsFor(f.id);
    setVersions([]);
    void loadVersions(f.id);
  }

  async function rollback(id: string, revision: number) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.subflows.rollback(id, revision);
      setNote(t('subflows.restored', { n: revision }));
      await Promise.all([loadVersions(id), load()]);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  // ---------------- пробный прогон ----------------

  function openPreview(f: SubflowItem) {
    setPreviewFor(f.id);
    setPreviewInputs(Object.fromEntries((f.inputs ?? []).map((i) => [i.name, ''])));
    setPreviewResult(null);
  }

  async function runPreview() {
    const id = previewFor;
    if (!id || previewBusy) return;
    setPreviewBusy(true);
    setErr('');
    try {
      const r = await api.subflows.preview(id, { inputs: previewInputs });
      setPreviewResult({ ok: r.ok, issues: (r.issues ?? []) as PreviewIssue[], log: r.log ?? [] });
    } catch (e: any) {
      // 422 от /preview несёт тело с issues (reqKeepBody его сохраняет) —
      // показываем замечания раскрытия, а не просто «ошибка».
      const issues = (e?.body as any)?.issues;
      if (Array.isArray(issues)) {
        setPreviewResult({ ok: false, issues: issues as PreviewIssue[], log: [] });
      } else {
        setErr(friendlyApiError(e, settings.language));
      }
    } finally {
      setPreviewBusy(false);
    }
  }

  const versionsSub = byId(versionsForRef.current);
  const previewSub = byId(previewForRef.current);

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
        <span className="who">{t('subflows.nav')}</span>
        <div className="spacer" />
        <div className="topbar-group" aria-hidden="true" />
      </header>

      <main className="data-page">
        <h1 className="sr-only">{t('subflows.title')}</h1>
        <div className="data-head">
          <h1>{t('subflows.title')}</h1>
        </div>
        <div className="muted">{t('subflows.hint')}</div>
        <div className="callout">{t('subflows.hint.canvas')}</div>

        {err && <div className="err">{err}</div>}
        {note && <div className="muted">{note}</div>}

        <div className="data-toolbar">
          <input
            placeholder={t('subflows.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('subflows.search')}
          />
          <span className="muted">{t('subflows.count', { n: filtered.length })}</span>
          <button
            className="primary"
            onClick={() => {
              setNote('');
              setCreateOpen((v) => !v);
            }}
          >
            <Plus /> {t('subflows.new')}
          </button>
          <button onClick={() => void load()} disabled={loading} title={t('data.refresh')} aria-label={t('data.refresh')}>
            <RefreshCw /> {t('data.refresh')}
          </button>
        </div>

        {createOpen && (
          <form
            className="data-card"
            aria-label={t('subflows.create.title')}
            onSubmit={(e) => {
              e.preventDefault();
              void createSubflow();
            }}
          >
            <h3>{t('subflows.create.title')}</h3>
            <div className="sf-field">
              <label className="field-label" htmlFor="sf-new-name">{t('subflows.name')}</label>
              <input
                id="sf-new-name"
                type="text"
                placeholder={t('subflows.name.placeholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="sf-field">
              <label className="field-label" htmlFor="sf-new-desc">{t('subflows.description')}</label>
              <input
                id="sf-new-desc"
                type="text"
                placeholder={t('subflows.description.placeholder')}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <div className="row-actions">
              <button className="primary" type="submit" disabled={busy || !newName.trim()}>
                {busy ? t('auth.busy') : t('subflows.create.submit')}
              </button>
              <button type="button" onClick={() => setCreateOpen(false)}>{t('subflows.cancel')}</button>
            </div>
          </form>
        )}

        {loading && (
          <div className="data-empty">
            <p className="muted">{t('data.loading')}</p>
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="data-empty">
            <h3>{t('subflows.empty.title')}</h3>
            <p className="muted">{t('subflows.empty.text')}</p>
            <div className="data-toolbar" style={{ justifyContent: 'center' }}>
              <button className="primary" onClick={() => setCreateOpen(true)}>
                <Plus /> {t('subflows.new')}
              </button>
              {onOpenGuide && (
                <button className="ghost" onClick={onOpenGuide}>
                  {t('subflows.guideLink')}
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && items.length > 0 && filtered.length === 0 && (
          <div className="data-empty">
            <p className="muted">{t('subflows.search.empty')}</p>
          </div>
        )}

        {!loading && filtered.map((f) => (
          <div className="sf-card" key={f.id}>
            <div className="sf-card-head">
              <h3>{f.name}</h3>
              <span className="badge accent" title={t('subflows.rev', { n: f.revision })}>
                {t('subflows.rev.short', { n: f.revision })}
              </span>
              {(f.used_by_bots ?? 0) > 0 && (
                <span className="badge ok">{t('subflows.usedBy', { n: f.used_by_bots ?? 0 })}</span>
              )}
              <span className="spacer" />
              <div className="sf-card-actions">
                <button type="button" onClick={() => openPreview(f)}>
                  <Play /> {t('subflows.preview')}
                </button>
                <button type="button" onClick={() => openVersions(f)}>
                  <History /> {t('subflows.versions')}
                </button>
                <button type="button" onClick={() => { setNote(''); setEditing({ id: f.id, name: f.name, description: f.description }); }}>
                  {t('subflows.edit')}
                </button>
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('subflows.duplicate')}
                  aria-label={t('subflows.duplicate')}
                  disabled={busy}
                  onClick={() => void duplicate(f)}
                >
                  <Copy />
                </button>
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('subflows.delete')}
                  aria-label={t('subflows.delete')}
                  onClick={() => {
                    setConfirmingId(confirmingId === f.id ? null : f.id);
                    setNote('');
                  }}
                >
                  <Trash />
                </button>
              </div>
            </div>

            {f.description && <p className="sf-desc">{f.description}</p>}

            <div className="sf-io">
              <span className="field-label">{t('subflows.inputs')}:</span>
              {(f.inputs ?? []).length ? (
                (f.inputs ?? []).map((i) => (
                  <span key={i.name} className="data-var" title={i.description || (i.required ? t('subflows.io.required') : undefined)}>
                    {i.name}{i.required ? '*' : ''}
                  </span>
                ))
              ) : (
                <span className="muted">{t('subflows.io.none')}</span>
              )}
            </div>
            <div className="sf-io">
              <span className="field-label">{t('subflows.outputs')}:</span>
              {(f.outputs ?? []).length ? (
                (f.outputs ?? []).map((o) => (
                  <span key={o.name} className="data-var" title={o.description || undefined}>
                    {o.name}
                  </span>
                ))
              ) : (
                <span className="muted">{t('subflows.io.none')}</span>
              )}
            </div>

            {confirmingId === f.id && (
              <div className="sf-confirm" role="alertdialog" aria-label={t('subflows.delete.confirm', { name: f.name })}>
                <p>
                  {t('subflows.delete.confirm', { name: f.name })} {t('subflows.delete.warn')}
                </p>
                <button className="danger" disabled={busy} onClick={() => void remove(f)}>
                  {t('subflows.delete.yes')}
                </button>
                <button disabled={busy} onClick={() => setConfirmingId(null)}>
                  {t('subflows.cancel')}
                </button>
              </div>
            )}
          </div>
        ))}
      </main>

      {/* ---- правка имени и описания ---- */}
      <ExitHost open={!!editing}>
        {editTarget && (
          <div className="modal-backdrop" onClick={() => setEditing(null)}>
            <div ref={editModalRef} className="modal" role="dialog" aria-modal="true" aria-label={t('subflows.edit.title')} onClick={(e) => e.stopPropagation()}>
              <header className="modal-head">
                <div className="modal-head-text">
                  <h2 className="modal-title">{t('subflows.edit.title')}</h2>
                </div>
                <button className="ghost icon-btn" onClick={() => setEditing(null)} title={t('common.close.title')} aria-label={t('common.close.title')}>
                  <X />
                </button>
              </header>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveMeta();
                }}
              >
                <div className="modal-body">
                  <div className="sf-field">
                    <label className="field-label" htmlFor="sf-edit-name">{t('subflows.name')}</label>
                    <input
                      id="sf-edit-name"
                      type="text"
                      value={editTarget.name}
                      onChange={(e) => editTarget && setEditing({ ...editTarget, name: e.target.value })}
                    />
                  </div>
                  <div className="sf-field">
                    <label className="field-label" htmlFor="sf-edit-desc">{t('subflows.description')}</label>
                    <input
                      id="sf-edit-desc"
                      type="text"
                      value={editTarget.description}
                      onChange={(e) => editTarget && setEditing({ ...editTarget, description: e.target.value })}
                    />
                  </div>
                </div>
                <footer className="modal-foot">
                  <button className="primary" type="submit" disabled={busy || !editTarget.name.trim()}>
                    {busy ? t('auth.busy') : t('subflows.save')}
                  </button>
                  <button className="ghost" type="button" onClick={() => setEditing(null)}>
                    {t('subflows.cancel')}
                  </button>
                </footer>
              </form>
            </div>
          </div>
        )}
      </ExitHost>

      {/* ---- история ревизий ---- */}
      <ExitHost open={!!versionsFor}>
        {versionsSub && (
          <div className="modal-backdrop" onClick={() => setVersionsFor(null)}>
            <div ref={versionsModalRef} className="modal" role="dialog" aria-modal="true" aria-label={t('subflows.versions.title')} onClick={(e) => e.stopPropagation()}>
              <header className="modal-head">
                <div className="modal-head-text">
                  <h2 className="modal-title">{t('subflows.versions.title')}</h2>
                  <span className="muted">{versionsSub.name}</span>
                </div>
                <button className="ghost icon-btn" onClick={() => setVersionsFor(null)} title={t('common.close.title')} aria-label={t('common.close.title')}>
                  <X />
                </button>
              </header>
              <div className="modal-body">
                {versionsLoading && <p className="muted">{t('data.loading')}</p>}
                {!versionsLoading && versions.length === 0 && <p className="muted">{t('subflows.versions.empty')}</p>}
                {versions.map((v) => (
                  <div className="ver-row" key={v.revision}>
                    <div>
                      <b className="mono">{t('subflows.rev.short', { n: v.revision })}</b> <span className="muted">{v.name}</span>
                      {v.current && <span className="tag">{t('subflows.versions.current')}</span>}
                    </div>
                    <div className="muted">
                      {fmtTs(v.created_at, locale)} · {t('versions.kb', { size: (v.size / 1024).toFixed(1) })}
                    </div>
                    <div className="ver-actions">
                      {!v.current && (
                        <button disabled={busy} onClick={() => void rollback(versionsSub.id, v.revision)}>
                          {t('subflows.restore')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <footer className="modal-foot">
                <button className="ghost" onClick={() => setVersionsFor(null)}>
                  {t('common.close')}
                </button>
              </footer>
            </div>
          </div>
        )}
      </ExitHost>

      {/* ---- пробный прогон ---- */}
      <ExitHost open={!!previewFor}>
        {previewSub && (
          <div className="modal-backdrop" onClick={() => setPreviewFor(null)}>
            <div ref={previewModalRef} className="modal" role="dialog" aria-modal="true" aria-label={t('subflows.preview.title')} onClick={(e) => e.stopPropagation()}>
              <header className="modal-head">
                <div className="modal-head-text">
                  <h2 className="modal-title">{t('subflows.preview.title')}</h2>
                  <span className="muted">{previewSub.name}</span>
                </div>
                <button className="ghost icon-btn" onClick={() => setPreviewFor(null)} title={t('common.close.title')} aria-label={t('common.close.title')}>
                  <X />
                </button>
              </header>
              <div className="modal-body">
                <p className="muted">{t('subflows.preview.hint')}</p>
                {(previewSub.inputs ?? []).length > 0 && (
                  <div className="sf-field">
                    <span className="field-label">{t('subflows.preview.inputs')}</span>
                    {(previewSub.inputs ?? []).map((i) => (
                      <div className="sf-field" key={i.name}>
                        <label className="field-label" htmlFor={`sf-prev-${i.name}`}>
                          {i.name}{i.required ? '*' : ''}
                        </label>
                        <input
                          id={`sf-prev-${i.name}`}
                          type="text"
                          placeholder={i.description || undefined}
                          value={previewInputs[i.name] ?? ''}
                          onChange={(e) => setPreviewInputs({ ...previewInputs, [i.name]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="row-actions">
                  <button className="primary" onClick={() => void runPreview()} disabled={previewBusy}>
                    {previewBusy ? t('auth.busy') : t('subflows.preview.run')}
                  </button>
                </div>
                {previewResult && (
                  <>
                    {previewResult.issues.length > 0 && (
                      <div className="sf-issues">
                        <span className="field-label">{t('subflows.preview.issues')}</span>
                        {previewResult.issues.map((iss, i) => (
                          <div key={i} className={iss.level === 'error' ? 'err' : 'callout'}>
                            {iss.message ?? iss.code ?? ''}
                            {iss.hint ? ` — ${iss.hint}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {previewResult.log.length > 0 ? (
                      <div className="sf-preview-log">
                        {previewResult.log.map((m, i) => (
                          <div key={i} className={m.who === 'user' ? 'bubble user' : 'bubble bot'}>
                            {m.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      previewResult.ok && previewResult.issues.length === 0 && (
                        <p className="muted">{t('subflows.preview.logEmpty')}</p>
                      )
                    )}
                  </>
                )}
              </div>
              <footer className="modal-foot">
                <button className="ghost" onClick={() => setPreviewFor(null)}>
                  {t('common.close')}
                </button>
              </footer>
            </div>
          </div>
        )}
      </ExitHost>
    </div>
  );
}

export default SubflowsPage;
