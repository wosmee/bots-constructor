import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type TemplateListItem } from './api';
import { useT } from './i18n';
import { friendlyApiError } from './journey';
import { useRole, useSettings } from './settings';
import { Bot } from './icons';

interface BotBrief {
  id: string;
  name: string;
}

export function TemplatesPage({
  botId,
  botName,
  currentScenarioJson,
  onBack,
  onLoaded,
}: {
  botId?: string | null;
  botName?: string | null;
  /** Схема, открытая в конструкторе — её и публикуем кнопкой «Загрузить мой шаблон». */
  currentScenarioJson?: string | null;
  onBack: () => void;
  onLoaded?: () => void;
}) {
  const t = useT();
  const role = useRole();
  const { language: lang } = useSettings();
  const [items, setItems] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'popularity' | 'newest'>('popularity');
  const [tag, setTag] = useState('');
  const [meId, setMeId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotBrief[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', tags: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .profile()
      .then((r) => setMeId(r?.user?.id ?? null))
      .catch(() => setMeId(null));
    api
      .listBots()
      .then((r: any) => setBots((r?.bots ?? []).map((b: any) => ({ id: b.id, name: b.name }))))
      .catch(() => setBots([]));
    // Шаблоны фильтруются по своим ботам автора (клонировать может только
    // владелец): 50 последних хватает, полный список здесь не нужен.
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.listTemplates({ sort, q, tag });
      setItems(r.templates ?? []);
    } catch (e: any) {
      setErr(friendlyApiError(e, lang));
    } finally {
      setLoading(false);
    }
  }, [sort, q, tag]);

  useEffect(() => {
    // Небольшая задержка, чтобы не дёргать API на каждое нажатие в поиске.
    const id = setTimeout(load, 180);
    return () => clearTimeout(id);
  }, [load]);

  const canDelete = useCallback(
    (tpl: TemplateListItem) =>
      role === 'admin' || role === 'moderator' || (!!meId && tpl.author_user_id === meId),
    [role, meId]
  );

  const targetBotId = botId ?? (bots.length === 1 ? bots[0].id : null);

  async function useTemplate(tpl: TemplateListItem) {
    let bot = targetBotId;
    if (!bot) {
      if (!bots.length) {
        setErr(t('catalog.needBot'));
        return;
      }
      const pick = window.prompt(
        `${t('catalog.pickBot')}\n${bots.map((b, i) => `${i + 1}. ${b.name}`).join('\n')}`,
        '1'
      );
      if (!pick) return;
      const idx = Number(pick) - 1;
      if (!bots[idx]) return;
      bot = bots[idx].id;
    }
    const name = bots.find((b) => b.id === bot)?.name ?? botName ?? '';
    if (!window.confirm(t('catalog.confirmUse', { name }))) return;

    setBusy(true);
    setErr('');
    try {
      const full = await api.getTemplate(tpl.id);
      // F3-303: version — оптимистичная блокировка; без неё применение
      // шаблона обходит 409-защиту (save без version = last-write-wins).
      // Текущую версию читаем из бота ДО записи.
      let version: number | null = null;
      try {
        const cur: any = await api.getScenario(bot);
        version = cur?.version != null ? Number(cur.version) : null;
      } catch {
        version = null; // сценария нет — запись создаст первую версию
      }
      await api.saveScenario(bot, name, full.template.scenario_json, version);
      await api.useTemplate(tpl.id).catch(() => undefined); // счётчик — не критично
      onLoaded ? onLoaded() : await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(tpl: TemplateListItem) {
    if (!window.confirm(t('catalog.confirmDelete', { title: tpl.title }))) return;
    setBusy(true);
    setErr('');
    try {
      await api.deleteTemplate(tpl.id);
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    let scenarioJson = currentScenarioJson ?? null;
    if (!scenarioJson && botId) {
      try {
        const r: any = await api.getScenario(botId);
        scenarioJson = r?.flow_json ?? null;
      } catch {
        scenarioJson = null;
      }
    }
    if (!scenarioJson) {
      setErr(t('catalog.needBot'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.createTemplate({
        title: form.title.trim(),
        description: form.description.trim(),
        tags: form.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        scenario_json: scenarioJson,
      });
      setShowForm(false);
      setForm({ title: '', description: '', tags: '' });
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) for (const tg of i.tags ?? []) set.add(tg);
    return [...set].slice(0, 24);
  }, [items]);

  return (
    <div className="catalog">
      <header className="topbar catalog-topbar">
        <button className="back-control" onClick={onBack} aria-label={botId ? t('nav.toEditor') : t('nav.toBots')}>
          {t('nav.backIcon')} {botId ? t('nav.toEditor') : t('nav.toBots')}
        </button>
        <div className="brand">
          <span className="logo"><Bot size={20} /></span>
          <span>{t('catalog.title')}</span>
        </div>
        <div className="spacer" />
        <button className="primary" disabled={busy} onClick={() => setShowForm((v) => !v)}>
          {t('catalog.upload')}
        </button>
      </header>

        <main className="catalog-body">
          <h1 className="sr-only">{t('catalog.title')}</h1>
        <p className="muted">{t('catalog.subtitle')}</p>

        <div className="catalog-controls">
          <input
            className="catalog-search"
            placeholder={t('catalog.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="segmented">
            <button className={sort === 'popularity' ? 'seg active' : 'seg'} onClick={() => setSort('popularity')}>
              {t('catalog.sort.popularity')}
            </button>
            <button className={sort === 'newest' ? 'seg active' : 'seg'} onClick={() => setSort('newest')}>
              {t('catalog.sort.newest')}
            </button>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="tag-row">
            <button className={tag ? 'tag' : 'tag active'} onClick={() => setTag('')}>
              {t('catalog.all')}
            </button>
            {allTags.map((tg) => (
              <button key={tg} className={tag === tg ? 'tag active' : 'tag'} onClick={() => setTag(tg)}>
                #{tg}
              </button>
            ))}
          </div>
        )}

        {showForm && (
          <div className="create-card catalog-form">
            <h3>{t('catalog.upload')}</h3>
            <input
              placeholder={t('catalog.form.title')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <input
              placeholder={t('catalog.form.description')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <input
              placeholder={t('catalog.form.tags')}
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
            <div className="row-actions">
              <button className="primary" disabled={busy || !form.title.trim()} onClick={publish}>
                {t('catalog.form.submit')}
              </button>
              <button onClick={() => setShowForm(false)}>{t('catalog.form.cancel')}</button>
            </div>
          </div>
        )}

        {err && <div className="err">{err}</div>}

        {loading ? (
          <p className="muted">{t('catalog.loading')}</p>
        ) : items.length === 0 ? (
          <div className="empty-dash">
            <h2>{q || tag ? t('catalog.notFound') : t('catalog.empty')}</h2>
          </div>
        ) : (
          <div className="tpl-grid">
            {items.map((tpl) => (
              <div className="tpl-card" key={tpl.id}>
                  <div className="tpl-card-head">
                    <b>{tpl.title}</b>
                    <span className="tag">{tpl.uses_count} {t('catalog.uses')}</span>
                  </div>
                  {tpl.description && <div className="tpl-desc">{tpl.description}</div>}
                  <div className="muted tpl-meta">
                    {t('catalog.by')} <span className="mono">{tpl.author_user_id.slice(0, 8)}</span> ·{' '}
                    {new Date(tpl.created_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU')}
                  </div>
                  {(tpl.tags ?? []).length > 0 && (
                    <div className="tag-row">
                      {tpl.tags.map((tg) => (
                        <button key={tg} className={tag === tg ? 'tag active' : 'tag'} onClick={() => setTag(tg)}>
                          #{tg}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="row-actions">
                    <button className="primary" disabled={busy} onClick={() => useTemplate(tpl)}>
                      {t('catalog.use')}
                    </button>
                    {canDelete(tpl) && (
                      <button className="ctx-danger" disabled={busy} onClick={() => removeTemplate(tpl)}>
                        {t('catalog.delete')}
                      </button>
                    )}
                  </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
