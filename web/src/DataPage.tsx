// Страница данных бота: клиенты (кто писал боту и что сценарий запомнил) и
// таблицы автора (заказы, заявки, записи). Это и есть «база данных бота» —
// внешние сервисы подключать не нужно: пишет блок «Данные», смотрим здесь.
import { useCallback, useEffect, useState } from 'react';
import { api, downloadCsv, type ClientRow, type Collection, type CollectionItem } from './api';
import { useT } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { useModalA11y } from './useModalA11y';
import { Bot, X } from './icons';

function fmtTs(ts: number, locale: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(ts);
  }
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function DataPage({ botId, name, backTo, onBack }: { botId: string; name: string; backTo: 'list' | 'editor'; onBack: () => void }) {
  const t = useT();
  const settings = useSettings();
  const locale = settings.language === 'en' ? 'en-GB' : 'ru-RU';

  const [tab, setTab] = useState<'clients' | 'collections'>('clients');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  // ---- клиенты ----
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [editVars, setEditVars] = useState<{ k: string; v: string }[]>([]);

  // ---- таблицы ----
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeColl, setActiveColl] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [newName, setNewName] = useState('');
  const [newFields, setNewFields] = useState('');
  const [draft, setDraft] = useState<{ id: string | null; data: Record<string, string> } | null>(null);

  // Esc + фокус-треп инлайн-модалок (WU-05/UX-02).
  const editModalRef = useModalA11y<HTMLDivElement>(() => setEditing(null));
  const draftModalRef = useModalA11y<HTMLDivElement>(() => setDraft(null));

  // Поиск не дёргает сервер на каждую клавишу.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.clients(botId, { q: search, limit: 100 });
      setClients(r.rows ?? []);
      setTotal(r.total ?? 0);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setLoading(false);
    }
  }, [botId, search]);

  const loadCollections = useCallback(async () => {
    setErr('');
    try {
      const r = await api.collections(botId);
      setCollections(r.collections ?? []);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }, [botId]);

  const loadItems = useCallback(async () => {
    if (!activeColl) return;
    setLoading(true);
    setErr('');
    try {
      const r = await api.collectionItems(botId, activeColl, { q: search, limit: 100 });
      setItems(r.rows ?? []);
      setFields(r.fields ?? []);
      setItemsTotal(r.total ?? 0);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setLoading(false);
    }
  }, [botId, activeColl, search]);

  useEffect(() => {
    if (tab === 'clients') void loadClients();
    else {
      void loadCollections();
      if (activeColl) void loadItems();
    }
  }, [tab, loadClients, loadCollections, activeColl, loadItems]);

  // ---------------- клиенты ----------------

  function openEdit(c: ClientRow) {
    setEditing(c);
    setEditVars(Object.entries(c.vars ?? {}).map(([k, v]) => ({ k, v: stringify(v) })));
  }

  async function saveClient() {
    if (!editing) return;
    const vars: Record<string, unknown> = {};
    for (const { k, v } of editVars) if (k.trim()) vars[k.trim()] = v;
    try {
      await api.updateClient(botId, editing.user_id, vars);
      setNote(t('data.saved'));
      setEditing(null);
      await loadClients();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  async function removeClient(c: ClientRow) {
    if (!confirm(t('data.client.delete.confirm', { id: c.user_id }))) return;
    try {
      await api.deleteClient(botId, c.user_id);
      setNote(t('data.deleted'));
      await loadClients();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  // ---------------- таблицы ----------------

  async function createCollection() {
    const nameVal = newName.trim();
    const fieldsVal = newFields
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!nameVal || !fieldsVal.length) return;
    try {
      const r = await api.createCollection(botId, nameVal, fieldsVal);
      setNewName('');
      setNewFields('');
      setActiveColl(r.collection.id);
      await loadCollections();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  async function removeCollection(c: Collection) {
    if (!confirm(t('data.collection.delete.confirm', { name: c.name }))) return;
    try {
      await api.deleteCollection(botId, c.id);
      if (activeColl === c.id) setActiveColl(null);
      setNote(t('data.deleted'));
      await loadCollections();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  async function saveItem() {
    if (!activeColl || !draft) return;
    try {
      if (draft.id) await api.updateItem(botId, activeColl, draft.id, draft.data);
      else await api.createItem(botId, activeColl, draft.data);
      setDraft(null);
      await Promise.all([loadItems(), loadCollections()]);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  async function removeItem(item: CollectionItem) {
    if (!activeColl) return;
    if (!confirm(t('data.item.delete'))) return;
    try {
      await api.deleteItem(botId, activeColl, item.id);
      await Promise.all([loadItems(), loadCollections()]);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  const active = collections.find((c) => c.id === activeColl) ?? null;

  return (
    <div className="app">
      <header className="topbar data-topbar">
        <button className="back-control" onClick={onBack} aria-label={backTo === 'editor' ? t('nav.toEditor') : t('nav.toBots')}>
          {t('nav.backIcon')} {backTo === 'editor' ? t('nav.toEditor') : t('nav.toBots')}
        </button>
        <div className="brand data-brand">
          <span className="logo"><Bot /></span>
          <span>{t('app.brand')}</span>
        </div>
        <span className="who">{name}</span>
        <div className="spacer" />
        <div className="topbar-group" aria-hidden="true" />
      </header>

      <main className="data-page">
        <h1 className="sr-only">{t('data.title')}</h1>
        <div className="data-head">
          <h1>{t('data.title')}</h1>
        </div>
        <div className="muted">{t('data.hint')}</div>

        <div className="data-tabs">
          <button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')}>
            {t('data.tab.clients')}
          </button>
          <button className={tab === 'collections' ? 'active' : ''} onClick={() => setTab('collections')}>
            {t('data.tab.collections')}
          </button>
        </div>

        {err && <div className="err">{err}</div>}
        {note && <div className="muted">{note}</div>}

        <div className="data-toolbar">
          <input
            placeholder={tab === 'clients' ? t('data.clients.search') : t('data.items.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="muted">
            {tab === 'clients' ? t('data.clients.total', { n: total }) : t('data.collection.records', { n: itemsTotal })}
          </span>
          <button
            onClick={() => {
              if (tab === 'clients') {
                void downloadCsv(
                  `/api/bots/${botId}/clients.csv${search ? `?q=${encodeURIComponent(search)}` : ''}`,
                  `clients-${botId.slice(0, 8)}.csv`
                ).catch((e) => setErr(friendlyApiError(e, settings.language)));
              } else if (activeColl) {
                void downloadCsv(
                  `/api/bots/${botId}/collections/${activeColl}/items.csv${
                    search ? `?q=${encodeURIComponent(search)}` : ''
                  }`,
                  `${(active?.name ?? 'table').replace(/[^\wа-яёА-ЯЁ-]+/g, '_')}.csv`
                ).catch((e) => setErr(friendlyApiError(e, settings.language)));
              }
            }}
          >
            {t('data.export')}
          </button>
          <button
            onClick={() => {
              if (tab === 'clients') void loadClients();
              else void (activeColl ? loadItems() : loadCollections());
            }}
          >
            {t('data.refresh')}
          </button>
        </div>

        {loading && (
          <div className="data-empty">
            <p className="muted">{t('data.loading')}</p>
          </div>
        )}

        {!loading && tab === 'clients' && (
          <>
            {clients.length === 0 ? (
              <div className="data-empty">
                <p className="muted">{t('data.clients.empty')}</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="num">{t('data.client.id')}</th>
                      <th>{t('data.client.name')}</th>
                      <th>{t('data.client.username')}</th>
                      <th className="num">{t('data.client.firstSeen')}</th>
                      <th className="num">{t('data.client.lastSeen')}</th>
                      <th>{t('data.client.vars')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => (
                      <tr key={c.user_id}>
                        <td className="mono num">{c.user_id}</td>
                        <td>{c.name || '—'}</td>
                        <td>{c.username ? `@${c.username}` : '—'}</td>
                        <td className="num">{fmtTs(c.first_seen, locale)}</td>
                        <td className="num">{fmtTs(c.last_seen, locale)}</td>
                        <td>
                          {Object.keys(c.vars ?? {}).length ? (
                            <div className="data-vars">
                              {Object.entries(c.vars ?? {}).slice(0, 6).map(([k, v]) => (
                                <span key={k} className="data-var" title={stringify(v)}>
                                  {k}: {stringify(v).slice(0, 24)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="muted">{t('data.client.vars.empty')}</span>
                          )}
                        </td>
                        <td>
                          <div className="data-actions">
                            <button onClick={() => openEdit(c)}>{t('data.client.edit')}</button>
                            <button className="danger" onClick={() => void removeClient(c)}>
                              {t('data.client.delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {!loading && tab === 'collections' && (
          <>
            <div className="data-card">
              <h3>{t('data.collection.new')}</h3>
              <div className="data-toolbar">
                <input
                  placeholder={t('data.collection.name.placeholder')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  placeholder={t('data.collection.fields')}
                  value={newFields}
                  onChange={(e) => setNewFields(e.target.value)}
                />
                <button className="primary" disabled={!newName.trim() || !newFields.trim()} onClick={() => void createCollection()}>
                  {t('data.collection.create')}
                </button>
              </div>
              <div className="muted">{t('data.collection.fields.hint')}</div>
            </div>

            {collections.length === 0 ? (
              <div className="data-empty">
                <p className="muted">{t('data.collections.empty')}</p>
              </div>
            ) : (
              <div className="data-grid">
                {collections.map((c) => (
                  <div
                    key={c.id}
                    className={`data-coll${activeColl === c.id ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveColl(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveColl(c.id);
                      }
                    }}
                  >
                    <div className="data-coll-name">{c.name}</div>
                    <div className="muted">{t('data.collection.records', { n: c.count })}</div>
                    <div className="data-fields">
                      {(c.fields ?? []).map((f) => (
                        <span key={f} className="data-var">
                          {f}
                        </span>
                      ))}
                    </div>
                    <div className="data-actions" style={{ marginTop: 8 }}>
                      <button
                        className="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeCollection(c);
                        }}
                      >
                        {t('data.collection.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {active && (
              <div className="data-card">
                <h3>
                  {active.name}
                  <span className="muted">{t('data.collection.records', { n: itemsTotal })}</span>
                </h3>
                <div className="data-toolbar">
                  <button
                    className="primary"
                    onClick={() => setDraft({ id: null, data: Object.fromEntries(fields.map((f) => [f, ''])) })}
                  >
                    {t('data.item.new')}
                  </button>
                </div>
                {items.length === 0 ? (
                  <div className="data-empty">
                    <p className="muted">{t('data.items.empty')}</p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="num">{t('data.item.date')}</th>
                          <th className="num">{t('data.item.fromUser')}</th>
                          {fields.map((f) => (
                            <th key={f}>{f}</th>
                          ))}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.id}>
                            <td className="num">{fmtTs(it.created_at, locale)}</td>
                            <td className="mono num">{it.user_id ?? '—'}</td>
                            {fields.map((f) => (
                              <td key={f}>{it.data?.[f] ?? ''}</td>
                            ))}
                            <td>
                              <div className="data-actions">
                                <button onClick={() => setDraft({ id: it.id, data: { ...it.data } })}>
                                  {t('data.client.edit')}
                                </button>
                                <button className="danger" onClick={() => void removeItem(it)}>
                                  {t('data.item.delete')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div ref={editModalRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('data.client.edit.title', { id: editing.user_id })}</h2>
              <button className="ghost icon-btn" onClick={() => setEditing(null)}>
                <X />
              </button>
            </header>
            <div className="modal-body">
              {editVars.map((pair, i) => (
                <div key={i} className="row">
                  <input
                    placeholder={t('data.var.name')}
                    value={pair.k}
                    onChange={(e) => {
                      const nb = [...editVars];
                      nb[i] = { ...nb[i], k: e.target.value };
                      setEditVars(nb);
                    }}
                  />
                  <input
                    placeholder={t('data.var.value')}
                    value={pair.v}
                    onChange={(e) => {
                      const nb = [...editVars];
                      nb[i] = { ...nb[i], v: e.target.value };
                      setEditVars(nb);
                    }}
                  />
                  <button className="ghost icon-btn" onClick={() => setEditVars(editVars.filter((_, idx) => idx !== i))}>
                    <X />
                  </button>
                </div>
              ))}
              <button onClick={() => setEditVars([...editVars, { k: '', v: '' }])}>{t('data.var.add')}</button>
              <div className="row-actions">
                <button className="primary" onClick={() => void saveClient()}>
                  {t('data.save')}
                </button>
                <button onClick={() => setEditing(null)}>{t('data.cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <div ref={draftModalRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{draft.id ? t('data.item.edit') : t('data.item.new')}</h2>
              <button className="ghost icon-btn" onClick={() => setDraft(null)}>
                <X />
              </button>
            </header>
            <div className="modal-body">
              {fields.map((f) => (
                <label key={f}>
                  {f}
                  <input
                    value={draft.data[f] ?? ''}
                    onChange={(e) => setDraft({ ...draft, data: { ...draft.data, [f]: e.target.value } })}
                  />
                </label>
              ))}
              <div className="row-actions">
                <button className="primary" onClick={() => void saveItem()}>
                  {draft.id ? t('data.save') : t('data.item.add')}
                </button>
                <button onClick={() => setDraft(null)}>{t('data.cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataPage;
