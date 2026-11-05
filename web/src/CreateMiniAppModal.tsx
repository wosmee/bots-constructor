// Модалка создания мини-аппа: шаг 1 — подключи бота (без бота нельзя),
// шаг 2 — имя, slug, правило доступа, шаблон. Создаёт черновик и отдаёт id.
import { useEffect, useState } from 'react';
import { api } from './api';
import { friendlyApiError } from './journey';
import { useT } from './i18n';
import { useSettings } from './settings';
import { useModalA11y } from './useModalA11y';
import { X } from './icons';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

type AccessKind = 'all' | 'tag' | 'users';

export function CreateMiniAppModal({
  bots,
  onCreated,
  onClose,
  onCreateBot,
}: {
  bots: { id: string; name: string }[];
  onCreated: (id: string) => void;
  onClose: () => void;
  onCreateBot: () => void;
}) {
  const t = useT();
  const settings = useSettings();
  const modalRef = useModalA11y<HTMLDivElement>(onClose);
  const [botId, setBotId] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [access, setAccess] = useState<AccessKind>('all');
  const [tag, setTag] = useState('');
  const [users, setUsers] = useState('');
  const [template, setTemplate] = useState<'catalog' | 'admin' | 'clean'>('catalog');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bots.length === 1) setBotId(bots[0].id);
  }, [bots]);

  function accessRule(): any | string {
    if (access === 'all') return { kind: 'all' };
    if (access === 'tag') {
      if (!tag.trim()) return 'mini.err.tag';
      return { kind: 'tag', tag: tag.trim() };
    }
    const ids = users
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((x) => Number(x));
    if (!ids.length || ids.some((n) => !Number.isInteger(n) || n <= 0)) return 'mini.err.users';
    return { kind: 'users', ids };
  }

  async function submit() {
    setErr('');
    if (!botId) return setErr(t('mini.err.bot'));
    if (!name.trim()) return setErr(t('mini.err.name'));
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) return setErr(t('mini.err.slug'));
    const rule = accessRule();
    if (typeof rule === 'string') return setErr(t(rule as any));
    setBusy(true);
    try {
      const res = await api.createMiniApp(botId, name.trim(), s, rule, template);
      onCreated(res.id);
    } catch (e: any) {
      // «slug» — машинное слово из ошибки воркера, оно не переводится и остаётся
      // признаком занятого адреса; остальное — через friendlyApiError (S3-03).
      setErr(String(e?.message || '').includes('slug') ? t('mini.err.taken') : friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-label={t('mini.create.title')} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('mini.create.title')}</h2>
          </div>
          <button className="ghost icon-btn" onClick={onClose} aria-label={t('common.close.title')} title={t('common.close.title')}>
            <X />
          </button>
        </header>
        <div className="modal-body">
          <section className="modal-section">
            <p className="muted">{t('mini.create.hint')}</p>
            <h3>{t('mini.step.bot')}</h3>
            <p className="muted">{t('mini.step.bot.hint')}</p>
            {bots.length === 0 ? (
              <p className="muted">{t('mini.bot.empty')}</p>
            ) : (
              <select value={botId} onChange={(e) => setBotId(e.target.value)}>
                <option value="">{t('mini.bot.pick')}</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <div className="row-actions">
              <button onClick={onCreateBot}>{t('mini.bot.create')}</button>
            </div>

            <h3>{t('mini.step.params')}</h3>
            <label>
              {t('mini.name')}
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mini.name.placeholder')} />
            </label>
            <label>
              {t('mini.slug')}
              <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="shop" />
            </label>
            <p className="muted">{t('mini.slug.hint')}</p>
            <label>
              {t('mini.access')}
              <select value={access} onChange={(e) => setAccess(e.target.value as AccessKind)}>
                <option value="all">{t('mini.access.all')}</option>
                <option value="tag">{t('mini.access.tag')}</option>
                <option value="users">{t('mini.access.users')}</option>
              </select>
            </label>
            {access === 'tag' && <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t('mini.access.tag.placeholder')} />}
            {access === 'users' && <input value={users} onChange={(e) => setUsers(e.target.value)} placeholder={t('mini.access.users.placeholder')} />}
            <label>
              {t('mini.template')}
              <select value={template} onChange={(e) => setTemplate(e.target.value as 'catalog' | 'admin' | 'clean')}>
                <option value="catalog">{t('mini.template.catalog')}</option>
                <option value="admin">{t('mini.template.admin')}</option>
                <option value="clean">{t('mini.template.clean')}</option>
              </select>
            </label>
            <p className="muted">
              {template === 'catalog' ? t('mini.template.catalog.hint') : template === 'admin' ? t('mini.template.admin.hint') : t('mini.template.clean.hint')}
            </p>

            {err && <div className="err">{err}</div>}
            <div className="row-actions">
              <button className="primary" disabled={busy || !botId} onClick={() => void submit()}>
                {busy ? t('mini.busy') : t('mini.submit')}
              </button>
              <button onClick={onClose}>{t('dash.cancel')}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
