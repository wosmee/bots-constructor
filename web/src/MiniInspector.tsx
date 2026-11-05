// Инспектор редактора мини-аппов (правая панель): страница, свойства выбранного
// элемента, его вид, действие и условие видимости. Контракт пропсов фиксирован
// (MiniAppEditor зовёт компонент именно так). Все правки схемы — через чистые
// иммутабельные хелперы из miniInspLogic.ts, они же покрыты тестами.
// Визуальный язык — классы инспектора ботов (.insp-section/.insp-field/.insp-list-row).
import { useEffect, useRef, useState, type ChangeEvent, type JSX, type ReactNode } from 'react';
import type { ConditionOp } from '../../shared/types';
import type { MiniAction, MiniApp, MiniElement, MiniElementStyle, MiniPage, MiniValueRef } from '../../shared/miniapp';
import { MINI_CSS_MAX, sanitizeCss, sanitizeRichText } from '../../shared/mini-sanitize';
import { api, getAdminKey, getSessionToken, type Collection } from './api';
import { createApiError, friendlyApiError } from './journey';
import { useT, type TKey } from './i18n';
import { MINI_ELEMENT_META } from './miniMeta';
import {
  applyElChange,
  applyElProps,
  applyPageChange,
  duplicateEl,
  moveZ,
  nextFieldId,
  removeEl,
} from './miniInspLogic';
import './insp.css';

// Чистые хелперы схемы доступны и отсюда: тесты и ядро редактора могут
// импортировать их из одного места (сами функции живут в miniInspLogic.ts —
// там нет React, их можно гонять в node-окружении vitest без DOM).
export {
  applyElChange,
  applyElProps,
  applyPageChange,
  duplicateEl,
  moveZ,
  nextFieldId,
  removeEl,
  genElId,
} from './miniInspLogic';

// Градиенты заглушек — те же варианты, что в макете редактора (mockup1).
const GRADS: Array<{ v: string; label: TKey }> = [
  { v: '', label: 'miniInsp.st.grad.default' },
  { v: 'linear-gradient(135deg,#ffd6e0,#ffc2d1)', label: 'miniInsp.st.grad.pink' },
  { v: 'linear-gradient(135deg,#d6f5dd,#c2f0d0)', label: 'miniInsp.st.grad.green' },
  { v: 'linear-gradient(135deg,#dbe2ef,#c3cfe2)', label: 'miniInsp.st.grad.blue' },
];

// Полный набор операторов условия (shared/types.ts ConditionOp, 14 штук).
// Подписи — из базового словаря i18n (f.op.*), как в инспекторе ботов.
const OP_KEYS: Record<ConditionOp, TKey> = {
  '==': 'f.op.eq',
  '!=': 'f.op.neq',
  '>': 'f.op.gt',
  '<': 'f.op.lt',
  contains: 'f.op.contains',
  in: 'f.op.in',
  not_in: 'f.op.notIn',
  starts_with: 'f.op.startsWith',
  ends_with: 'f.op.endsWith',
  empty: 'f.op.empty',
  not_empty: 'f.op.notEmpty',
  regex: 'f.op.regex',
  '>=': 'f.op.gte',
  '<=': 'f.op.lte',
};
const ALL_OPS = Object.keys(OP_KEYS) as ConditionOp[];

// Действия элемента: набор селекта (все MiniAction), подписи — i18n-ключи.
// 'pay' добавлен вместе с серверной реализацией (F-041): рантайм отправляет
// счёт в Telegram Stars, валидацию product/stars делает воркер.
const ACTION_IDS = ['none', 'goto', 'link', 'data', 'scenario', 'close', 'toggle', 'ai', 'favorite', 'pay'] as const satisfies readonly MiniAction['id'][];
const ACTION_LABELS: Record<(typeof ACTION_IDS)[number], TKey> = {
  none: 'miniInsp.act.none',
  goto: 'miniInsp.act.goto',
  link: 'miniInsp.act.link',
  data: 'miniInsp.act.data',
  scenario: 'miniInsp.act.scenario',
  close: 'miniInsp.act.close',
  toggle: 'miniInsp.act.toggle',
  ai: 'miniInsp.act.ai',
  favorite: 'miniInsp.act.favorite',
  pay: 'miniInsp.act.pay',
};

const str = (v: unknown): string => (v == null ? '' : String(v));

// <input type="color"> принимает только #rrggbb: мусор и короткие формы
// показываем дефолтом, но в схему пишем ровно то, что выбрал пользователь.
const hex = (v: unknown, fallback: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(str(v)) ? str(v) : fallback;

// Поле с подписью (паттерн .insp-field инспектора ботов).
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

// Секция-аккордеон: нативный details/summary, классы .insp-section.
function Sec({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="insp-section" open={open}>
      <summary className="insp-section-title">{title}</summary>
      {children}
    </details>
  );
}

// Селект data-таблицы. В схеме лежит ИМЯ коллекции: рантайм резолвит таблицу
// по name (worker: cols.find(x => x.name === body.table)), не по id.
// Незнакомое текущее значение показываем отдельной опцией — не теряем его.
function TableSelect({ items, value, onPick }: { items: Collection[]; value: string; onPick: (v: string) => void }) {
  const known = items.some((c) => c.name === value);
  return (
    <select value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">—</option>
      {!known && value && <option value={value}>{value}</option>}
      {items.map((c) => (
        <option key={c.id} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// Селект одной колонки таблицы.
function ColumnSelect({ fields, value, onPick }: { fields: string[]; value: string; onPick: (v: string) => void }) {
  const known = fields.includes(value);
  return (
    <select value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">—</option>
      {!known && value && <option value={value}>{value}</option>}
      {fields.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
}

// Мультивыбор колонок чекбоксами (table.columns, search.columns, editColumns).
function ColumnsCheck({ fields, value, onPick }: { fields: string[]; value: string[]; onPick: (v: string[]) => void }) {
  const all = [...new Set([...value, ...fields])];
  return (
    <div>
      {all.map((f) => (
        <label key={f} className="checkline">
          <input
            type="checkbox"
            checked={value.includes(f)}
            onChange={(e) => onPick(e.target.checked ? [...value, f] : value.filter((x) => x !== f))}
          />
          {f}
        </label>
      ))}
      {!all.length && <p className="muted">—</p>}
    </div>
  );
}

export function MiniInspector(props: {
  app: MiniApp;
  pageIdx: number;
  selId: string | null;
  botId: string;
  onChange: (next: MiniApp) => void;
  onPreview: () => void;
  onPublish: (menuButton: boolean) => void;
}): JSX.Element {
  const { app, pageIdx, selId, botId, onChange, onPreview, onPublish } = props;
  const t = useT();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [menuButton, setMenuButton] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  // data-таблицы бота: селекты таблиц и колонок в props и в действии «data».
  useEffect(() => {
    let alive = true;
    setCollections([]);
    api
      .collections(botId)
      .then((r) => {
        if (alive) setCollections(r.collections ?? []);
      })
      .catch(() => {
        /* без таблиц селекты остаются пустыми — не ошибка инспектора */
      });
    return () => {
      alive = false;
    };
  }, [botId]);

  const page = app.pages[pageIdx];
  const el = selId != null ? page?.els.find((e) => e.id === selId) ?? null : null;

  const patchPage = (patch: Partial<MiniPage>) => onChange(applyPageChange(app, pageIdx, patch));
  const patchEl = (patch: Partial<MiniElement>) => {
    if (el) onChange(applyElChange(app, pageIdx, el.id, patch));
  };
  const patchProps = (patch: Record<string, unknown>) => {
    if (el) onChange(applyElProps(app, pageIdx, el.id, patch));
  };
  const patchStyle = (patch: Partial<MiniElementStyle>) => {
    if (el) patchEl({ style: { ...el.style, ...patch } });
  };
  const fieldsOf = (tableName: string): string[] => collections.find((c) => c.name === tableName)?.fields ?? [];

  // Загрузка картинки в Filebase: POST /api/bots/:id/media, multipart, поле file.
  // Авторизация — как в api.ts req(): x-admin-key и/или Bearer из sessionStorage.
  async function uploadFile(file: File) {
    setUploading(true);
    setUploadErr('');
    try {
      const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
      const headers: Record<string, string> = {};
      const key = getAdminKey();
      if (key) headers['x-admin-key'] = key;
      const token = getSessionToken();
      if (token) headers['authorization'] = `Bearer ${token}`;
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${base}/api/bots/${botId}/media`, { method: 'POST', headers, body: fd });
      const body: any = await res.json().catch(() => null);
      // HTTP-ошибка — ApiError со статусом (friendlyApiError переведёт её по
      // языку); «200 без url» — обычная Error с текстом воркера (квота и т.п.),
      // фильтр чувствительного friendlyApiError применится к ней и так.
      if (!res.ok) throw createApiError(res.status, body?.error ?? `HTTP ${res.status}`);
      if (!body?.url) throw new Error(str(body?.error) || `HTTP ${res.status}`);
      patchProps({ src: { type: 'filebase', url: String(body.url) } });
    } catch (e: any) {
      setUploadErr(friendlyApiError(e, document.documentElement.lang === 'en' ? 'en' : 'ru'));
    } finally {
      setUploading(false);
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void uploadFile(f);
  };

  // Начальное действие при смене типа: зависимые поля пустые, таблица data —
  // из props.table элемента, если она там уже выбрана.
  function newAction(id: MiniAction['id']): MiniAction {
    switch (id) {
      case 'goto':
        return { id: 'goto', pageId: page?.id ?? app.pages[0]?.id ?? '' };
      case 'link':
        return { id: 'link', url: '' };
      case 'data':
        return { id: 'data', table: str((el?.props as Record<string, unknown> | undefined)?.table), values: [] };
      case 'scenario':
        return { id: 'scenario', target: '' };
      case 'toggle':
        return { id: 'toggle', elementId: '' };
      case 'ai':
        return { id: 'ai', prompt: '' };
      case 'favorite':
        return { id: 'favorite', itemId: '' };
      case 'pay':
        return { id: 'pay', product: '', stars: 1 };
      case 'close':
        return { id: 'close' };
      default:
        return { id: 'none' };
    }
  }

  // ------------------------------------------------------------- содержание

  function imageSource(p: Record<string, any>) {
    const srcType = p.src?.type === 'tg' ? 'tg' : p.src?.type === 'url' ? 'url' : 'filebase';
    return (
      <>
        <Row label={t('miniInsp.imgSource')}>
          <select
            value={srcType}
            onChange={(e) => {
              const k = e.target.value;
              patchProps({
                src:
                  k === 'tg'
                    ? { type: 'tg', fileId: '' }
                    : k === 'url'
                      ? { type: 'url', url: '' }
                      : { type: 'filebase', url: '' },
              });
            }}
          >
            <option value="filebase">Filebase</option>
            <option value="tg">Telegram (file_id)</option>
            <option value="url">{t('f.url')}</option>
          </select>
        </Row>
        {srcType === 'filebase' && (
          <Row label={t('miniInsp.file')}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? t('miniInsp.uploading') : t('miniInsp.upload')}
            </button>
            {p.src?.url ? <div className="muted">{str(p.src.url)}</div> : null}
            {uploadErr && <div className="err">{uploadErr}</div>}
          </Row>
        )}
        {srcType === 'tg' && (
          <Row label="file_id">
            <input value={str(p.src?.fileId)} onChange={(e) => patchProps({ src: { type: 'tg', fileId: e.target.value } })} />
          </Row>
        )}
        {srcType === 'url' && (
          <Row label={t('f.url')}>
            <input
              value={str(p.src?.url)}
              placeholder="https://…"
              onChange={(e) => patchProps({ src: { type: 'url', url: e.target.value } })}
            />
          </Row>
        )}
        <Row label={t('miniInsp.emojiFallback')}>
          <input value={str(p.emoji)} onChange={(e) => patchProps({ emoji: e.target.value })} />
        </Row>
      </>
    );
  }

  // Список полей формы/поддержки: id + подпись, add/remove. Значения полей
  // рантайм собирает по id (inputStore), mapping и действие data ссылаются на них же.
  function formFields(p: Record<string, any>) {
    const fields: any[] = Array.isArray(p.fields) ? p.fields : [];
    const setFields = (next: unknown[]) => patchProps({ fields: next });
    const mapping: any[] = Array.isArray(p.mapping) ? p.mapping : [];
    return (
      <>
        {fields.map((f, i) => (
          <div className="insp-list-row" key={i}>
            <input
              aria-label={t('miniInsp.fieldId')}
              value={str(f?.id)}
              onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
            />
            <input
              aria-label={t('miniInsp.fieldLabel')}
              value={str(f?.label)}
              onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <button
              type="button"
              className="ghost"
              aria-label={t('data.item.delete')}
              onClick={() => setFields(fields.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setFields([...fields, { id: nextFieldId(fields), label: '' }])}>
          {t('f.data.addField')}
        </button>
        <Row label={t('miniInsp.submitText')}>
          <input value={typeof p.submit === 'string' ? p.submit : ''} onChange={(e) => patchProps({ submit: e.target.value })} />
        </Row>
        {el?.type === 'form' && (
          <>
            <div className="insp-section-title">{t('miniInsp.mappingTitle')}</div>
            {mapping.map((m, i) => (
              <div className="insp-list-row" key={i}>
                <input
                  aria-label={t('miniInsp.data.column')}
                  value={str(m?.column)}
                  onChange={(e) =>
                    patchProps({ mapping: mapping.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })
                  }
                />
                <select
                  aria-label={t('miniInsp.formField')}
                  value={str(m?.fieldId)}
                  onChange={(e) =>
                    patchProps({ mapping: mapping.map((x, j) => (j === i ? { ...x, fieldId: e.target.value } : x)) })
                  }
                >
                  <option value="">—</option>
                  {fields.map((f) => (
                    <option key={str(f?.id)} value={str(f?.id)}>
                      {str(f?.label) || str(f?.id)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost"
                  aria-label={t('data.item.delete')}
                  onClick={() => patchProps({ mapping: mapping.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() => patchProps({ mapping: [...mapping, { column: '', fieldId: str(fields[0]?.id ?? '') }] })}
            >
              {t('miniInsp.addMapping')}
            </button>
          </>
        )}
      </>
    );
  }

  function contentSection() {
    if (!el) return null;
    const p = (el.props ?? {}) as Record<string, any>;
    const table = str(p.table);
    const cols = fieldsOf(table);
    switch (el.type) {
      case 'text':
      case 'heading':
      case 'button':
      case 'refresh':
        return (
          <Row label={t('f.message.text')}>
            <input value={str(p.text)} onChange={(e) => patchProps({ text: e.target.value })} />
          </Row>
        );
      case 'product':
        return (
          <>
            <Row label={t('catalog.form.title')}>
              <input value={str(p.title)} onChange={(e) => patchProps({ title: e.target.value })} />
            </Row>
            <Row label={t('miniInsp.price')}>
              <input value={str(p.price)} onChange={(e) => patchProps({ price: e.target.value })} />
            </Row>
            <Row label={t('miniInsp.submitText')}>
              <input value={typeof p.button === 'string' ? p.button : ''} onChange={(e) => patchProps({ button: e.target.value })} />
            </Row>
          </>
        );
      case 'input':
        return (
          <>
            <Row label={t('f.prompt')}>
              <input value={str(p.ph)} onChange={(e) => patchProps({ ph: e.target.value })} />
            </Row>
            <label className="checkline">
              <input type="checkbox" checked={!!p.multiline} onChange={(e) => patchProps({ multiline: e.target.checked })} />
              {t('miniInsp.multiline')}
            </label>
          </>
        );
      case 'image':
        return imageSource(p);
      case 'form':
      case 'support':
        return formFields(p);
      case 'grid':
        return (
          <>
            <Row label={t('miniInsp.data.table')}>
              <TableSelect items={collections} value={table} onPick={(v) => patchProps({ table: v })} />
            </Row>
            <Row label={t('miniInsp.col.title')}>
              <ColumnSelect fields={cols} value={str(p.titleColumn)} onPick={(v) => patchProps({ titleColumn: v })} />
            </Row>
            <Row label={t('miniInsp.col.image')}>
              <ColumnSelect fields={cols} value={str(p.imageColumn)} onPick={(v) => patchProps({ imageColumn: v })} />
            </Row>
            <Row label={t('miniInsp.col.price')}>
              <ColumnSelect fields={cols} value={str(p.priceColumn)} onPick={(v) => patchProps({ priceColumn: v })} />
            </Row>
            <Row label={t('miniInsp.productPage')}>
              <select value={str(p.detailPageId)} onChange={(e) => patchProps({ detailPageId: e.target.value })}>
                <option value="">—</option>
                {app.pages.map((pg) => (
                  <option key={pg.id} value={pg.id}>
                    {pg.name}
                  </option>
                ))}
              </select>
            </Row>
          </>
        );
      case 'table':
      case 'search':
        return (
          <>
            <Row label={t('miniInsp.data.table')}>
              <TableSelect items={collections} value={table} onPick={(v) => patchProps({ table: v })} />
            </Row>
            <Row label={t('miniInsp.data.columns')}>
              <ColumnsCheck
                fields={cols}
                value={Array.isArray(p.columns) ? p.columns.map(String) : []}
                onPick={(v) => patchProps({ columns: v })}
              />
            </Row>
          </>
        );
      case 'chips':
      case 'sort':
        return (
          <>
            <Row label={t('miniInsp.data.table')}>
              <TableSelect items={collections} value={table} onPick={(v) => patchProps({ table: v })} />
            </Row>
            <Row label={t('miniInsp.data.column')}>
              <ColumnSelect fields={cols} value={str(p.column)} onPick={(v) => patchProps({ column: v })} />
            </Row>
          </>
        );
      case 'stat':
        return (
          <>
            <Row label={t('miniInsp.data.table')}>
              <TableSelect items={collections} value={table} onPick={(v) => patchProps({ table: v })} />
            </Row>
            <Row label={t('miniInsp.statMode')}>
              <select value={p.mode === 'sum' ? 'sum' : 'count'} onChange={(e) => patchProps({ mode: e.target.value })}>
                <option value="count">{t('miniInsp.statMode.count')}</option>
                <option value="sum">{t('miniInsp.statMode.sum')}</option>
              </select>
            </Row>
            {p.mode === 'sum' && (
              <Row label={t('miniInsp.data.column')}>
                <ColumnSelect fields={cols} value={str(p.column)} onPick={(v) => patchProps({ column: v })} />
              </Row>
            )}
            <Row label={t('miniInsp.caption')}>
              <input value={str(p.label)} onChange={(e) => patchProps({ label: e.target.value })} />
            </Row>
          </>
        );
      case 'record_form':
        return (
          <>
            <Row label={t('miniInsp.data.table')}>
              <TableSelect items={collections} value={table} onPick={(v) => patchProps({ table: v })} />
            </Row>
            <Row label={t('miniInsp.col.search')}>
              <ColumnSelect fields={cols} value={str(p.searchColumn)} onPick={(v) => patchProps({ searchColumn: v })} />
            </Row>
            <Row label={t('miniInsp.col.edit')}>
              <ColumnsCheck
                fields={cols}
                value={Array.isArray(p.editColumns) ? p.editColumns.map(String) : []}
                onPick={(v) => patchProps({ editColumns: v })}
              />
            </Row>
            <Row label={t('f.prompt')}>
              <input value={str(p.ph)} onChange={(e) => patchProps({ ph: e.target.value })} />
            </Row>
          </>
        );
      case 'ai_gen':
        return (
          <Row label={t('f.prompt')}>
            <input value={str(p.placeholder)} onChange={(e) => patchProps({ placeholder: e.target.value })} />
          </Row>
        );
      case 'richtext':
        // Значение в схему пишется уже санитизированным: textarea показывает
        // результат sanitizeRichText, запрещённые теги исчезают на лету.
        return (
          <Row label={t('miniInsp.richtext')}>
            <textarea
              value={str(p.html)}
              placeholder="<b>жирный</b>, <i>курсив</i>, <a href=https://…>ссылка</a>"
              onChange={(e) => patchProps({ html: sanitizeRichText(e.target.value) })}
            />
            <div className="muted">{t('miniInsp.richtext.hint')}</div>
          </Row>
        );
      case 'carousel': {
        const items: any[] = Array.isArray(p.items) ? p.items : [];
        const setItems = (next: unknown[]) => patchProps({ items: next });
        return (
          <>
            {items.map((it, i) => (
              <div className="insp-list-row" key={i}>
                <input
                  aria-label={t('miniInsp.carousel.url')}
                  value={str(it?.url)}
                  placeholder="https://…"
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <input
                  aria-label={t('miniInsp.carousel.caption')}
                  value={str(it?.caption)}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
                />
                <button
                  type="button"
                  className="ghost"
                  aria-label={t('data.item.delete')}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setItems([...items, { url: '', caption: '' }])}>
              {t('miniInsp.carousel.add')}
            </button>
          </>
        );
      }
      case 'video':
        return (
          <Row label={t('f.url')}>
            <input value={str(p.url)} placeholder="https://youtu.be/…" onChange={(e) => patchProps({ url: e.target.value })} />
          </Row>
        );
      default:
        // card/divider/spacer/user_list/user_info: содержания нет, только вид.
        return <p className="muted">{t(MINI_ELEMENT_META[el.type].hint as TKey)}</p>;
    }
  }

  // ------------------------------------------------------------- действие

  function actionSection() {
    if (!el) return null;
    const act: MiniAction = el.action ?? { id: 'none' };
    return (
      <>
        <Row label={t('miniInsp.action')}>
          <select value={act.id} onChange={(e) => patchEl({ action: newAction(e.target.value as MiniAction['id']) })}>
            {ACTION_IDS.map((id) => (
              <option key={id} value={id}>
                {t(ACTION_LABELS[id])}
              </option>
            ))}
          </select>
        </Row>
        {act.id === 'goto' && (
          <Row label={t('miniInsp.page')}>
            <select value={act.pageId} onChange={(e) => patchEl({ action: { ...act, pageId: e.target.value } })}>
              {app.pages.map((pg) => (
                <option key={pg.id} value={pg.id}>
                  {pg.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {act.id === 'link' && (
          <Row label={t('f.url')}>
            <input value={act.url} placeholder="https://…" onChange={(e) => patchEl({ action: { ...act, url: e.target.value } })} />
          </Row>
        )}
        {act.id === 'data' && (
          <>
            <Row label={t('miniInsp.data.table')}>
              <TableSelect items={collections} value={act.table} onPick={(v) => patchEl({ action: { ...act, table: v } })} />
            </Row>
            {/* Упрощённо: только литералы (колонка + текстовое значение). */}
            {act.values.map((r, i) => (
              <div className="insp-list-row" key={i}>
                <input
                  aria-label={t('miniInsp.data.column')}
                  value={r.kind === 'literal' ? r.column : ''}
                  onChange={(e) =>
                    patchEl({
                      action: {
                        ...act,
                        values: act.values.map((x, j): MiniValueRef =>
                          j === i ? { kind: 'literal', column: e.target.value, value: x.kind === 'literal' ? x.value : '' } : x
                        ),
                      },
                    })
                  }
                />
                <input
                  aria-label={t('f.value')}
                  value={r.kind === 'literal' ? r.value : ''}
                  onChange={(e) =>
                    patchEl({
                      action: {
                        ...act,
                        values: act.values.map((x, j): MiniValueRef =>
                          j === i ? { kind: 'literal', column: x.kind === 'literal' ? x.column : '', value: e.target.value } : x
                        ),
                      },
                    })
                  }
                />
                <button
                  type="button"
                  className="ghost"
                  aria-label={t('data.item.delete')}
                  onClick={() => patchEl({ action: { ...act, values: act.values.filter((_, j) => j !== i) } })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                patchEl({ action: { ...act, values: [...act.values, { kind: 'literal', column: '', value: '' }] } })
              }
            >
              + {t('f.value')}
            </button>
          </>
        )}
        {act.id === 'scenario' && (
          <Row label={t('f.command')}>
            <input value={act.target} onChange={(e) => patchEl({ action: { ...act, target: e.target.value } })} />
          </Row>
        )}
        {act.id === 'toggle' && (
          <Row label={t('miniInsp.pageElement')}>
            <select value={act.elementId} onChange={(e) => patchEl({ action: { ...act, elementId: e.target.value } })}>
              <option value="">—</option>
              {(page?.els ?? [])
                .filter((x) => x.id !== el.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {t(MINI_ELEMENT_META[x.type].label as TKey)} · {x.id}
                  </option>
                ))}
            </select>
          </Row>
        )}
        {act.id === 'ai' && (
          <Row label={t('miniInsp.act.aiPrompt')}>
            <input value={act.prompt} onChange={(e) => patchEl({ action: { ...act, prompt: e.target.value } })} />
          </Row>
        )}
        {act.id === 'favorite' && (
          <Row label={t('miniInsp.act.favorite')}>
            <input value={act.itemId} placeholder="{field.id}" onChange={(e) => patchEl({ action: { ...act, itemId: e.target.value } })} />
          </Row>
        )}
        {act.id === 'pay' && (
          <>
            <Row label={t('miniInsp.act.pay.product')}>
              <input value={act.product} onChange={(e) => patchEl({ action: { ...act, product: e.target.value } })} />
            </Row>
            <Row label={t('miniInsp.act.pay.stars')}>
              <input
                type="number"
                min={1}
                max={10000}
                value={act.stars}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  patchEl({ action: { ...act, stars: Number.isFinite(n) ? Math.max(1, Math.min(10000, n)) : 1 } });
                }}
              />
            </Row>
          </>
        )}
      </>
    );
  }

  // ------------------------------------------------------------- видимость

  function visibleSection() {
    if (!el) return null;
    const vw = el.visible_when ?? null;
    return (
      <>
        <label className="checkline">
          <input
            type="checkbox"
            checked={!!vw}
            onChange={(e) => patchEl({ visible_when: e.target.checked ? { left: 'user.name', op: '==', right: '' } : null })}
          />
          {vw ? t('miniInsp.visible.on') : t('miniInsp.visible.off')}
        </label>
        {vw && (
          <>
            <Row label={t('miniInsp.visible.left')}>
              <input value={vw.left} onChange={(e) => patchEl({ visible_when: { ...vw, left: e.target.value } })} />
            </Row>
            <Row label={t('miniInsp.visible.op')}>
              <select value={vw.op} onChange={(e) => patchEl({ visible_when: { ...vw, op: e.target.value as ConditionOp } })}>
                {ALL_OPS.map((op) => (
                  <option key={op} value={op}>
                    {t(OP_KEYS[op])}
                  </option>
                ))}
              </select>
            </Row>
            {vw.op !== 'empty' && vw.op !== 'not_empty' && (
              <Row label={t('f.value')}>
                <input value={vw.right} onChange={(e) => patchEl({ visible_when: { ...vw, right: e.target.value } })} />
              </Row>
            )}
          </>
        )}
      </>
    );
  }

  // ------------------------------------------------------------- рендер

  const meta = el ? MINI_ELEMENT_META[el.type] : null;

  return (
    <div className="inspector">
      {!el && (
        <>
          <Sec title={t('miniInsp.page')} open>
            <Row label={t('mini.name')}>
              <input value={page?.name ?? ''} onChange={(e) => patchPage({ name: e.target.value })} />
            </Row>
            <Row label={t('miniInsp.pageBg')}>
              <input type="color" value={hex(page?.bg, '#ffffff')} onChange={(e) => patchPage({ bg: e.target.value })} />
            </Row>
            <div className="insp-section-title">{t('miniInsp.css.title')}</div>
            <Row label={t('miniInsp.css.page')}>
              <textarea
                value={str(page?.css)}
                placeholder="background: #f4f6fb"
                onChange={(e) => patchPage({ css: sanitizeCss(e.target.value) || undefined })}
              />
              <div className="insp-list-count">
                {t('miniInsp.css.count', { n: str(page?.css).length, max: MINI_CSS_MAX })}
              </div>
              <div className="muted">{t('miniInsp.css.hint')}</div>
            </Row>
          </Sec>
          <p className="muted">{t('miniInsp.empty')}</p>
        </>
      )}

      {el && (
        <>
          <div className="insp-section" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong>{t((meta?.label ?? 'miniInsp.props') as TKey)}</strong>
            <button
              type="button"
              className="danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => onChange(removeEl(app, pageIdx, el.id))}
            >
              {t('miniInsp.del')}
            </button>
          </div>

          <Sec title={t('miniInsp.position')} open>
            <div className="insp-list-row">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <input
                  key={k}
                  type="number"
                  aria-label={k.toUpperCase()}
                  value={el[k]}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) patchEl({ [k]: n } as Partial<MiniElement>);
                  }}
                />
              ))}
            </div>
            <div className="insp-section-title">{t('miniInsp.order')}</div>
            <div className="insp-list-row">
              <button type="button" className="secondary" onClick={() => onChange(moveZ(app, pageIdx, el.id, 'front'))}>
                {t('miniInsp.front')}
              </button>
              <button type="button" className="secondary" onClick={() => onChange(moveZ(app, pageIdx, el.id, 'back'))}>
                {t('miniInsp.back')}
              </button>
              <button type="button" className="secondary" onClick={() => onChange(duplicateEl(app, pageIdx, el.id))}>
                {t('miniInsp.dup')}
              </button>
            </div>
          </Sec>

          <Sec title={t('miniInsp.props')} open>
            {contentSection()}
          </Sec>

          <Sec title={t('miniInsp.style')}>
            <Row label={t('miniInsp.st.bg')}>
              <input type="color" value={hex(el.style.bg, '#ffffff')} onChange={(e) => patchStyle({ bg: e.target.value })} />
            </Row>
            <Row label={t('miniInsp.st.color')}>
              <input type="color" value={hex(el.style.color, '#1d1d1f')} onChange={(e) => patchStyle({ color: e.target.value })} />
            </Row>
            <Row label={t('miniInsp.st.size')}>
              <input
                type="number"
                min={8}
                max={60}
                value={el.style.size ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  patchStyle({ size: e.target.value === '' || !Number.isFinite(n) ? undefined : n });
                }}
              />
            </Row>
            <Row label={t('miniInsp.st.radius')}>
              <input
                type="number"
                min={0}
                max={60}
                value={el.style.radius ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  patchStyle({ radius: e.target.value === '' || !Number.isFinite(n) ? undefined : n });
                }}
              />
            </Row>
            <Row label={t('miniInsp.st.align')}>
              <select
                value={el.style.align ?? ''}
                onChange={(e) => patchStyle({ align: (e.target.value || undefined) as MiniElementStyle['align'] })}
              >
                <option value="">—</option>
                <option value="left">{t('miniInsp.st.align.left')}</option>
                <option value="center">{t('miniInsp.st.align.center')}</option>
                <option value="right">{t('miniInsp.st.align.right')}</option>
              </select>
            </Row>
            <label className="checkline">
              <input type="checkbox" checked={!!el.style.shadow} onChange={(e) => patchStyle({ shadow: e.target.checked })} />
              {t('miniInsp.st.shadow')}
            </label>
            <Row label={t('miniInsp.st.grad')}>
              <select
                value={GRADS.some((g) => g.v === (el.style.grad ?? '')) ? el.style.grad ?? '' : ''}
                onChange={(e) => patchStyle({ grad: e.target.value || undefined })}
              >
                {GRADS.map((g) => (
                  <option key={g.label} value={g.v}>
                    {t(g.label)}
                  </option>
                ))}
              </select>
            </Row>
            <div className="insp-section-title">{t('miniInsp.css.title')}</div>
            <Row label={t('miniInsp.css.scope')}>
              <textarea
                value={str(el.style.css)}
                placeholder="color: #fff; border-radius: 16px"
                onChange={(e) => patchStyle({ css: sanitizeCss(e.target.value) || undefined })}
              />
              <div className="insp-list-count">
                {t('miniInsp.css.count', { n: str(el.style.css).length, max: MINI_CSS_MAX })}
              </div>
              <div className="muted">{t('miniInsp.css.hint')}</div>
            </Row>
          </Sec>

          <Sec title={t('miniInsp.action')}>{actionSection()}</Sec>

          <Sec title={t('miniInsp.visible')}>{visibleSection()}</Sec>
        </>
      )}

      <div className="insp-footer">
        <button type="button" className="secondary" onClick={onPreview}>
          {t('miniInsp.preview')}
        </button>
        <label className="checkline">
          <input type="checkbox" checked={menuButton} onChange={(e) => setMenuButton(e.target.checked)} />
          {t('miniInsp.menuButton')}
        </label>
        <button type="button" className="primary" onClick={() => onPublish(menuButton)}>
          {t('miniInsp.publish')}
        </button>
      </div>
    </div>
  );
}
