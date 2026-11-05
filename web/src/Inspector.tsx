// Правая панель: поля выбранного блока.
//
// По макету docs/mockup-blocks.html панель содержит ТОЛЬКО содержимое блока:
// id, тип, бейдж «точка входа», «Далее →» и чекбокс включения убраны из шапки.
// Служебное собрано в одну приглушённую строку внизу, подсказка для новичка —
// в поповере «?». Что именно убрано и почему — F6 в docs/PROMPT_EDITOR.md.
import {
  Block,
  BlockParams,
  BlockType,
  ConditionOp,
  ConditionDef,
  ButtonDef,
  OptionDef,
  CaseDef,
  MediaItemDef,
  ChainItemDef,
  HttpPagination,
} from '../../shared/types';
import type { Issue } from '../../shared/validate';
import { parseCronExpr } from '../../shared/cron';
import { AI_HISTORY_TURNS_DEFAULT, AI_HISTORY_TURNS_MAX, MAX_SCHEDULES_PER_BOT, DEFAULT_SCHEDULE_TIMEZONE, MAX_POLL_OPTIONS, MAX_MEDIA_ITEMS } from '../../shared/limits';
import { nodeLabel, BLOCK_META, normalizeSearch } from './blocks';
import { collectVars } from './graph';
import { SYSTEM_VARS } from './vars';
import { VarChips } from './VarChips';
import { api, type Collection, type PaymentConnection } from './api';
import { validationIssueMessage } from './journey';
import { useT, type TKey, type Lang } from './i18n';
import { useSettings } from './settings';
import { X } from './icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Node } from '@xyflow/react';
import './insp.css';

// Стабильный id для элементов списков (кнопки, кейсы, варианты, медиа).
// Раньше списки рендерились с key={i}: удаление строки сдвигало индексы, и
// React переносил введённый текст на соседний элемент. Старые элементы из базы
// id не имеют — для них остаётся индекс.
let itemSeq = 0;
const newItemId = () => `it${Date.now().toString(36)}${(itemSeq++).toString(36)}`;

// Значение кнопки (callback_data и ключ ветки) автору не показываем: оно
// техническое. Генерируем при создании и НЕ перегенерируем при смене подписи —
// иначе уже проведённые связи от портов отвалятся.
function nextButtonValue(list: ButtonDef[]): string {
  let n = list.length + 1;
  const used = new Set(list.map((b) => b.value));
  while (used.has(`v${n}`)) n++;
  return `v${n}`;
}

// Секция полей. Нужна, потому что раньше инспектор был одной колонкой из
// 15–25 одинаковых строк: ни глазу зацепиться, ни найти нужное поле.
// «Дополнительно» и «Опасная зона» получают отдельную метку снизу, а не в
// общем списке: так диструктивные действия не соседствуют с обычными полями.
function Section({
  title,
  danger,
  children,
}: {
  title: TKey;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className={`insp-section${danger ? ' danger-zone' : ''}`}>
      <div className="insp-section-title">{t(title)}</div>
      {children}
    </section>
  );
}

export function Inspector({
  block,
  allBlocks,
  nodes,
  onChange,
  onDelete,
  isStart,
  onMakeStart,
  collections,
  botId,
  onOpenPayments,
  onCreateGoto,
  issues,
  platform = 'telegram',
}: {
  block: Block;
  allBlocks: Block[];
  /** Узлы нужны чипсам переменных: они показывают, откуда переменная пришла. */
  nodes?: Node[];
  onChange: (p: BlockParams, branches?: Record<string, string>, next?: string) => void;
  onDelete: () => void;
  isStart?: boolean;
  onMakeStart?: () => void;
  // Таблицы этого бота: блоку «Данные» нужно знать, куда писать и что искать.
  collections?: Collection[];
  /** id бота: нужен блокам платежей, чтобы грузить подключения владельца. */
  botId?: string;
  /** Открыть страницу «Оплата»: показывается в пустом состоянии подключений. */
  onOpenPayments?: () => void;
  /** Создать блок «переход» на указанный блок (возврат в цикл для foreach). */
  onCreateGoto?: (targetBlockId: string) => void;
  /** Замечания валидатора: показываются инлайн у полей своего блока. */
  issues?: Issue[];
  /** Платформа бота: VK-специфичные подсказки в платежных блоках. */
  platform?: 'telegram' | 'vk';
}) {
  const t = useT();
  const { language, skill_level, hints_enabled } = useSettings();
  const teachMode = skill_level === 'low' && hints_enabled;
  const [showHelp, setShowHelp] = useState(false);
  const [gotoQuery, setGotoQuery] = useState('');
  // Поле, в которое последним встал курсор: чипсы вставляют именно в него.
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const p = block.params;
  // Неизвестный тип блока (WU-01): инспектор не роняем — вместо метаданных
  // показываем машинное имя и нейтральный цвет.
  const meta = BLOCK_META[block.type] ?? { label: block.type, hint: '', color: '#64748b' };
  const set = (patch: Partial<BlockParams>) => onChange({ ...p, ...patch });
  const fieldId = (name: string) => `inspector-${block.id}-${name}`;
  const targets = allBlocks.filter((b) => b.id !== block.id);

  // ------------------------------------------------------- составные условия
  // Режим редактора условия: список (conditions[]) или легаси-строка
  // (condVar/op/condValue). Стартовый режим — по данным блока: явно заданный
  // массив (даже пустой) — это список; переключение только руками, молча
  // легаси в список не конвертируем.
  const [condListMode, setCondListMode] = useState(Array.isArray(p.conditions));
  useEffect(() => {
    setCondListMode(Array.isArray(block.params.conditions));
  }, [block.id]);

  const switchCondMode = (toList: boolean) => {
    if (toList) {
      setCondListMode(true);
      const cur = p.conditions;
      if (!Array.isArray(cur) || !cur.length) {
        // Осознанный переход: одиночное условие становится первой строкой списка.
        set({
          conditions: [
            {
              source: p.condSource === 'tag' ? 'tag' : 'var',
              var: p.condVar || '',
              op: p.op || '==',
              value: p.condValue || '',
            },
          ],
        });
      }
    } else {
      setCondListMode(false);
      set({ conditions: undefined });
    }
  };

  // ---------------------------------------------------------------- валидация
  // Замечания валидатора именно этого блока: показываются рядом с полем,
  // к которому относятся (карта code → поле), остальные — полосой под шапкой.
  const blockIssues = useMemo(
    () => (issues || []).filter((i) => i.blockId === block.id),
    [issues, block.id]
  );

  const fieldKeyOf = (code: string): string => {
    if (code.startsWith('cond-')) {
      if (block.type === 'segment_broadcast') return 'segmentWhere';
      return condListMode ? 'conditions' : 'legacyCond';
    }
    // markup-tags проверяется у всех блоков, а поле parseMode рисуется только
    // у «форматируемых»: иначе замечание повисло бы без своего поля.
    if (code === 'markup-tags') return FORMATTING_TYPES.includes(block.type) ? 'parseMode' : '';
    return ISSUE_FIELD[code] || '';
  };

  const issueBox = (fieldKey: string) => {
    const list = blockIssues.filter((i) => fieldKeyOf(i.code) === fieldKey);
    if (!list.length) return null;
    return (
      <>
        {list.map((i, n) => (
          <IssueBox key={`${i.code}-${n}`} issue={i} language={language} />
        ))}
      </>
    );
  };

  // Замечания, которым не досталось поля (ветки, таймауты…), — под шапкой.
  const restIssues = NEW_BLOCK_TYPES.includes(block.type)
    ? blockIssues.filter((i) => !fieldKeyOf(i.code))
    : [];

  // Открыли блок с замечанием — подводим к первому проблемному полю.
  useEffect(() => {
    const first = blockIssues.find((i) => fieldKeyOf(i.code));
    if (!first) return;
    const el = document.getElementById(fieldId(fieldKeyOf(first.code)));
    el?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, issues]);

  // ---------------------------------------------------------------- платежи
  // Подключения владельца для payment_link/payment_check. null — ещё грузим,
  // [] — подключений нет (пустое состояние с выходом на страницу «Оплата»).
  const needsConnections = block.type === 'payment_link' || block.type === 'payment_check';
  const [connections, setConnections] = useState<PaymentConnection[] | null>(null);
  useEffect(() => {
    if (!needsConnections || !botId) return;
    let alive = true;
    api.payments
      .listConnections(botId)
      .then((r) => {
        if (alive) setConnections(r.connections || []);
      })
      .catch(() => {
        if (alive) setConnections([]);
      });
    return () => {
      alive = false;
    };
  }, [needsConnections, botId]);

  // Переменные сценария для чипсов: тот же источник, что и в панели
  // «Переменные» плюс системные. Второго списка быть не должно.
  const varList = useMemo(() => {
    const scene = nodes?.length
      ? collectVars(nodes, (b) => nodeLabel(b, language))
      : [];
    const known = scene.filter((v) => v.definedIn.length);
    const extra = SYSTEM_VARS.filter((s) => !known.some((v) => v.name === s.name)).map((s) => ({
      name: s.name,
      definedIn: [] as { id: string; label: string }[],
      usedIn: [] as { id: string; label: string }[],
      system: true,
    }));
    return [...known, ...extra];
  }, [nodes, language]);

  const chipsFor = (fieldKey: string) => (
    <VarChips
      vars={varList}
      getField={() => lastField.current}
      onInsert={(name) => {
        // Поле не найдено — дописываем значение в состояние поля.
        const current = String((p as Record<string, unknown>)[fieldKey] ?? '');
        set({ [fieldKey]: `${current}{{${name}}}` } as Partial<BlockParams>);
      }}
    />
  );

  // Запоминаем активное поле — чипсы вставляют в него, а не «куда-нибудь».
  const trackField = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    lastField.current = e.target;
  };

  const insertMarkup = (key: string, before: string, after: string, needsHtml = true) => {
    const field = lastField.current;
    const current = String((p as Record<string, unknown>)[key] ?? '');
    const isCurrent = field?.id === fieldId(key);
    const start = isCurrent ? field!.selectionStart ?? current.length : current.length;
    const end = isCurrent ? field!.selectionEnd ?? start : start;
    const selected = current.slice(start, end);
    const next = `${current.slice(0, start)}${before}${selected || 'текст'}${after}${current.slice(end)}`;
    set({ [key]: next, ...(needsHtml && !p.parseMode ? { parseMode: 'HTML' } : {}) } as Partial<BlockParams>);
    requestAnimationFrame(() => {
      if (!isCurrent) return;
      field!.focus();
      const cursor = start + before.length + (selected || 'текст').length + after.length;
      field!.setSelectionRange(cursor, cursor);
    });
  };

  const textField = (
    key: string,
    label: TKey,
    opts?: { placeholder?: string; textarea?: boolean; rows?: number }
  ) => {
    const value = String((p as Record<string, unknown>)[key] ?? '');
    const common = {
      id: fieldId(key),
      'aria-label': t(label),
      value,
      onFocus: trackField,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        set({ [key]: e.target.value } as Partial<BlockParams>),
      placeholder: opts?.placeholder,
    };
    return (
      <div className="insp-field">
        <label htmlFor={fieldId(key)}>{t(label)}</label>
        {opts?.textarea ? <textarea {...common} /> : <input {...common} />}
        {opts?.textarea && ['text', 'prompt', 'menuPrompt', 'caption', 'segmentText', 'forwardText'].includes(key) && (
          <div className="text-format-tools" role="group" aria-label={t('f.parseMode')}>
            <button type="button" title={t('f.format.bold')} aria-label={t('f.format.bold')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMarkup(key, '<b>', '</b>')}>B</button>
            <button type="button" title={t('f.format.italic')} aria-label={t('f.format.italic')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMarkup(key, '<i>', '</i>')}>I</button>
            <button type="button" title={t('f.format.link')} aria-label={t('f.format.link')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMarkup(key, '<a href="https://">', '</a>')}>↗</button>
          </div>
        )}
        {chipsFor(key)}
        {issueBox(key)}
      </div>
    );
  };

  // Числовое поле: пустой ввод убирает значение из params (undefined), а не
  // превращает его в 0 — движок и валидатор трактуют отсутствие как «по умолчанию».
  const numField = (key: string, label: TKey, opts?: { min?: number; max?: number }) => {
    const raw = (p as Record<string, unknown>)[key];
    const num = Number(raw);
    return (
      <div className="insp-field">
        <label htmlFor={fieldId(key)}>{t(label)}</label>
        <input
          id={fieldId(key)}
          type="number"
          min={opts?.min}
          max={opts?.max}
          value={raw == null || raw === '' || !Number.isFinite(num) ? '' : num}
          onChange={(e) =>
            set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<BlockParams>)
          }
        />
        {issueBox(key)}
      </div>
    );
  };

  const checkField = (key: string, label: TKey, checked: boolean, onToggle?: () => void) => (
    <label className="checkline insp-check" key={key}>
      <input
        type="checkbox"
        id={fieldId(key)}
        checked={checked}
        onChange={onToggle ?? ((e) => set({ [key]: e.target.checked } as Partial<BlockParams>))}
      />
      <span>{t(label)}</span>
    </label>
  );

  // Постраничный обход http: тумблер + вложенный редактор HttpPagination.
  // Выключение убирает paginate из params — движок возвращает прежнее
  // поведение (один запрос). collectVar показываем вместе с пагинацией:
  // без неё ответ и так пишется в outVar.
  const paginationEditor = () => {
    const pg = p.paginate;
    const put = (patch: Partial<HttpPagination>) =>
      set({ paginate: { kind: 'page', param: '', ...(pg || {}), ...patch } });
    return (
      <>
        {checkField(
          'paginate',
          'f.http.paginate',
          !!pg,
          () => set({ paginate: pg ? undefined : { kind: 'page', param: 'page' } })
        )}
        {pg && (
          <div className="insp-field">
            <div className="insp-field">
              <label htmlFor={fieldId('pgKind')}>{t('f.http.paginate.kind')}</label>
              <select
                id={fieldId('pgKind')}
                value={pg.kind || 'page'}
                onChange={(e) => put({ kind: e.target.value as HttpPagination['kind'] })}
              >
                <option value="page">{t('f.http.paginate.page')}</option>
                <option value="offset">{t('f.http.paginate.offset')}</option>
                <option value="cursor">{t('f.http.paginate.cursor')}</option>
              </select>
            </div>
            <div className="insp-field">
              <label htmlFor={fieldId('pgParam')}>{t('f.http.paginate.param')}</label>
              <input
                id={fieldId('pgParam')}
                value={pg.param || ''}
                placeholder={pg.kind === 'cursor' ? 'cursor' : 'page'}
                onChange={(e) => put({ param: e.target.value })}
              />
            </div>
            {pg.kind !== 'cursor' && (
              <div className="insp-field">
                <label htmlFor={fieldId('pgStart')}>{t('f.http.paginate.start')}</label>
                <input
                  id={fieldId('pgStart')}
                  type="number"
                  value={pg.start ?? ''}
                  placeholder="1"
                  onChange={(e) => put({ start: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
            )}
            {pg.kind !== 'cursor' && (
              <div className="insp-field">
                <label htmlFor={fieldId('pgStep')}>{t('f.http.paginate.step')}</label>
                <input
                  id={fieldId('pgStep')}
                  type="number"
                  min={1}
                  value={pg.step ?? ''}
                  placeholder="1"
                  onChange={(e) => put({ step: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
            )}
            <div className="insp-field">
              <label htmlFor={fieldId('pgMaxPages')}>{t('f.http.paginate.maxPages')}</label>
              <input
                id={fieldId('pgMaxPages')}
                type="number"
                min={1}
                max={50}
                value={pg.maxPages ?? ''}
                placeholder="10"
                onChange={(e) => put({ maxPages: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </div>
            {pg.kind === 'cursor' && (
              <>
                <div className="insp-field">
                  <label htmlFor={fieldId('pgCursorPath')}>{t('f.http.paginate.cursorPath')}</label>
                  <input
                    id={fieldId('pgCursorPath')}
                    value={pg.cursorPath || ''}
                    placeholder="meta.after"
                    onChange={(e) => put({ cursorPath: e.target.value })}
                  />
                </div>
                <div className="insp-field">
                  <label htmlFor={fieldId('pgNextCursorPath')}>{t('f.http.paginate.nextCursorPath')}</label>
                  <input
                    id={fieldId('pgNextCursorPath')}
                    value={pg.nextCursorPath || ''}
                    placeholder="meta.next"
                    onChange={(e) => put({ nextCursorPath: e.target.value })}
                  />
                </div>
              </>
            )}
            <div className="insp-field">
              <label htmlFor={fieldId('pgDelayMs')}>{t('f.http.paginate.delayMs')}</label>
              <input
                id={fieldId('pgDelayMs')}
                type="number"
                min={0}
                value={pg.delayMs ?? ''}
                onChange={(e) => put({ delayMs: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </div>
            <div className="insp-field">
              <label htmlFor={fieldId('collectVar')}>{t('f.http.collectVar')}</label>
              <input
                id={fieldId('collectVar')}
                value={p.collectVar || ''}
                placeholder={t('f.outVar.placeholder')}
                onChange={(e) => set({ collectVar: e.target.value })}
              />
            </div>
          </div>
        )}
      </>
    );
  };

  // Секция «Оформление»: parseMode + отключение превью ссылок. Показывать
  // только у блоков, чей текст движок рендерит с parseMode (render/attachMarkup).
  const parseModeField = () => (
    <div className="insp-field">
      <label htmlFor={fieldId('parseMode')}>{t('f.parseMode')}</label>
      <select
        id={fieldId('parseMode')}
        value={p.parseMode || 'none'}
        onChange={(e) => set({ parseMode: e.target.value as BlockParams['parseMode'] })}
      >
        <option value="none">{t('f.parseMode.none')}</option>
        <option value="HTML">{t('f.parseMode.HTML')}</option>
        <option value="MarkdownV2">{t('f.parseMode.MarkdownV2')}</option>
      </select>
      {issueBox('parseMode')}
    </div>
  );

  const formattingSection = () => (
    <Section title="insp.section.formatting">
      {parseModeField()}
      {checkField('disablePreview', 'f.disablePreview', !!p.disablePreview)}
    </Section>
  );

  // Удаление сообщений: движок читает эти флаги у message/input/contact/
  // menu/chain/wait (pushDeletes в engine.ts).
  const deletesSection = () => (
    <Section title="insp.section.behavior">
      {checkField('deleteUserMessage', 'f.deleteUserMessage', !!p.deleteUserMessage)}
      {checkField('deleteBotMessage', 'f.deleteBotMessage', !!p.deleteBotMessage)}
    </Section>
  );

  // UX инлайн-кнопок: только у buttons — pushCallbackUx и cbEditTarget в
  // движке вызываются исключительно для блока кнопок (menu — reply-клавиатура,
  // callback у неё не бывает).
  const callbackUxSection = () => (
    <Section title="insp.section.behavior">
      {textField('cbToast', 'f.cb.toast')}
      {textField('cbAlert', 'f.cb.alert')}
      <div className="insp-field">
        <label htmlFor={fieldId('updateMode')}>{t('f.cb.updateMode')}</label>
        <select
          id={fieldId('updateMode')}
          value={p.updateMode || 'send'}
          onChange={(e) => set({ updateMode: e.target.value as BlockParams['updateMode'] })}
        >
          <option value="send">{t('f.cb.updateMode.send')}</option>
          <option value="edit">{t('f.cb.updateMode.edit')}</option>
        </select>
      </div>
    </Section>
  );

  // Select платёжного подключения + пустое состояние с выходом на страницу
  // «Оплата» (кнопка — только если интеграция передала onOpenPayments).
  const connectionField = () => {
    const noConnections = !botId || (connections !== null && connections.length === 0);
    return (
      <div className="insp-field">
        <label htmlFor={fieldId('connectionId')}>{t('f.pay.connection')}</label>
        {noConnections ? (
          <div className="insp-pay-empty">
            <div className="muted">{t('f.pay.empty')}</div>
            {onOpenPayments && (
              <button type="button" className="link" onClick={onOpenPayments}>
                {t('f.pay.openPayments')}
              </button>
            )}
          </div>
        ) : (
          <select
            id={fieldId('connectionId')}
            value={p.connectionId || ''}
            onChange={(e) => set({ connectionId: e.target.value })}
          >
            <option value="">—</option>
            {(connections || [])
              .filter((c) => c.enabled || c.id === p.connectionId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || t(`payments.provider.${c.provider}` as TKey)}
                </option>
              ))}
          </select>
        )}
        {botId && connections === null && <div className="muted">{t('payments.loading')}</div>}
        {issueBox('connectionId')}
      </div>
    );
  };

  const editButtons = (list: ButtonDef[], apply: (next: ButtonDef[]) => void, addKey: TKey) => {
    const addLabel = t(addKey);
    return (
      <>
        {(list || []).map((b, i) => (
          <div key={b.id ?? i} className="btn-card">
            <div className="row">
              <input
                placeholder={t('f.button')}
                value={b.label}
                onFocus={trackField}
                onChange={(e) => {
                  const nb = [...(list || [])];
                  // Подпись меняем, значение — нет: иначе связь от порта отвалится.
                  nb[i] = { ...nb[i], label: e.target.value };
                  apply(nb);
                }}
              />
              <button
                className="ghost icon-btn"
                title={t('insp.remove')}
                aria-label={t('insp.remove')}
                onClick={() => apply((list || []).filter((_, idx) => idx !== i))}
              >
                <X />
              </button>
            </div>
            <div className="btn-card-hint muted">
              {b.url ? t('insp.value.hidden') : t('insp.buttons.portHint', { name: b.label || t('f.button') })}
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            apply([...(list || []), { id: newItemId(), label: addLabel, value: nextButtonValue(list || []) }])
          }
        >
          {t('insp.add', { name: addLabel.toLowerCase() })}
        </button>
        <div className="muted">{t('insp.buttons.hint')}</div>
      </>
    );
  };

  // Редактор «поле → значение» для блока «Данные». Значение — шаблон:
  // можно подставить {{name}} или написать текст целиком.
  const dataMapEditor = (mapKey: 'dataFields' | 'dataWhere') => {
    const map = ((p[mapKey] || {}) as Record<string, string>) ?? {};
    const coll = (collections || []).find((c) => c.id === p.collectionId);
    const fields = coll?.fields ?? [];
    const entries = Object.entries(map);
    const put = (next: Record<string, string>) => set({ [mapKey]: next } as Partial<BlockParams>);
    return (
      <>
        {entries.map(([k, v]) => (
          <div key={k} className="row">
            <select
              value={k}
              onChange={(e) => {
                const nk = e.target.value;
                const next: Record<string, string> = {};
                for (const [key, val] of entries) if (key !== k) next[key] = val;
                if (nk) next[nk] = v;
                put(next);
              }}
            >
              <option value="">—</option>
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              placeholder={t('f.data.value')}
              value={v}
              onFocus={trackField}
              onChange={(e) => put({ ...map, [k]: e.target.value })}
            />
            <button
              className="ghost icon-btn"
              title={t('insp.remove')}
              aria-label={t('insp.remove')}
              onClick={() => {
                const next = { ...map };
                delete next[k];
                put(next);
              }}
            >
              <X />
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            const free = fields.find((f) => !map[f]);
            put({ ...map, [free || `field${entries.length + 1}`]: '' });
          }}
        >
          {t('f.data.addField')}
        </button>
        {/* Значения полей поддерживают {{var}} — значит, чипсы нужны и здесь.
            Вставляются в то поле, где стоял курсор. */}
        {chipsFor('dataFields')}
      </>
    );
  };

  // «Переход» — единственный блок, который сохраняет список целей: прыжок
  // стрелкой не нарисуешь. Вместо плоского списка всех блоков — поиск по имени.
  // Тот же пикер использует payment_link.successNext (param='successNext'):
  // успешная оплата приходит вебхуком, стрелку к ней не протянуть.
  const gotoPicker = (param: 'target' | 'successNext' = 'target', labelKey?: TKey) => {
    const q = normalizeSearch(gotoQuery);
    const list = q
      ? targets.filter((b) => normalizeSearch(nodeLabel(b, language)).includes(q))
      : targets;
    const current = targets.find((b) => b.id === p[param]);
    const id = fieldId(param === 'target' ? 'goto' : param);
    return (
      <div className="insp-field">
        <label htmlFor={id}>{t(labelKey ?? 'f.goto.search')}</label>
        <input
          id={id}
          value={gotoQuery}
          placeholder={t('f.goto.search.placeholder')}
          onChange={(e) => setGotoQuery(e.target.value)}
        />
        {current && (
          <div className="muted insp-current">
            {t('f.goto.current')} <b>{nodeLabel(current, language)}</b>
          </div>
        )}
        {param === 'target' && !p.target && <div className="muted">{t('f.goto.noTarget')}</div>}
        <div className="chip-list">
          {list.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`target-chip${b.id === p[param] ? ' active' : ''}`}
              onClick={() => set({ [param]: b.id } as Partial<BlockParams>)}
            >
              {nodeLabel(b, language)}
            </button>
          ))}
          {!list.length && <span className="muted">{t('palette.search.empty')}</span>}
        </div>
      </div>
    );
  };

  // -------------------------------------------------- составные условия (UI)
  // Стабильные React-ключи строк условий: в модели ConditionDef нет id (и
  // мусорить сценарий служебным полем нельзя), поэтому ключи ведём параллельно
  // списку и синхронно прореживаем при удалении строки.
  const condKeys = useRef<Record<string, string[]>>({});
  const keysFor = (mapKey: string, len: number): string[] => {
    const cur = condKeys.current[mapKey] || [];
    while (cur.length < len) cur.push(newItemId());
    cur.length = len;
    condKeys.current[mapKey] = cur;
    return cur;
  };

  // Строка ConditionDef: source (var/tag/user) + var + op + value. Один
  // редактор на conditions[] (condition/assert) и segmentWhere.
  const conditionRow = (
    rowKey: string,
    def: ConditionDef,
    upd: (patch: Partial<ConditionDef>) => void,
    remove: () => void
  ) => {
    const noValue = def.op === 'empty' || def.op === 'not_empty';
    return (
      <div key={rowKey} className="insp-cond-row">
        <select
          value={def.source || 'var'}
          aria-label={t('f.condition.source')}
          onChange={(e) => upd({ source: e.target.value as ConditionDef['source'] })}
        >
          <option value="var">{t('f.condition.source.var')}</option>
          <option value="tag">{t('f.condition.source.tag')}</option>
          <option value="user">{t('f.condition.source.user')}</option>
        </select>
        <input
          value={def.var || ''}
          onFocus={trackField}
          aria-label={t('f.var')}
          placeholder={
            def.source === 'tag'
              ? t('f.tag.namePlaceholder')
              : def.source === 'user'
                ? t('f.condition.userVarPlaceholder')
                : t('f.condition.varPlaceholder')
          }
          onChange={(e) => upd({ var: e.target.value })}
        />
        <select
          value={def.op || '=='}
          aria-label={t('f.conditions.op')}
          onChange={(e) => upd({ op: e.target.value as ConditionOp })}
        >
          {ALL_OPS.map((op) => (
            <option key={op} value={op}>
              {t(`f.op.${opKey(op)}` as TKey)}
            </option>
          ))}
        </select>
        {!noValue && (
          <input
            value={def.value || ''}
            onFocus={trackField}
            aria-label={t('f.value')}
            placeholder={
              def.op === 'in' || def.op === 'not_in'
                ? t('f.condition.listPlaceholder')
                : t('f.condition.valuePlaceholder')
            }
            onChange={(e) => upd({ value: e.target.value })}
          />
        )}
        <button
          type="button"
          className="ghost icon-btn"
          title={t('insp.remove')}
          aria-label={t('insp.remove')}
          onClick={remove}
        >
          <X />
        </button>
      </div>
    );
  };

  // Список ConditionDef под одним ключом params. max — потолок строк:
  // 5 для conditions (condition/assert), 3 для segmentWhere (контракт набора).
  const conditionListEditor = (mapKey: 'conditions' | 'segmentWhere', max: number) => {
    const list = (p[mapKey] || []) as ConditionDef[];
    const keys = keysFor(mapKey, list.length);
    const apply = (next: ConditionDef[]) => set({ [mapKey]: next } as Partial<BlockParams>);
    return (
      <>
        {list.length > 1 && (
          <div className="insp-field">
            <label htmlFor={fieldId(`${mapKey}-logic`)}>{t('f.conditions.logic')}</label>
            <select
              id={fieldId(`${mapKey}-logic`)}
              value={p.logic || 'and'}
              onChange={(e) => set({ logic: e.target.value as BlockParams['logic'] })}
            >
              <option value="and">{t('f.conditions.logic.and')}</option>
              <option value="or">{t('f.conditions.logic.or')}</option>
            </select>
          </div>
        )}
        {list.map((def, i) =>
          conditionRow(
            keys[i],
            def,
            (patch) => {
              const next = [...list];
              next[i] = { ...def, ...patch };
              apply(next);
            },
            () => {
              // Ключи прореживаем вместе со списком — иначе при удалении
              // средней строки соседние инпуты переедут (key-по-индексу).
              condKeys.current[mapKey].splice(i, 1);
              apply(list.filter((_, idx) => idx !== i));
            }
          )
        )}
        <button
          type="button"
          disabled={list.length >= max}
          onClick={() => apply([...list, { source: 'var', var: '', op: '==', value: '' }])}
        >
          {t('f.conditions.add')}
        </button>
        {chipsFor(mapKey)}
        {issueBox(mapKey)}
      </>
    );
  };

  // Легаси-строка одиночного условия (condVar/op/condValue). Сохранена как
  // была — обратная совместимость: старый блок не конвертируем молча.
  const legacyConditionRow = () => (
    <>
      {/* По чему сравниваем: по переменной сценария или по тегу человека.
          Оба случая — одна и та же развилка «да/нет», меняется только
          источник значения. */}
      <div className="insp-field">
        <label>{t('f.condition.source')}</label>
        <div className="chip-list">
          {(['var', 'tag'] as const).map((src) => (
            <button
              key={src}
              type="button"
              className={`op-chip${(p.condSource || 'var') === src ? ' active' : ''}`}
              onClick={() => set({ condSource: src, ...(src === 'tag' ? { op: '==' as ConditionOp } : {}) })}
            >
              {t(src === 'tag' ? 'f.condition.source.tag' : 'f.condition.source.var')}
            </button>
          ))}
        </div>
      </div>
      {/* Три поля собраны в одну фразу «age равно 18» — она читается как
          предложение, а не как три несвязанных параметра. */}
      <div className="insp-field" id={fieldId('legacyCond')}>
        <label>{t('f.condition.phrase')}</label>
        <div className="row inline-row">
          <input
            value={p.condVar || ''}
            onFocus={trackField}
            onChange={(e) => set({ condVar: e.target.value })}
            placeholder={p.condSource === 'tag' ? t('f.tag.namePlaceholder') : t('f.condition.varPlaceholder')}
            aria-label={p.condSource === 'tag' ? t('f.tag.name') : t('f.var')}
          />
          <span className="eq">{t(`f.op.${opKey(p.op || '==')}` as TKey)}</span>
          {/* У тега сравнивать значение не с чем: важно только, стоит метка
              или нет. Поэтому второе поле при теге не показываем. */}
          {p.condSource !== 'tag' && (
            <input
              value={p.condValue || ''}
              onFocus={trackField}
              onChange={(e) => set({ condValue: e.target.value })}
              placeholder={t('f.condition.valuePlaceholder')}
              aria-label={t('f.value')}
            />
          )}
        </div>
        <div className="chip-list">
          {(p.condSource === 'tag' ? TAG_CONDS : ALL_OPS).map((op) => (
            <button
              key={op}
              type="button"
              className={`op-chip${(p.op || '==') === op ? ' active' : ''}`}
              onClick={() => set({ op })}
            >
              {t(`f.op.${opKey(op)}` as TKey)}
            </button>
          ))}
        </div>
        <div className="muted">{p.condSource === 'tag' ? t('f.condition.tagHelp') : t('f.condition.help')}</div>
        {chipsFor('condVar')}
        {issueBox('legacyCond')}
      </div>
    </>
  );

  // Редактор условия целиком: переключатель «одно условие / список» + тело.
  // Режим по данным блока: conditions[] задан (даже пустым) — список.
  const conditionEditor = (max = 5) => (
    <>
      <div className="chip-list">
        <button
          type="button"
          className={`op-chip${condListMode ? '' : ' active'}`}
          onClick={() => switchCondMode(false)}
        >
          {t('f.conditions.mode.single')}
        </button>
        <button
          type="button"
          className={`op-chip${condListMode ? ' active' : ''}`}
          onClick={() => switchCondMode(true)}
        >
          {t('f.conditions.mode.list')}
        </button>
      </div>
      {condListMode ? (
        <div id={fieldId('conditions')}>
          {conditionListEditor('conditions', max)}
          <div className="muted">{t('f.conditions.hint')}</div>
        </div>
      ) : (
        legacyConditionRow()
      )}
    </>
  );

  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className="dot" style={{ background: meta.color }} />
        <h3>{meta.label}</h3>
        {/* Подсказка для новичка уехала из потока: панель должна начинаться с
            полей блока, а не с объяснений. */}
        {teachMode && (
          <button
            className="ghost help-btn"
            aria-expanded={showHelp}
            aria-label={t('insp.help.more')}
            title={t('insp.help.more')}
            onClick={() => setShowHelp((v) => !v)}
          >
            ?
          </button>
        )}
      </div>

      {teachMode && showHelp && (
        <div className="help-pop">
          <p>{t('insp.help.what', { block: meta.label })}</p>
          <p>
            <b>{t('insp.example')}</b> {t(`block.${block.type}.example` as TKey)}
          </p>
          <p>
            <b>{t('insp.help.mistakes')}</b> {t('insp.help.mistakes.text')}
          </p>
        </div>
      )}

      {/* Замечания валидатора, не привязанные к конкретному полю (пустые
          ветки и т.п.) — сразу под шапкой, до полей блока. */}
      {restIssues.map((i, n) => (
        <IssueBox key={`${i.code}-${n}`} issue={i} language={language} />
      ))}

      {/* Блоки без полей — «Конец» и «Заметка» — сохраняют короткую поясняющую
          строку: без неё панель выглядит пустой и непонятной. */}
      {(block.type === 'end' || block.type === 'note') && (
        <div className="insp-note muted">{meta.hint}</div>
      )}

      {block.type === 'message' && (
        <>
          <Section title="insp.section.content">
            {textField('text', 'f.message.text', { textarea: true })}
          </Section>
          {formattingSection()}
          {/* Движок зовёт pushDeletes и у message — флаги здесь работают. */}
          {deletesSection()}
        </>
      )}

      {block.type === 'start' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('command')}>{t('f.start.command.label')}</label>
            <div className="row inline-row">
              <span className="eq">/</span>
              <input
                id={fieldId('command')}
                value={(p.command || '/start').replace(/^\//, '')}
                onChange={(e) => set({ command: `/${e.target.value.replace(/^\//, '')}` })}
              />
            </div>
            <div className="muted">{t('f.start.command.help', { cmd: p.command || '/start' })}</div>
          </div>
        </Section>
      )}

      {block.type === 'command' && (
        <>
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('command')}>{t('f.command')}</label>
            <input
              id={fieldId('command')}
              value={p.command || ''}
              onChange={(e) => set({ command: e.target.value })}
              placeholder={t('f.command.placeholder')}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('description')}>{t('f.description')}</label>
            <input
              id={fieldId('description')}
              value={p.description || ''}
              onFocus={trackField}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          {textField('prompt', 'f.enterMessage', { textarea: true })}
          <div className="muted">{t('f.command.hint')}</div>
        </Section>
        {formattingSection()}
        </>
      )}

      {block.type === 'input' && (
        <>
          <Section title="insp.section.content">
            <div className="insp-field">
              <label htmlFor={fieldId('var')}>{t('f.var')}</label>
              <input
                id={fieldId('var')}
                value={p.var || ''}
                onChange={(e) => set({ var: e.target.value })}
              />
            </div>
            <div className="insp-field">
              <label htmlFor={fieldId('kind')}>{t('f.kind')}</label>
              <select
                id={fieldId('kind')}
                value={p.kind || 'text'}
                onChange={(e) => set({ kind: e.target.value as BlockParams['kind'] })}
              >
                <option value="text">{t('f.kind.text')}</option>
                <option value="number">{t('f.kind.number')}</option>
                <option value="email">{t('f.kind.email')}</option>
                <option value="photo">{t('f.kind.photo')}</option>
                <option value="document">{t('f.kind.document')}</option>
                <option value="video">{t('f.kind.video')}</option>
                <option value="voice">{t('f.kind.voice')}</option>
                <option value="audio">{t('f.kind.audio')}</option>
                <option value="location">{t('f.kind.location')}</option>
                <option value="any">{t('f.kind.any')}</option>
              </select>
              {ATTACHMENT_KINDS.includes(p.kind || '') && (
                <div className="muted">{t('f.kind.attachmentHint')}</div>
              )}
            </div>
            {textField('prompt', 'f.prompt')}
            {/* Regex-проверка — только для текстовых видов: вложение приходит
                file_id, проверять его регуляркой нечего (движок тоже её
                применяет лишь к тексту). */}
            {!(p.kind && ATTACHMENT_KINDS.includes(p.kind)) && (
              <div className="insp-field">
                <label htmlFor={fieldId('regex')}>{t('f.regex')}</label>
                <input
                  id={fieldId('regex')}
                  value={p.regex || ''}
                  onChange={(e) => set({ regex: e.target.value })}
                  placeholder={t('f.regex.placeholder')}
                />
              </div>
            )}
            {/* Текст переспроса показываем, когда переспрос вообще возможен:
                regex-проверка ИЛИ kind с собственной валидацией (number/email). */}
            {(p.regex || p.kind === 'number' || p.kind === 'email') && (
              <div className="insp-field">
                <label htmlFor={fieldId('errorText')}>{t('f.errorText')}</label>
                <input
                  id={fieldId('errorText')}
                  value={p.errorText || ''}
                  onFocus={trackField}
                  onChange={(e) => set({ errorText: e.target.value })}
                  placeholder={t('f.errorText.placeholder')}
                />
                {(p.kind === 'number' || p.kind === 'email') && !p.regex && (
                  <div className="muted">{t('f.errorText.kindHint')}</div>
                )}
              </div>
            )}
            {issueBox('regex')}
          </Section>
          {deletesSection()}
        </>
      )}

      {block.type === 'contact' && (
        <>
          <Section title="insp.section.content">
            <div className="insp-field">
              <label htmlFor={fieldId('request')}>{t('f.contact.request')}</label>
              <select
                id={fieldId('request')}
                value={p.request || 'contact'}
                onChange={(e) => set({ request: e.target.value as BlockParams['request'] })}
              >
                <option value="contact">{t('f.contact.phone')}</option>
                <option value="location">{t('f.contact.location')}</option>
              </select>
            </div>
            <div className="insp-field">
              <label htmlFor={fieldId('var')}>{t('f.var')}</label>
              <input
                id={fieldId('var')}
                value={p.var || ''}
                onChange={(e) => set({ var: e.target.value })}
                placeholder={t('f.contact.varPlaceholder')}
              />
            </div>
            {textField('prompt', 'f.prompt')}
          </Section>
          {deletesSection()}
        </>
      )}

      {block.type === 'buttons' && (
        <>
          <Section title="insp.section.content">
          {textField('prompt', 'f.prompt', { textarea: true })}
          <div className="insp-field">
            <label htmlFor={fieldId('layout')}>{t('f.buttons.where')}</label>
            <select
              id={fieldId('layout')}
              value={p.layout || 'inline'}
              onChange={(e) => set({ layout: e.target.value as BlockParams['layout'] })}
            >
              <option value="inline">{t('f.layout.inline.new')}</option>
              <option value="reply">{t('f.layout.reply.new')}</option>
            </select>
          </div>
          </Section>
          {/* Каждая кнопка — отдельный порт: это ветки, а не оформление. */}
          <Section title="insp.section.branching">
            {editButtons(p.buttons || [], (nb) => {
              // Удалённая кнопка уносит с собой свою ветку, чтобы не осталось
              // стрелки от порта, которого больше нет.
              const keys = new Set(nb.map((b) => b.value));
              const nextBranches: Record<string, string> = {};
              for (const [k, v] of Object.entries(block.branches || {})) if (keys.has(k)) nextBranches[k] = v;
              onChange({ ...p, buttons: nb }, nextBranches);
            }, 'f.button')}
          </Section>
          {formattingSection()}
          {/* UX нажатия: движок читает cbToast/cbAlert/updateMode только у
              блока с инлайн-кнопками (pushCallbackUx / cbEditTarget).
              Флагов удаления здесь нет: buttons не зовёт pushDeletes, и
              чекбокс обещал бы то, чего движок не делает. */}
          {callbackUxSection()}
        </>
      )}

      {block.type === 'menu' && (
        <>
          <Section title="insp.section.content">
            {textField('menuPrompt', 'f.menu.prompt')}
            <div className="muted">{t('f.menu.hint')}</div>
          </Section>
          <Section title="insp.section.branching">
            {editButtons(p.buttons || [], (nb) => {
              const keys = new Set(nb.map((b) => b.value));
              const nextBranches: Record<string, string> = {};
              for (const [k, v] of Object.entries(block.branches || {})) if (keys.has(k)) nextBranches[k] = v;
              onChange({ ...p, buttons: nb }, nextBranches);
            }, 'f.item')}
          </Section>
          {formattingSection()}
          {/* updateMode/cbToast здесь нет: меню — reply-клавиатура, callback
              у неё не бывает (движок их применяет только к buttons). */}
          {deletesSection()}
        </>
      )}

      {block.type === 'condition' && (
        <Section title="insp.section.branching">
          {conditionEditor()}
        </Section>
      )}

      {block.type === 'switch' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('switchVar')}>{t('f.var')}</label>
            <input
              id={fieldId('switchVar')}
              value={p.switchVar || ''}
              onFocus={trackField}
              onChange={(e) => set({ switchVar: e.target.value })}
            />
            {chipsFor('switchVar')}
          </div>
          {(p.cases || []).map((c: CaseDef, i) => (
            <div key={c.id ?? i} className="row">
              <input
                placeholder={t('f.switch.casePlaceholder')}
                value={c.value}
                onChange={(e) => {
                  const nc = [...(p.cases || [])];
                  nc[i] = { value: e.target.value };
                  set({ cases: nc });
                }}
              />
              <button
                className="ghost icon-btn"
                title={t('insp.remove')}
                aria-label={t('insp.remove')}
                onClick={() => {
                  const nc = (p.cases || []).filter((_, idx) => idx !== i);
                  const nb: Record<string, string> = {};
                  nc.forEach((_, idx) => (nb[`c${idx}`] = (block.branches || {})[`c${idx + (idx >= i ? 1 : 0)}`] ?? ''));
                  nb.default = (block.branches || {}).default ?? '';
                  onChange({ ...p, cases: nc }, nb);
                }}
              >
                <X />
              </button>
            </div>
          ))}
          <button onClick={() => set({ cases: [...(p.cases || []), { id: newItemId(), value: '' }] })}>
            {t('f.switch.add')}
          </button>
        </Section>
      )}

      {block.type === 'keyword' && (
        <Section title="insp.section.content">
          {textField('keywords', 'f.keywords', { placeholder: t('f.keywords.placeholder') })}
          <div className="insp-field">
            <label htmlFor={fieldId('match')}>{t('f.match')}</label>
            <select
              id={fieldId('match')}
              value={p.matchMode || 'contains'}
              onChange={(e) => set({ matchMode: e.target.value as BlockParams['matchMode'] })}
            >
              <option value="contains">{t('f.match.contains')}</option>
              <option value="equals">{t('f.match.equals')}</option>
            </select>
          </div>
          <div className="muted">{t('f.keyword.hint')}</div>
        </Section>
      )}

      {block.type === 'random' && (
        <Section title="insp.section.branching">
          {(p.options || []).map((o: OptionDef, i) => (
            <div key={o.id ?? i} className="row">
              <input
                placeholder={t('f.random.branchPlaceholder')}
                value={o.key}
                onChange={(e) => {
                  const no = [...(p.options || [])];
                  no[i] = { ...no[i], key: e.target.value };
                  set({ options: no });
                }}
              />
              <input
                type="number"
                min={1}
                placeholder={t('f.random.weightPlaceholder')}
                value={o.weight}
                onChange={(e) => {
                  const no = [...(p.options || [])];
                  no[i] = { ...no[i], weight: Math.max(1, Number(e.target.value) || 1) };
                  set({ options: no });
                }}
              />
              <button
                className="ghost icon-btn"
                title={t('insp.remove')}
                aria-label={t('insp.remove')}
                onClick={() => set({ options: (p.options || []).filter((_, idx) => idx !== i) })}
              >
                <X />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              set({ options: [...(p.options || []), { id: newItemId(), key: `v${(p.options || []).length + 1}`, weight: 1 }] })
            }
          >
            {t('f.random.add')}
          </button>
          <div className="muted">{t('f.random.hint')}</div>
        </Section>
      )}

      {block.type === 'setvar' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('assignVar')}>{t('f.var')}</label>
            <input
              id={fieldId('assignVar')}
              value={p.assignVar || ''}
              onChange={(e) => set({ assignVar: e.target.value })}
              placeholder={t('f.setvar.varPlaceholder')}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('expr')}>{t('f.setvar.expr')}</label>
            <input
              id={fieldId('expr')}
              value={p.expr || ''}
              onFocus={trackField}
              onChange={(e) => set({ expr: e.target.value })}
              placeholder={t('f.setvar.exprPlaceholder')}
            />
            {chipsFor('expr')}
          </div>
          <div className="muted">{t('f.setvar.hint')}</div>
        </Section>
      )}

      {block.type === 'referral' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('refVar')}>{t('f.referral.var')}</label>
            <input
              id={fieldId('refVar')}
              value={p.refVar || ''}
              onChange={(e) => set({ refVar: e.target.value })}
              placeholder={t('f.referral.varPlaceholder')}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refPayload')}>{t('f.ref.payload')}</label>
            <input
              id={fieldId('refPayload')}
              value={p.refPayload || ''}
              onFocus={trackField}
              onChange={(e) => set({ refPayload: e.target.value })}
              placeholder={t('f.ref.payloadPlaceholder')}
            />
            {chipsFor('refPayload')}
          </div>
          <div className="muted">{t('f.ref.payload.hint')}</div>
          <div className="muted">
            {t('f.referral.hint1')} <span className="mono">https://t.me/ваш_бот?start=ref_&lt;id&gt;</span>{' '}
            {t('f.referral.hint2')} <span className="mono">{' {{ref.inviter}} '}</span> {t('f.referral.hint3')}{' '}
            <span className="mono">{' {{ref.count}} '}</span> {t('f.referral.hint4')}
          </div>
        </Section>
      )}

      {block.type === 'referral_track' && (
        <Section title="insp.section.content">
          <div className="insp-note muted">{meta.hint}</div>
          <div className="muted">{t('block.referral_track.example')}</div>
        </Section>
      )}

      {block.type === 'referral_check' && (
        <Section title="insp.section.content">
          <div className="insp-note muted">{meta.hint}</div>
          <div className="muted">{t('block.referral_check.example')}</div>
        </Section>
      )}

      {(block.type === 'referral_bonus' || block.type === 'referral_hierarchy') && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('refTrigger')}>{t('f.ref.trigger')}</label>
            <select
              id={fieldId('refTrigger')}
              value={p.refTrigger || 'nth_referral'}
              onChange={(e) => set({ refTrigger: e.target.value as BlockParams['refTrigger'] })}
            >
              <option value="nth_referral">{t('f.ref.trigger.nth_referral')}</option>
              <option value="first_payment">{t('f.ref.trigger.first_payment')}</option>
              <option value="subscription_started">{t('f.ref.trigger.subscription_started')}</option>
              <option value="custom_event">{t('f.ref.trigger.custom_event')}</option>
            </select>
          </div>
          {(p.refTrigger || 'nth_referral') === 'nth_referral' && (
            <div className="insp-field">
              <label htmlFor={fieldId('refTriggerN')}>{t('f.ref.triggerN')}</label>
              <input
                id={fieldId('refTriggerN')}
                type="number"
                min={1}
                value={p.refTriggerN ?? 5}
                onChange={(e) => set({ refTriggerN: Number(e.target.value) || 1 })}
              />
            </div>
          )}
          {p.refTrigger === 'custom_event' && (
            <div className="insp-field">
              <label htmlFor={fieldId('refEventName')}>{t('f.ref.eventName')}</label>
              <input
                id={fieldId('refEventName')}
                value={p.refEventName || ''}
                onChange={(e) => set({ refEventName: e.target.value })}
              />
              <div className="muted">{t('f.ref.eventName.hint')}</div>
            </div>
          )}
          {block.type === 'referral_hierarchy' ? (
            <>
              <div className="insp-field">
                <label htmlFor={fieldId('refDepth')}>{t('f.ref.depth')}</label>
                <input
                  id={fieldId('refDepth')}
                  type="number"
                  min={1}
                  max={5}
                  value={p.refDepth ?? 2}
                  onChange={(e) => {
                    const depth = Math.max(1, Math.min(5, Number(e.target.value) || 1));
                    // Доли подгоняем под глубину: лишние уровни обнуляем,
                    // новым — дефолт 0, автор заполнит сам.
                    const shares = [...(p.refShares || [])];
                    shares.length = depth;
                    for (let i = 0; i < depth; i++) if (shares[i] == null) shares[i] = 0;
                    set({ refDepth: depth, refShares: shares });
                  }}
                />
              </div>
              <div className="insp-field">
                <label>{t('f.ref.shares')}</label>
                {(p.refShares || []).map((s, i) => (
                  <div key={i} className="row">
                    <span className="muted">{i + 1}</span>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={s}
                      aria-label={`${t('f.ref.shares')} ${i + 1}`}
                      onChange={(e) => {
                        const shares = [...(p.refShares || [])];
                        shares[i] = Number(e.target.value) || 0;
                        set({ refShares: shares });
                      }}
                    />
                  </div>
                ))}
                <div className="muted">{t('f.ref.shares.hint')}</div>
              </div>
              <div className="insp-field">
                <label htmlFor={fieldId('refBonusText')}>{t('f.ref.bonusText')}</label>
                <textarea
                  id={fieldId('refBonusText')}
                  value={p.refBonusText || ''}
                  onFocus={trackField}
                  onChange={(e) => set({ refBonusText: e.target.value })}
                />
                {chipsFor('refBonusText')}
              </div>
            </>
          ) : (
            <>
              <div className="insp-field">
                <label htmlFor={fieldId('refBonusKind')}>{t('f.ref.bonusKind')}</label>
                <select
                  id={fieldId('refBonusKind')}
                  value={p.refBonusKind || 'send_message'}
                  onChange={(e) => set({ refBonusKind: e.target.value as BlockParams['refBonusKind'] })}
                >
                  <option value="send_message">{t('f.ref.bonus.send_message')}</option>
                  <option value="increment_variable">{t('f.ref.bonus.increment_variable')}</option>
                  <option value="grant_subscription_days">{t('f.ref.bonus.grant_subscription_days')}</option>
                </select>
              </div>
              {(p.refBonusKind || 'send_message') === 'send_message' && (
                <div className="insp-field">
                  <label htmlFor={fieldId('refBonusText')}>{t('f.ref.bonusText')}</label>
                  <textarea
                    id={fieldId('refBonusText')}
                    value={p.refBonusText || ''}
                    onFocus={trackField}
                    onChange={(e) => set({ refBonusText: e.target.value })}
                  />
                  {chipsFor('refBonusText')}
                </div>
              )}
              {p.refBonusKind === 'increment_variable' && (
                <>
                  <div className="insp-field">
                    <label htmlFor={fieldId('refBonusVar')}>{t('f.ref.bonusVar')}</label>
                    <input
                      id={fieldId('refBonusVar')}
                      value={p.refBonusVar || ''}
                      onChange={(e) => set({ refBonusVar: e.target.value })}
                    />
                  </div>
                  <div className="insp-field">
                    <label htmlFor={fieldId('refBonusAmount')}>{t('f.ref.bonusAmount')}</label>
                    <input
                      id={fieldId('refBonusAmount')}
                      type="number"
                      step="1"
                      min={1}
                      value={p.refBonusAmount ?? ''}
                      onChange={(e) => set({ refBonusAmount: Number(e.target.value) || 0 })}
                    />
                  </div>
                </>
              )}
              {p.refBonusKind === 'grant_subscription_days' && (
                <div className="insp-field">
                  <label htmlFor={fieldId('refBonusDays')}>{t('f.ref.bonusDays')}</label>
                  <input
                    id={fieldId('refBonusDays')}
                    type="number"
                    step="1"
                    min={1}
                    value={p.refBonusDays ?? ''}
                    onChange={(e) => set({ refBonusDays: Number(e.target.value) || 0 })}
                  />
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {block.type === 'referral_stats' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('refText')}>{t('f.ref.text')}</label>
            <textarea
              id={fieldId('refText')}
              value={p.refText || ''}
              onFocus={trackField}
              onChange={(e) => set({ refText: e.target.value })}
            />
            {chipsFor('refText')}
            <div className="muted">{t('f.ref.text.statsHint')}</div>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refLimit')}>{t('f.ref.limit')}</label>
            <input
              id={fieldId('refLimit')}
              type="number"
              min={1}
              max={50}
              value={p.refLimit ?? 5}
              onChange={(e) => set({ refLimit: Number(e.target.value) || 5 })}
            />
          </div>
        </Section>
      )}

      {block.type === 'referral_leaderboard' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('refText')}>{t('f.ref.text')}</label>
            <textarea
              id={fieldId('refText')}
              value={p.refText || ''}
              onFocus={trackField}
              onChange={(e) => set({ refText: e.target.value })}
            />
            {chipsFor('refText')}
            <div className="muted">{t('f.ref.text.leaderboardHint')}</div>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refSort')}>{t('f.ref.sort')}</label>
            <select
              id={fieldId('refSort')}
              value={p.refSort || 'count'}
              onChange={(e) => set({ refSort: e.target.value as BlockParams['refSort'] })}
            >
              <option value="count">{t('f.ref.sort.count')}</option>
              <option value="revenue">{t('f.ref.sort.revenue')}</option>
              <option value="activity_period">{t('f.ref.sort.activity_period')}</option>
            </select>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refPeriod')}>{t('f.ref.period')}</label>
            <select
              id={fieldId('refPeriod')}
              value={p.refPeriod || 'all_time'}
              onChange={(e) => set({ refPeriod: e.target.value as BlockParams['refPeriod'] })}
            >
              <option value="all_time">{t('f.ref.period.all_time')}</option>
              <option value="month">{t('f.ref.period.month')}</option>
              <option value="week">{t('f.ref.period.week')}</option>
              <option value="custom">{t('f.ref.period.custom')}</option>
            </select>
          </div>
          {p.refPeriod === 'custom' && (
            <>
              <div className="insp-field">
                <label htmlFor={fieldId('refPeriodFrom')}>{t('f.ref.periodFrom')}</label>
                <input
                  id={fieldId('refPeriodFrom')}
                  type="date"
                  value={(p.refPeriodFrom || '').slice(0, 10)}
                  onChange={(e) => set({ refPeriodFrom: e.target.value })}
                />
              </div>
              <div className="insp-field">
                <label htmlFor={fieldId('refPeriodTo')}>{t('f.ref.periodTo')}</label>
                <input
                  id={fieldId('refPeriodTo')}
                  type="date"
                  value={(p.refPeriodTo || '').slice(0, 10)}
                  onChange={(e) => set({ refPeriodTo: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="insp-field">
            <label htmlFor={fieldId('refLimit')}>{t('f.ref.limit')}</label>
            <input
              id={fieldId('refLimit')}
              type="number"
              min={1}
              max={100}
              value={p.refLimit ?? 10}
              onChange={(e) => set({ refLimit: Number(e.target.value) || 10 })}
            />
          </div>
        </Section>
      )}

      {block.type === 'referral_tournament' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('refTournamentName')}>{t('f.ref.tournamentName')}</label>
            <input
              id={fieldId('refTournamentName')}
              value={p.refTournamentName || ''}
              onChange={(e) => set({ refTournamentName: e.target.value })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refStartsAt')}>{t('f.ref.startsAt')}</label>
            <input
              id={fieldId('refStartsAt')}
              type="date"
              value={(p.refStartsAt || '').slice(0, 10)}
              onChange={(e) => set({ refStartsAt: e.target.value })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refEndsAt')}>{t('f.ref.endsAt')}</label>
            <input
              id={fieldId('refEndsAt')}
              type="date"
              value={(p.refEndsAt || '').slice(0, 10)}
              onChange={(e) => set({ refEndsAt: e.target.value })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refMetric')}>{t('f.ref.metric')}</label>
            <select
              id={fieldId('refMetric')}
              value={p.refMetric || 'count'}
              onChange={(e) => set({ refMetric: e.target.value as 'count' | 'revenue' })}
            >
              <option value="count">{t('f.ref.metric.count')}</option>
              <option value="revenue">{t('f.ref.metric.revenue')}</option>
            </select>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refPrizePool')}>{t('f.ref.prizePool')}</label>
            <input
              id={fieldId('refPrizePool')}
              value={p.refPrizePool || ''}
              onChange={(e) => set({ refPrizePool: e.target.value })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refPrizeSplit')}>{t('f.ref.prizeSplit')}</label>
            <input
              id={fieldId('refPrizeSplit')}
              value={p.refPrizeSplit || ''}
              onChange={(e) => set({ refPrizeSplit: e.target.value })}
              placeholder="50/30/20"
            />
            <div className="muted">{t('f.ref.prizeSplit.hint')}</div>
          </div>
        </Section>
      )}

      {block.type === 'referral_verification' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('refGate')}>{t('f.ref.gate')}</label>
            <select
              id={fieldId('refGate')}
              value={p.refGate || 'subscribed'}
              onChange={(e) => set({ refGate: e.target.value as BlockParams['refGate'] })}
            >
              <option value="subscribed">{t('f.ref.gate.subscribed')}</option>
              <option value="paid_once">{t('f.ref.gate.paid_once')}</option>
              <option value="paid_min_amount">{t('f.ref.gate.paid_min_amount')}</option>
              <option value="custom_goal">{t('f.ref.gate.custom_goal')}</option>
            </select>
          </div>
          {p.refGate === 'paid_min_amount' && (
            <div className="insp-field">
              <label htmlFor={fieldId('refMinAmount')}>{t('f.ref.minAmount')}</label>
              <input
                id={fieldId('refMinAmount')}
                type="number"
                min={1}
                value={p.refMinAmount ?? ''}
                onChange={(e) => set({ refMinAmount: Number(e.target.value) || 0 })}
              />
              <div className="muted">{t('f.ref.minAmount.hint')}</div>
            </div>
          )}
          {p.refGate === 'custom_goal' && (
            <div className="insp-field">
              <label htmlFor={fieldId('refGoalVar')}>{t('f.ref.goalVar')}</label>
              <input
                id={fieldId('refGoalVar')}
                value={p.refGoalVar || ''}
                onChange={(e) => set({ refGoalVar: e.target.value })}
              />
              <div className="muted">{t('f.ref.goalVar.hint')}</div>
            </div>
          )}
        </Section>
      )}

      {block.type === 'antifraud' && (
        <Section title="insp.section.behavior">
          <label className="checkline">
            <input
              type="checkbox"
              checked={p.refOnePerUser !== false}
              onChange={(e) => set({ refOnePerUser: e.target.checked })}
            />
            {t('f.ref.af.onePerUser')}
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={p.refBlockSelf !== false}
              onChange={(e) => set({ refBlockSelf: e.target.checked })}
            />
            {t('f.ref.af.blockSelf')}
          </label>
          <div className="insp-field">
            <label htmlFor={fieldId('refCooldownSec')}>{t('f.ref.af.cooldown')}</label>
            <input
              id={fieldId('refCooldownSec')}
              type="number"
              min={0}
              value={p.refCooldownSec ?? 0}
              onChange={(e) => set({ refCooldownSec: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('refMinAgeDays')}>{t('f.ref.af.minAge')}</label>
            <input
              id={fieldId('refMinAgeDays')}
              type="number"
              min={0}
              value={p.refMinAgeDays ?? 0}
              onChange={(e) => set({ refMinAgeDays: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          <div className="muted">{t('f.ref.af.hint')}</div>
        </Section>
      )}

      {block.type === 'http' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('url')}>{t('f.url')}</label>
            <input
              id={fieldId('url')}
              value={p.url || ''}
              onFocus={trackField}
              onChange={(e) => set({ url: e.target.value })}
              placeholder={t('f.url.placeholder')}
            />
            {issueBox('url')}
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('method')}>{t('f.method')}</label>
            <select
              id={fieldId('method')}
              value={p.method || 'GET'}
              onChange={(e) => set({ method: e.target.value as BlockParams['method'] })}
            >
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
            </select>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('headers')}>{t('f.headers')}</label>
            <input
              id={fieldId('headers')}
              value={p.headersJson || ''}
              onFocus={trackField}
              onChange={(e) => set({ headersJson: e.target.value })}
              placeholder={t('f.headers.placeholder')}
            />
          </div>
          {(p.method === 'POST' || p.method === 'PUT') && (
            <div className="insp-field">
              <label htmlFor={fieldId('body')}>{t('f.body')}</label>
              <textarea
                id={fieldId('body')}
                value={p.bodyJson || ''}
                onFocus={trackField}
                onChange={(e) => set({ bodyJson: e.target.value })}
                placeholder={t('f.body.placeholder')}
              />
            </div>
          )}
          <div className="insp-field">
            <label htmlFor={fieldId('jsonPath')}>{t('f.jsonPath')}</label>
            <input
              id={fieldId('jsonPath')}
              value={p.jsonPath || ''}
              onChange={(e) => set({ jsonPath: e.target.value })}
              placeholder={t('f.jsonPath.placeholder')}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('outVar')}>{t('f.outVar')}</label>
            <input
              id={fieldId('outVar')}
              value={p.outVar || ''}
              onChange={(e) => set({ outVar: e.target.value })}
              placeholder={t('f.outVar.placeholder')}
            />
          </div>
          {/* Повторы при сбое и постраничный обход (набор 2026-09): движок
              применяет их только здесь, дефолты сохраняют прежнее поведение. */}
          {numField('retries', 'f.http.retries', { min: 0, max: 5 })}
          {numField('backoffMs', 'f.http.backoffMs', { min: 0 })}
          {paginationEditor()}
        </Section>
      )}

      {block.type === 'ai' && (
        <Section title="insp.section.content">
          {textField('aiPrompt', 'f.ai.prompt', { textarea: true, placeholder: t('f.ai.promptPlaceholder') })}
          <div className="insp-field">
            <label htmlFor={fieldId('aiSystem')}>{t('f.ai.system')}</label>
            <textarea
              id={fieldId('aiSystem')}
              value={p.aiSystem || ''}
              onFocus={trackField}
              onChange={(e) => set({ aiSystem: e.target.value })}
              placeholder={t('f.ai.systemPlaceholder')}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('aiModel')}>{t('f.ai.model')}</label>
            <input
              id={fieldId('aiModel')}
              value={p.aiModel || ''}
              onChange={(e) => set({ aiModel: e.target.value })}
              placeholder={t('f.ai.modelPlaceholder')}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('aiVar')}>{t('f.ai.var')}</label>
            <input
              id={fieldId('aiVar')}
              value={p.aiVar || ''}
              onChange={(e) => set({ aiVar: e.target.value })}
              placeholder={t('f.ai.varPlaceholder')}
            />
          </div>
          <label className="checkline insp-check">
            <input type="checkbox" checked={!!p.aiReply} onChange={(e) => set({ aiReply: e.target.checked })} />
            <span>{t('f.ai.reply')}</span>
          </label>
        </Section>
      )}

      {block.type === 'ai' && (
        <Section title="insp.section.aiMemory">
          <div className="insp-field">
            <label htmlFor={fieldId('historyVar')}>{t('f.ai.historyVar')}</label>
            <input
              id={fieldId('historyVar')}
              value={p.historyVar || ''}
              onChange={(e) => set({ historyVar: e.target.value })}
              placeholder={t('f.ai.historyVarPlaceholder')}
            />
            <div className="muted">{t('f.ai.historyVar.hint')}</div>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('historyTurns')}>{t('f.ai.historyTurns')}</label>
            <input
              id={fieldId('historyTurns')}
              type="number"
              min={1}
              max={AI_HISTORY_TURNS_MAX}
              value={p.historyTurns ?? AI_HISTORY_TURNS_DEFAULT}
              onChange={(e) =>
                set({ historyTurns: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
            <div className="muted">{t('f.ai.historyTurns.hint', { max: AI_HISTORY_TURNS_MAX })}</div>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('persistHistoryTo')}>{t('f.ai.persistHistoryTo')}</label>
            <select
              id={fieldId('persistHistoryTo')}
              value={p.persistHistoryTo || ''}
              onChange={(e) => set({ persistHistoryTo: e.target.value })}
            >
              <option value="">—</option>
              {(collections || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="muted">{t('f.ai.persistHistoryTo.hint')}</div>
            {!(collections || []).length && <div className="muted">{t('f.data.collection.none')}</div>}
          </div>
        </Section>
      )}

      {block.type === 'action' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('actionKind')}>{t('f.action.kind')}</label>
            <select
              id={fieldId('actionKind')}
              value={p.actionKind || 'webhook'}
              onChange={(e) => set({ actionKind: e.target.value as BlockParams['actionKind'] })}
            >
              <option value="webhook">{t('f.action.webhook')}</option>
              <option value="notify">{t('f.action.notify')}</option>
              <option value="delay">{t('f.action.delay')}</option>
              <option value="broadcast">{t('f.action.broadcast')}</option>
            </select>
          </div>
          {p.actionKind === 'webhook' && (
            <>
              <div className="insp-field">
                <label htmlFor={fieldId('url')}>{t('f.url')}</label>
                <input
                  id={fieldId('url')}
                  value={p.url || ''}
                  onChange={(e) => set({ url: e.target.value })}
                />
              </div>
              <div className="insp-field">
                <label htmlFor={fieldId('method')}>{t('f.method')}</label>
                <select
                  id={fieldId('method')}
                  value={p.method || 'POST'}
                  onChange={(e) => set({ method: e.target.value as BlockParams['method'] })}
                >
                  <option>POST</option>
                  <option>GET</option>
                </select>
              </div>
            </>
          )}
          {p.actionKind === 'notify' && textField('notifyText', 'f.action.text')}
          {p.actionKind === 'delay' && (
            <div className="insp-field">
              <label htmlFor={fieldId('seconds')}>{t('f.action.seconds')}</label>
              <input
                id={fieldId('seconds')}
                type="number"
                value={p.seconds || 0}
                onChange={(e) => set({ seconds: Number(e.target.value) })}
              />
            </div>
          )}
          {p.actionKind === 'broadcast' &&
            textField('broadcastText', 'f.action.broadcastText', { textarea: true })}
        </Section>
      )}

      {block.type === 'media' && (
        <>
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('mediaType')}>{t('f.media.type')}</label>
            <select
              id={fieldId('mediaType')}
              value={p.mediaType || 'photo'}
              onChange={(e) => set({ mediaType: e.target.value as BlockParams['mediaType'] })}
            >
              <option value="photo">{t('f.media.photo')}</option>
              <option value="video">{t('f.media.video')}</option>
              <option value="document">{t('f.media.document')}</option>
            </select>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('mediaUrl')}>{t('f.media.url')}</label>
            <input
              id={fieldId('mediaUrl')}
              value={p.mediaUrl || ''}
              onChange={(e) => set({ mediaUrl: e.target.value })}
            />
            {issueBox('mediaUrl')}
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('fileId')}>{t('f.media.fileId')}</label>
            <input
              id={fieldId('fileId')}
              value={p.fileId || ''}
              onChange={(e) => set({ fileId: e.target.value })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('caption')}>{t('f.media.caption')}</label>
            <input
              id={fieldId('caption')}
              value={p.caption || ''}
              onFocus={trackField}
              onChange={(e) => set({ caption: e.target.value })}
            />
            {chipsFor('caption')}
          </div>
        </Section>
        {formattingSection()}
        </>
      )}

      {block.type === 'media_group' && (
        <>
        <Section title="insp.section.content">
          {(p.mediaItems || []).map((it, i) => (
            <div key={it.id ?? i} className="row media-item">
              <div className="row">
                <select
                  value={it.type || 'photo'}
                  onChange={(e) => {
                    const nb = [...(p.mediaItems || [])];
                    nb[i] = { ...nb[i], type: e.target.value as MediaItemDef['type'] };
                    set({ mediaItems: nb });
                  }}
                >
                  <option value="photo">{t('f.media.photo')}</option>
                  <option value="video">{t('f.media.video')}</option>
                </select>
                <button
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => set({ mediaItems: (p.mediaItems || []).filter((_, idx) => idx !== i) })}
                >
                  <X />
                </button>
              </div>
              <input
                placeholder={t('f.mg.item.url')}
                value={it.url || ''}
                onChange={(e) => {
                  const nb = [...(p.mediaItems || [])];
                  nb[i] = { ...nb[i], url: e.target.value };
                  set({ mediaItems: nb });
                }}
              />
              <input
                placeholder={t('f.mg.item.fileId')}
                value={it.fileId || ''}
                onChange={(e) => {
                  const nb = [...(p.mediaItems || [])];
                  nb[i] = { ...nb[i], fileId: e.target.value };
                  set({ mediaItems: nb });
                }}
              />
              <input
                placeholder={t('f.mg.item.caption')}
                value={it.caption || ''}
                onChange={(e) => {
                  const nb = [...(p.mediaItems || [])];
                  nb[i] = { ...nb[i], caption: e.target.value };
                  set({ mediaItems: nb });
                }}
              />
            </div>
          ))}
          <button
            onClick={() =>
              set({
                mediaItems: [
                  ...(p.mediaItems || []),
                  { id: newItemId(), type: 'photo', url: '', fileId: '', caption: '' } as MediaItemDef,
                ],
              })
            }
            disabled={(p.mediaItems || []).length >= MAX_MEDIA_ITEMS}
          >
            {t('f.mg.add')}
          </button>
          {chipsFor('mediaItems')}
          <div className="muted">{t('f.mg.hint')}</div>
        </Section>
        {formattingSection()}
        </>
      )}

      {block.type === 'invoice' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('invTitle')}>{t('f.inv.title')}</label>
            <input
              id={fieldId('invTitle')}
              value={p.invoice?.title || ''}
              onChange={(e) => set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), title: e.target.value } })}
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invDesc')}>{t('f.inv.description')}</label>
            <input
              id={fieldId('invDesc')}
              value={p.invoice?.description || ''}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), description: e.target.value } })
              }
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invAmount')}>{t('f.inv.amount')}</label>
            <input
              id={fieldId('invAmount')}
              type="number"
              value={p.invoice?.amount ?? ''}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), amount: e.target.value } })
              }
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invCurrency')}>{t('f.inv.currency')}</label>
            <input
              id={fieldId('invCurrency')}
              value={p.invoice?.currency || 'RUB'}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), currency: e.target.value } })
              }
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invLabel')}>{t('f.inv.label')}</label>
            <input
              id={fieldId('invLabel')}
              value={p.invoice?.label || ''}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), label: e.target.value } })
              }
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invPayload')}>{t('f.inv.payload')}</label>
            <input
              id={fieldId('invPayload')}
              value={p.invoice?.payload || ''}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), payload: e.target.value } })
              }
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invToken')}>{t('f.inv.providerToken')}</label>
            <input
              id={fieldId('invToken')}
              value={p.invoice?.providerToken || ''}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), providerToken: e.target.value } })
              }
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('invPhoto')}>{t('f.inv.photoUrl')}</label>
            <input
              id={fieldId('invPhoto')}
              value={p.invoice?.photoUrl || ''}
              onChange={(e) =>
                set({ invoice: { ...(p.invoice as NonNullable<BlockParams['invoice']>), photoUrl: e.target.value } })
              }
            />
          </div>
          <div className="muted">{t('f.inv.hint')}</div>
        </Section>
      )}

      {block.type === 'data' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('dataOp')}>{t('f.data.op')}</label>
            <select
              id={fieldId('dataOp')}
              value={p.dataOp || 'add'}
              onChange={(e) => set({ dataOp: e.target.value as BlockParams['dataOp'] })}
            >
              <option value="add">{t('f.data.op.add')}</option>
              <option value="find">{t('f.data.op.find')}</option>
              <option value="update">{t('f.data.op.update')}</option>
              <option value="remove">{t('f.data.op.remove')}</option>
            </select>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('collection')}>{t('f.data.collection')}</label>
            <select
              id={fieldId('collection')}
              value={p.collectionId || ''}
              onChange={(e) =>
                // Смена таблицы обнуляет поля: у новой таблицы другие колонки.
                set({ collectionId: e.target.value, dataFields: {}, dataWhere: {} })
              }
            >
              <option value="">—</option>
              {(collections || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {!(collections || []).length && <div className="muted">{t('f.data.collection.none')}</div>}

          {(p.dataOp === 'add' || p.dataOp === 'update' || !p.dataOp) && (
            <>
              <div className="muted">{t('f.data.fields')}</div>
              {dataMapEditor('dataFields')}
            </>
          )}
          {(p.dataOp === 'find' || p.dataOp === 'update' || p.dataOp === 'remove') && (
            <>
              <div className="muted">{t('f.data.where')}</div>
              {dataMapEditor('dataWhere')}
            </>
          )}

          <div className="insp-field">
            <label htmlFor={fieldId('outVar')}>{t('f.data.outVar')}</label>
            <input
              id={fieldId('outVar')}
              value={p.outVar || ''}
              onChange={(e) => set({ outVar: e.target.value })}
            />
          </div>
          {p.dataOp === 'find' && (
            <>
              <div className="muted">{t('f.data.outVar.hint')}</div>
              <div className="insp-field">
                <label htmlFor={fieldId('dataLimit')}>{t('f.data.limit')}</label>
                <input
                  id={fieldId('dataLimit')}
                  type="number"
                  min={1}
                  max={50}
                  value={p.dataLimit ?? 10}
                  onChange={(e) => set({ dataLimit: Number(e.target.value) || 10 })}
                />
              </div>
            </>
          )}
        </Section>
      )}

      {block.type === 'subscription' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('subAction')}>{t('f.sub.action')}</label>
            <select
              id={fieldId('subAction')}
              value={p.subAction || 'subscribe'}
              onChange={(e) => set({ subAction: e.target.value as BlockParams['subAction'] })}
            >
              <option value="subscribe">{t('f.sub.subscribe')}</option>
              <option value="unsubscribe">{t('f.sub.unsubscribe')}</option>
            </select>
          </div>
        </Section>
      )}

      {/* Тег: одна операция на выбор. Так же устроены «Данные» и «Подписка» —
          отдельные блоки на «поставить» и «снять» только загромождают палитру. */}
      {block.type === 'tag' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('tagOp')}>{t('f.tag.op')}</label>
            <select
              id={fieldId('tagOp')}
              value={p.tagOp || 'add'}
              onChange={(e) => set({ tagOp: e.target.value as BlockParams['tagOp'] })}
            >
              <option value="add">{t('f.tag.op.add')}</option>
              <option value="remove">{t('f.tag.op.remove')}</option>
              <option value="clear">{t('f.tag.op.clear')}</option>
              <option value="list">{t('f.tag.op.list')}</option>
            </select>
          </div>
          {(p.tagOp === 'add' || p.tagOp === 'remove' || !p.tagOp) && (
            <div className="insp-field">
              <label htmlFor={fieldId('tagName')}>{t('f.tag.name')}</label>
              <input
                id={fieldId('tagName')}
                value={p.tagName || ''}
                onFocus={trackField}
                onChange={(e) => set({ tagName: e.target.value })}
                placeholder={t('f.tag.namePlaceholder')}
              />
              {chipsFor('tagName')}
            </div>
          )}
          {p.tagOp === 'list' && (
            <div className="insp-field">
              <label htmlFor={fieldId('tagVar')}>{t('f.tag.outVar')}</label>
              <input
                id={fieldId('tagVar')}
                value={p.tagVar || ''}
                onChange={(e) => set({ tagVar: e.target.value })}
                placeholder="tags"
              />
              <div className="muted">{t('f.tag.outVar.hint')}</div>
            </div>
          )}
          <div className="muted">{t('f.tag.hint')}</div>
        </Section>
      )}

      {/* Цепочка: список сообщений по порядку. Редактор повторяет приём
          «Альбома», но без ограничения в 10 элементов и с типом «текст»:
          каждый элемент уходит отдельным сообщением. */}
      {block.type === 'chain' && (
        <>
        <Section title="insp.section.content">
          {(p.chainItems || []).map((it, i) => (
            <div key={it.id ?? i} className="row media-item">
              <div className="row">
                <select
                  value={it.kind || 'text'}
                  onChange={(e) => {
                    const nb = [...(p.chainItems || [])];
                    nb[i] = { ...nb[i], kind: e.target.value as ChainItemDef['kind'] };
                    set({ chainItems: nb });
                  }}
                >
                  <option value="text">{t('f.chain.kind.text')}</option>
                  <option value="photo">{t('f.media.photo')}</option>
                  <option value="video">{t('f.media.video')}</option>
                  <option value="audio">{t('f.chain.kind.audio')}</option>
                  <option value="document">{t('f.chain.kind.document')}</option>
                </select>
                <button
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => set({ chainItems: (p.chainItems || []).filter((_, idx) => idx !== i) })}
                >
                  <X />
                </button>
              </div>
              {it.kind === 'text' ? (
                <textarea
                  placeholder={t('f.chain.item.text')}
                  value={it.text || ''}
                  onFocus={trackField}
                  onChange={(e) => {
                    const nb = [...(p.chainItems || [])];
                    nb[i] = { ...nb[i], text: e.target.value };
                    set({ chainItems: nb });
                  }}
                />
              ) : (
                <>
                  <input
                    placeholder={t('f.mg.item.url')}
                    value={it.url || ''}
                    onChange={(e) => {
                      const nb = [...(p.chainItems || [])];
                      nb[i] = { ...nb[i], url: e.target.value };
                      set({ chainItems: nb });
                    }}
                  />
                  <input
                    placeholder={t('f.mg.item.fileId')}
                    value={it.fileId || ''}
                    onChange={(e) => {
                      const nb = [...(p.chainItems || [])];
                      nb[i] = { ...nb[i], fileId: e.target.value };
                      set({ chainItems: nb });
                    }}
                  />
                  <input
                    placeholder={t('f.mg.item.caption')}
                    value={it.caption || ''}
                    onFocus={trackField}
                    onChange={(e) => {
                      const nb = [...(p.chainItems || [])];
                      nb[i] = { ...nb[i], caption: e.target.value };
                      set({ chainItems: nb });
                    }}
                  />
                </>
              )}
            </div>
          ))}
          <button
            onClick={() =>
              set({
                chainItems: [...(p.chainItems || []), { id: newItemId(), kind: 'text', text: '' } as ChainItemDef],
              })
            }
          >
            {t('f.chain.add')}
          </button>
          {chipsFor('chainItems')}
          {/* Разницу с альбомом автор должен видеть в самой панели, а не
              выяснять её опытным путём. */}
          <div className="muted">{t('f.chain.hint')}</div>
        </Section>
        {formattingSection()}
        {deletesSection()}
        </>
      )}

      {/* ==================== набор 2026-09: новые блоки ==================== */}

      {block.type === 'poll' && (
        <Section title="insp.section.content">
          {textField('question', 'f.poll.question')}
          <div className="insp-field" id={fieldId('pollOptions')}>
            <div className="insp-list-head">
              <label>{t('f.poll.options')}</label>
              {/* Живой счётчик: лимит Telegram (10) виден до ошибки валидатора. */}
              <span className="insp-list-count">{t('f.poll.count', { n: (p.pollOptions || []).length })}</span>
            </div>
            {(p.pollOptions || []).map((o, i) => (
              <div key={o.id ?? i} className="insp-list-row">
                <input
                  value={o.text}
                  placeholder={t('f.poll.optionPlaceholder')}
                  aria-label={`${t('f.poll.options')} ${i + 1}`}
                  onFocus={trackField}
                  onChange={(e) => {
                    const next = [...(p.pollOptions || [])];
                    next[i] = { ...o, text: e.target.value };
                    set({ pollOptions: next });
                  }}
                />
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => set({ pollOptions: (p.pollOptions || []).filter((_, idx) => idx !== i) })}
                >
                  <X />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={(p.pollOptions || []).length >= MAX_POLL_OPTIONS}
              onClick={() =>
                set({ pollOptions: [...(p.pollOptions || []), { id: newItemId(), text: '' }] })
              }
            >
              {t('f.poll.add')}
            </button>
            {issueBox('pollOptions')}
          </div>
          {checkField('anonymous', 'f.poll.anonymous', p.anonymous !== false)}
          {checkField('multiple', 'f.poll.multiple', !!p.multiple)}
          {/* Викторина: выбираем правильный вариант по id. Пояснение — только
              с викториной: Telegram показывает его после ответа. */}
          <div className="insp-field">
            <label htmlFor={fieldId('correctOptionId')}>{t('f.poll.correct')}</label>
            <select
              id={fieldId('correctOptionId')}
              value={p.correctOptionId || ''}
              onChange={(e) => set({ correctOptionId: e.target.value })}
            >
              <option value="">{t('f.poll.correct.none')}</option>
              {/* Движок ищет правильный вариант по id: строки без id (старые
                  данные) выбрать нельзя — они не отобразились бы викториной. */}
              {(p.pollOptions || [])
                .map((o, i) => ({ o, i }))
                .filter(({ o }) => !!o.id)
                .map(({ o, i }) => (
                  <option key={o.id} value={o.id}>
                    {o.text || `${t('f.poll.optionPlaceholder')} ${i + 1}`}
                  </option>
                ))}
            </select>
            {issueBox('correctOptionId')}
          </div>
          {p.correctOptionId && textField('explanation', 'f.poll.explanation', { textarea: true })}
        </Section>
      )}

      {block.type === 'forward' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('forwardMode')}>{t('f.forward.mode')}</label>
            <select
              id={fieldId('forwardMode')}
              value={p.forwardMode || 'forward'}
              onChange={(e) => set({ forwardMode: e.target.value as BlockParams['forwardMode'] })}
            >
              <option value="forward">{t('f.forward.mode.forward')}</option>
              <option value="copy">{t('f.forward.mode.copy')}</option>
              <option value="text">{t('f.forward.mode.text')}</option>
            </select>
          </div>
          {p.forwardMode !== 'text' && (
            <>
              <div className="insp-field">
                <label htmlFor={fieldId('toChatId')}>{t('f.forward.toChatId')}</label>
                <input
                  id={fieldId('toChatId')}
                  value={p.toChatId || ''}
                  onFocus={trackField}
                  onChange={(e) => set({ toChatId: e.target.value })}
                  placeholder={t('f.forward.toChatIdPlaceholder')}
                />
                {chipsFor('toChatId')}
                {issueBox('toChatId')}
              </div>
              <div className="insp-field">
                <label htmlFor={fieldId('fromVar')}>{t('f.forward.fromVar')}</label>
                <input
                  id={fieldId('fromVar')}
                  value={p.fromVar || ''}
                  onChange={(e) => set({ fromVar: e.target.value })}
                />
              </div>
            </>
          )}
          {p.forwardMode === 'text' && textField('forwardText', 'f.forward.text', { textarea: true })}
        </Section>
      )}

      {block.type === 'chat_action' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('chatAction')}>{t('f.chatAction')}</label>
            <select
              id={fieldId('chatAction')}
              value={p.chatAction || 'typing'}
              onChange={(e) => set({ chatAction: e.target.value as BlockParams['chatAction'] })}
            >
              <option value="typing">{t('f.chatAction.typing')}</option>
              <option value="upload_photo">{t('f.chatAction.upload_photo')}</option>
              <option value="upload_document">{t('f.chatAction.upload_document')}</option>
              <option value="find_location">{t('f.chatAction.find_location')}</option>
              <option value="record_voice">{t('f.chatAction.record_voice')}</option>
            </select>
            {issueBox('chatAction')}
          </div>
        </Section>
      )}

      {block.type === 'wait' && (
        <Section title="insp.section.behavior">
          {numField('seconds', 'f.wait.seconds', { min: 1 })}
          {textField('prompt', 'f.wait.prompt', { textarea: true })}
          {textField('reminderText', 'f.wait.reminder')}
          {numField('maxWaitMinutes', 'f.wait.maxMinutes', { min: 0 })}
          <div className="callout">{t('f.wait.timeoutCallout')}</div>
        </Section>
      )}

      {/* --- набор 2026-10: правка/удаление сообщений --- */}
      {block.type === 'edit_message' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('msgRefVar')}>{t('f.editm.ref')}</label>
            <input
              id={fieldId('msgRefVar')}
              value={p.msgRefVar || ''}
              onFocus={trackField}
              onChange={(e) => set({ msgRefVar: e.target.value })}
              placeholder="{{__bot_msg}}"
            />
            {chipsFor('msgRefVar')}
            {issueBox('msgRefVar')}
            <div className="callout">{t('f.editm.ref.hint')}</div>
          </div>
          {textField('editText', 'f.editm.text', { textarea: true })}
          {/* editButtons (новая клавиатура правки) в этой итерации не
              редактируется: правка текста — основной сценарий, клавиатура
              добавится следующим шагом без смены контракта. */}
        </Section>
      )}

      {block.type === 'delete_message' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('msgRefVar')}>{t('f.delm.ref')}</label>
            <input
              id={fieldId('msgRefVar')}
              value={p.msgRefVar || ''}
              onFocus={trackField}
              onChange={(e) => set({ msgRefVar: e.target.value })}
              placeholder="{{__bot_msg}}"
            />
            {chipsFor('msgRefVar')}
            {issueBox('msgRefVar')}
            <div className="callout">{t('f.editm.ref.hint')}</div>
          </div>
        </Section>
      )}

      {/* --- набор 2026-10: викторина (переиспользует поля опроса) --- */}
      {block.type === 'quiz' && (
        <Section title="insp.section.content">
          {textField('question', 'f.poll.question')}
          <div className="insp-field" id={fieldId('pollOptions')}>
            <div className="insp-list-head">
              <label>{t('f.poll.options')}</label>
              <span className="insp-list-count">{t('f.poll.count', { n: (p.pollOptions || []).length })}</span>
            </div>
            {(p.pollOptions || []).map((o, i) => (
              <div key={o.id ?? i} className="insp-list-row">
                <input
                  value={o.text}
                  placeholder={t('f.poll.optionPlaceholder')}
                  aria-label={`${t('f.poll.options')} ${i + 1}`}
                  onFocus={trackField}
                  onChange={(e) => {
                    const next = [...(p.pollOptions || [])];
                    next[i] = { ...o, text: e.target.value };
                    set({ pollOptions: next });
                  }}
                />
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => set({ pollOptions: (p.pollOptions || []).filter((_, idx) => idx !== i) })}
                >
                  <X />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={(p.pollOptions || []).length >= MAX_POLL_OPTIONS}
              onClick={() => set({ pollOptions: [...(p.pollOptions || []), { id: newItemId(), text: '' }] })}
            >
              {t('f.poll.add')}
            </button>
            {issueBox('pollOptions')}
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('correctOptionId')}>{t('f.poll.correct')}</label>
            <select
              id={fieldId('correctOptionId')}
              value={p.correctOptionId || ''}
              onChange={(e) => set({ correctOptionId: e.target.value })}
            >
              {(p.pollOptions || [])
                .map((o, i) => ({ o, i }))
                .filter(({ o }) => !!o.id)
                .map(({ o, i }) => (
                  <option key={o.id} value={o.id}>
                    {o.text || `${t('f.poll.optionPlaceholder')} ${i + 1}`}
                  </option>
                ))}
            </select>
            {issueBox('correctOptionId')}
          </div>
          {textField('explanation', 'f.poll.explanation', { textarea: true })}
          {textField('quizFailText', 'f.quiz.failtext', { textarea: true })}
        </Section>
      )}

      {/* --- набор 2026-10: язык пользователя --- */}
      {block.type === 'language' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('langCodes')}>{t('f.lang.codes')}</label>
            <input
              id={fieldId('langCodes')}
              value={(p.langCodes || []).join(', ')}
              onFocus={trackField}
              onChange={(e) => {
                const codes = e.target.value.split(',').map((c) => c.trim()).filter(Boolean);
                // Синхронно обновляем ветки. Переименование кода на той же
                // позиции переносит связь со старой ветки на новую (иначе
                // переименованный код теряет свою стрелку, а порт осиротевает).
                const oldCodes = p.langCodes || [];
                const cur = block.branches || {};
                const nextBranches: Record<string, string> = {};
                codes.forEach((c, i) => {
                  const old = oldCodes[i];
                  if (old && old !== c && cur[old] !== undefined) nextBranches[c] = cur[old];
                  else nextBranches[c] = cur[c] ?? '';
                });
                nextBranches['fallback'] = cur['fallback'] ?? '';
                onChange({ ...p, langCodes: codes }, nextBranches);
              }}
              placeholder="ru, en"
            />
            <div className="callout">{t('f.lang.codes.hint')}</div>
          </div>
        </Section>
      )}

      {/* --- набор 2026-10: дедлайн --- */}
      {block.type === 'timer_deadline' && (
        <Section title="insp.section.behavior">
          {textField('deadlineAt', 'f.td.at', { placeholder: '2026-12-31 18:00' })}
          <div className="insp-field">
            <label htmlFor={fieldId('deadlineVar')}>{t('f.td.var')}</label>
            <input
              id={fieldId('deadlineVar')}
              value={p.deadlineVar || ''}
              onFocus={trackField}
              onChange={(e) => set({ deadlineVar: e.target.value })}
            />
            {chipsFor('deadlineVar')}
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('cancelVar')}>{t('f.td.cancel')}</label>
            <input
              id={fieldId('cancelVar')}
              value={p.cancelVar || ''}
              onFocus={trackField}
              onChange={(e) => set({ cancelVar: e.target.value })}
              placeholder="paid"
            />
            {chipsFor('cancelVar')}
            <div className="callout">{t('f.td.cancel.hint')}</div>
          </div>
          {textField('deadlineText', 'f.td.text', { textarea: true })}
        </Section>
      )}

      {/* --- набор 2026-10: ИИ-классификатор --- */}
      {block.type === 'ai_classify' && (
        <Section title="insp.section.content">
          {textField('classifyPrompt', 'f.aic.prompt', { textarea: true })}
          <div className="insp-field">
            <label htmlFor={fieldId('classifyInput')}>{t('f.aic.input')}</label>
            <input
              id={fieldId('classifyInput')}
              value={p.classifyInput || ''}
              onFocus={trackField}
              onChange={(e) => set({ classifyInput: e.target.value })}
            />
            {chipsFor('classifyInput')}
            <div className="callout">{t('f.aic.input.hint')}</div>
          </div>
          <div className="insp-field" id={fieldId('classifyLabels')}>
            <div className="insp-list-head">
              <label>{t('f.aic.labels')}</label>
              <span className="insp-list-count">{(p.classifyLabels || []).length}</span>
            </div>
            {(p.classifyLabels || []).map((l, i) => (
              <div key={i} className="insp-list-row">
                <input
                  value={l}
                  aria-label={`${t('f.aic.labels')} ${i + 1}`}
                  onFocus={trackField}
                  onChange={(e) => {
                    const labels = [...(p.classifyLabels || [])];
                    labels[i] = e.target.value;
                    // Метки = ветки: пересобираем branches, перенося связь со
                    // старой метки на новую при переименовании (по позиции).
                    const fb = String(p.classifyFallbackLabel || 'other').trim() || 'other';
                    const cur = block.branches || {};
                    const nextBranches: Record<string, string> = {};
                    labels.forEach((m, idx) => {
                      const key = String(m ?? '').trim();
                      if (!key) return;
                      const oldKey = String((p.classifyLabels || [])[idx] ?? '').trim();
                      if (oldKey && oldKey !== key && cur[oldKey] !== undefined) nextBranches[key] = cur[oldKey];
                      else nextBranches[key] = cur[key] ?? '';
                    });
                    nextBranches[fb] = cur[fb] ?? '';
                    onChange({ ...p, classifyLabels: labels }, nextBranches);
                  }}
                />
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => {
                    const labels = (p.classifyLabels || []).filter((_, idx) => idx !== i);
                    const fb = String(p.classifyFallbackLabel || 'other').trim() || 'other';
                    const cur = block.branches || {};
                    const nextBranches: Record<string, string> = {};
                    for (const m of labels.map((x) => String(x ?? '').trim()).filter(Boolean)) nextBranches[m] = cur[m] ?? '';
                    nextBranches[fb] = cur[fb] ?? '';
                    onChange({ ...p, classifyLabels: labels }, nextBranches);
                  }}
                >
                  <X />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const labels = [...(p.classifyLabels || []), ''];
                onChange({ ...p, classifyLabels: labels });
              }}
            >
              {t('f.poll.add')}
            </button>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('classifyFallbackLabel')}>{t('f.aic.fb')}</label>
            <input
              id={fieldId('classifyFallbackLabel')}
              value={p.classifyFallbackLabel || 'other'}
              onFocus={trackField}
              onChange={(e) => {
                const oldFb = String(p.classifyFallbackLabel || 'other').trim() || 'other';
                const newFb = e.target.value.trim() || 'other';
                const cur = block.branches || {};
                const nextBranches: Record<string, string> = { ...cur };
                // Переносим связь со старой резервной ветки на новую.
                if (oldFb !== newFb && cur[oldFb] !== undefined) {
                  nextBranches[newFb] = cur[oldFb];
                  delete nextBranches[oldFb];
                }
                onChange({ ...p, classifyFallbackLabel: e.target.value }, nextBranches);
              }}
            />
            {issueBox('classifyFallbackLabel')}
          </div>
          {textField('classifyOutVar', 'f.aic.out')}
        </Section>
      )}

      {/* --- набор 2026-10: входящий вебхук --- */}
      {block.type === 'webhook_in' && (
        <Section title="insp.section.behavior">
          <div className="insp-field" id={fieldId('webhookFields')}>
            <div className="insp-list-head">
              <label>{t('f.whin.fields')}</label>
              <span className="insp-list-count">{(p.webhookFields || []).length}</span>
            </div>
            {(p.webhookFields || []).map((f, i) => (
              <div key={i} className="insp-list-row">
                <input
                  value={f}
                  aria-label={`${t('f.whin.fields')} ${i + 1}`}
                  onFocus={trackField}
                  onChange={(e) => {
                    const fields = [...(p.webhookFields || [])];
                    fields[i] = e.target.value;
                    set({ webhookFields: fields });
                  }}
                />
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => set({ webhookFields: (p.webhookFields || []).filter((_, idx) => idx !== i) })}
                >
                  <X />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => set({ webhookFields: [...(p.webhookFields || []), ''] })}>
              {t('f.poll.add')}
            </button>
            <div className="callout">{t('f.whin.fields.hint')}</div>
          </div>
          <div className="callout">{t('f.whin.url.hint')}</div>
        </Section>
      )}

      {/* --- набор 2026-10: геопозиция --- */}
      {block.type === 'location' && (
        <Section title="insp.section.content">
          {textField('locationPrompt', 'f.loc.prompt', { textarea: true })}
          {textField('locationButtonLabel', 'f.loc.btn')}
        </Section>
      )}

      {block.type === 'channel_check' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('channelId')}>{t('f.channel.id')}</label>
            <input
              id={fieldId('channelId')}
              value={p.channelId || ''}
              onFocus={trackField}
              onChange={(e) => set({ channelId: e.target.value })}
              placeholder={t('f.channel.idPlaceholder')}
            />
            {chipsFor('channelId')}
            {issueBox('channelId')}
          </div>
          {checkField('requireMembership', 'f.channel.requireMembership', p.requireMembership !== false)}
          {numField('cacheMinutes', 'f.channel.cacheMinutes', { min: 0 })}
          <div className="callout">{t('f.channel.adminCallout')}</div>
        </Section>
      )}

      {block.type === 'segment_broadcast' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('segmentTag')}>{t('f.segment.tag')}</label>
            <input
              id={fieldId('segmentTag')}
              value={p.segmentTag || ''}
              onFocus={trackField}
              onChange={(e) => set({ segmentTag: e.target.value })}
              placeholder={t('f.tag.namePlaceholder')}
            />
            {chipsFor('segmentTag')}
            {issueBox('segmentTag')}
          </div>
          <div className="insp-field" id={fieldId('segmentWhere')}>
            <label>{t('f.segment.where')}</label>
            {conditionListEditor('segmentWhere', 3)}
            <div className="muted">{t('f.segment.where.hint')}</div>
          </div>
          {textField('segmentText', 'f.segment.text', { textarea: true })}
          {parseModeField()}
          <div className="insp-field">
            <label htmlFor={fieldId('segmentMediaUrl')}>{t('f.segment.mediaUrl')}</label>
            <input
              id={fieldId('segmentMediaUrl')}
              value={p.segmentMediaUrl || ''}
              onChange={(e) => set({ segmentMediaUrl: e.target.value })}
            />
          </div>
          {numField('chunkSize', 'f.segment.chunkSize', { min: 1 })}
          {numField('delayMs', 'f.segment.delayMs', { min: 0 })}
          {numField('dailyCap', 'f.segment.dailyCap', { min: 0 })}
        </Section>
      )}

      {block.type === 'user_stats' && (
        <Section title="insp.section.content">
          <div className="insp-field">
            <label htmlFor={fieldId('outPrefix')}>{t('f.userstats.prefix')}</label>
            <input
              id={fieldId('outPrefix')}
              value={p.outPrefix || ''}
              onChange={(e) => set({ outPrefix: e.target.value })}
              placeholder="user"
            />
          </div>
          {textField('template', 'f.userstats.template', { textarea: true })}
          <div className="muted">{t('f.userstats.hint')}</div>
        </Section>
      )}

      {block.type === 'payment_link' && (
        <Section title="insp.section.content">
          {connectionField()}
          {textField('amount', 'f.pay.amount')}
          <div className="muted">{t('f.pay.amountHint')}</div>
          <div className="insp-field">
            <label htmlFor={fieldId('currency')}>{t('f.pay.currency')}</label>
            <input
              id={fieldId('currency')}
              value={p.currency || 'RUB'}
              onChange={(e) => set({ currency: e.target.value })}
            />
          </div>
          {textField('description', 'f.pay.description')}
          <div className="insp-field">
            <label htmlFor={fieldId('orderIdVar')}>{t('f.pay.orderIdVar')}</label>
            <input
              id={fieldId('orderIdVar')}
              value={p.orderIdVar || ''}
              onChange={(e) => set({ orderIdVar: e.target.value })}
              placeholder="pay.order"
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('linkVar')}>{t('f.pay.linkVar')}</label>
            <input
              id={fieldId('linkVar')}
              value={p.linkVar || ''}
              onChange={(e) => set({ linkVar: e.target.value })}
              placeholder="pay.link"
            />
          </div>
          {/* Чекбокса «отправить ссылку» нет: движок payment_link не шлёт
              сообщение (кроме telegram-провайдера, где счёт уходит сам).
              Ссылку отправляет следующий блок «Сообщение» с {{pay.link}}. */}
          <div className="muted">{t('f.pay.linkHint')}</div>
          {platform === 'vk' && <div className="muted">{t('f.pay.vkHint')}</div>}
          {gotoPicker('successNext', 'f.pay.successNext')}
        </Section>
      )}

      {block.type === 'payment_check' && (
        <Section title="insp.section.content">
          {connectionField()}
          {checkField(
            'autoOrderId',
            'f.pay.autoOrderId',
            !!p.autoOrderId,
            () => set({ autoOrderId: !p.autoOrderId, ...(p.autoOrderId ? {} : { orderIdVar: undefined }) })
          )}
          {!p.autoOrderId && (
            <div className="insp-field">
              <label htmlFor={fieldId('orderIdVar')}>{t('f.pay.orderIdVar')}</label>
              <input
                id={fieldId('orderIdVar')}
                value={p.orderIdVar || ''}
                onChange={(e) => set({ orderIdVar: e.target.value })}
                placeholder="pay.order"
              />
              {issueBox('orderIdVar')}
            </div>
          )}
        </Section>
      )}

      {block.type === 'foreach' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('listVar')}>{t('f.foreach.listVar')}</label>
            <input
              id={fieldId('listVar')}
              value={p.listVar || ''}
              onFocus={trackField}
              onChange={(e) => set({ listVar: e.target.value })}
            />
            {chipsFor('listVar')}
            {issueBox('listVar')}
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('itemVar')}>{t('f.foreach.itemVar')}</label>
            <input
              id={fieldId('itemVar')}
              value={p.itemVar || ''}
              onChange={(e) => set({ itemVar: e.target.value })}
              placeholder="item"
            />
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('indexVar')}>{t('f.foreach.indexVar')}</label>
            <input
              id={fieldId('indexVar')}
              value={p.indexVar || ''}
              onChange={(e) => set({ indexVar: e.target.value })}
              placeholder="i"
            />
          </div>
          {numField('maxIterations', 'f.foreach.maxIterations', { min: 1, max: 500 })}
          {/* Тело цикла обязано возвращаться в foreach — стрелкой «итерация →
              тело → возврат». Кнопка создаёт goto на этот блок: интеграция
              холста решает, как именно (onCreateGoto — опциональный проп). */}
          {onCreateGoto && (
            <button type="button" onClick={() => onCreateGoto(block.id)}>
              {t('f.foreach.loopBack')}
            </button>
          )}
        </Section>
      )}

      {block.type === 'random_text' && (
        <Section title="insp.section.content">
          <div className="insp-field" id={fieldId('variants')}>
            <label>{t('f.rt.variants')}</label>
            {(p.variants || []).map((v, i) => (
              <div key={v.id ?? i} className="insp-list-row">
                <input
                  value={v.text}
                  placeholder={t('f.rt.textPlaceholder')}
                  aria-label={`${t('f.rt.variants')} ${i + 1}`}
                  onFocus={trackField}
                  onChange={(e) => {
                    const next = [...(p.variants || [])];
                    next[i] = { ...v, text: e.target.value };
                    set({ variants: next });
                  }}
                />
                <input
                  type="number"
                  min={1}
                  value={v.weight ?? 1}
                  aria-label={t('f.rt.weight')}
                  title={t('f.rt.weight')}
                  onChange={(e) => {
                    const next = [...(p.variants || [])];
                    next[i] = { ...v, weight: Math.max(1, Number(e.target.value) || 1) };
                    set({ variants: next });
                  }}
                />
                <button
                  type="button"
                  className="ghost icon-btn"
                  title={t('insp.remove')}
                  aria-label={t('insp.remove')}
                  onClick={() => set({ variants: (p.variants || []).filter((_, idx) => idx !== i) })}
                >
                  <X />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ variants: [...(p.variants || []), { id: newItemId(), text: '', weight: 1 }] })}
            >
              {t('f.rt.add')}
            </button>
            {chipsFor('variants')}
            {issueBox('variants')}
          </div>
          {checkField('send', 'f.rt.send', p.send !== false)}
          {p.send === false && (
            <div className="insp-field">
              <label htmlFor={fieldId('outVar')}>{t('f.rt.outVar')}</label>
              <input
                id={fieldId('outVar')}
                value={p.outVar || ''}
                onChange={(e) => set({ outVar: e.target.value })}
              />
              {issueBox('outVar')}
            </div>
          )}
        </Section>
      )}

      {block.type === 'assert' && (
        <Section title="insp.section.branching">
          {conditionEditor()}
          {textField('failMessage', 'f.assert.failMessage', { textarea: true })}
        </Section>
      )}

      {block.type === 'counter' && (
        <Section title="insp.section.data">
          <div className="insp-field">
            <label htmlFor={fieldId('counterName')}>{t('f.counter.name')}</label>
            <input
              id={fieldId('counterName')}
              value={p.counterName || ''}
              onChange={(e) => set({ counterName: e.target.value })}
            />
            {issueBox('counterName')}
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('counterScope')}>{t('f.counter.scope')}</label>
            <select
              id={fieldId('counterScope')}
              value={p.counterScope || 'user'}
              onChange={(e) => set({ counterScope: e.target.value as BlockParams['counterScope'] })}
            >
              <option value="user">{t('f.counter.scope.user')}</option>
              <option value="bot">{t('f.counter.scope.bot')}</option>
            </select>
          </div>
          <div className="insp-field">
            <label htmlFor={fieldId('counterOp')}>{t('f.counter.op')}</label>
            <select
              id={fieldId('counterOp')}
              value={p.counterOp || 'inc'}
              onChange={(e) => set({ counterOp: e.target.value as BlockParams['counterOp'] })}
            >
              <option value="inc">{t('f.counter.op.inc')}</option>
              <option value="dec">{t('f.counter.op.dec')}</option>
              <option value="reset">{t('f.counter.op.reset')}</option>
              <option value="get">{t('f.counter.op.get')}</option>
            </select>
          </div>
          {(p.counterOp === 'inc' || p.counterOp === 'dec' || !p.counterOp) &&
            numField('amount', 'f.counter.amount', { min: 1 })}
          {numField('counterMax', 'f.counter.max', { min: 1 })}
          <div className="muted">{t('f.counter.max.hint')}</div>
          <div className="insp-field">
            <label htmlFor={fieldId('outVar')}>{t('f.counter.outVar')}</label>
            <input
              id={fieldId('outVar')}
              value={p.outVar || ''}
              onChange={(e) => set({ outVar: e.target.value })}
              placeholder="counter"
            />
          </div>
        </Section>
      )}

      {block.type === 'web_app' && (
        <>
          <Section title="insp.section.content">
            {textField('text', 'f.webapp.text', { textarea: true })}
            {textField('button', 'f.webapp.button')}
            <div className="insp-field">
              <label htmlFor={fieldId('url')}>{t('f.webapp.url')}</label>
              <input
                id={fieldId('url')}
                value={p.url || ''}
                onFocus={trackField}
                onChange={(e) => set({ url: e.target.value })}
                placeholder={t('f.webapp.urlPlaceholder')}
              />
              {issueBox('url')}
            </div>
            <div className="muted">{t('f.webapp.urlHint')}</div>
          </Section>
          {formattingSection()}
        </>
      )}

      {block.type === 'schedule' && (
        <Section title="insp.section.behavior">
          <div className="insp-field">
            <label htmlFor={fieldId('scheduleKind')}>{t('f.sched.kind')}</label>
            <select
              id={fieldId('scheduleKind')}
              value={p.scheduleKind || 'daily'}
              onChange={(e) => set({ scheduleKind: e.target.value as BlockParams['scheduleKind'] })}
            >
              <option value="daily">{t('f.sched.kind.daily')}</option>
              <option value="weekly">{t('f.sched.kind.weekly')}</option>
              <option value="interval">{t('f.sched.kind.interval')}</option>
              <option value="cron">{t('f.sched.kind.cron')}</option>
            </select>
          </div>

          {(p.scheduleKind === 'daily' || p.scheduleKind === 'weekly' || !p.scheduleKind) &&
            textField('atTime', 'f.sched.atTime', { placeholder: '10:00' })}

          {p.scheduleKind === 'weekly' && (
            <div className="insp-field" id={fieldId('weekdays')}>
              <label>{t('f.sched.weekdays')}</label>
              <div className="row">
                {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => {
                  const list = p.weekdays || [];
                  const checked = list.includes(d);
                  return (
                    <label className="checkline insp-check" key={d}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          set({ weekdays: checked ? list.filter((x) => x !== d) : [...list, d] })
                        }
                      />
                      <span>{t(`f.sched.day.${d}` as TKey)}</span>
                    </label>
                  );
                })}
              </div>
              {issueBox('weekdays')}
            </div>
          )}

          {p.scheduleKind === 'interval' && numField('everyMinutes', 'f.sched.everyMinutes', { min: 1 })}

          {p.scheduleKind === 'cron' && (
            <div className="insp-field">
              <label htmlFor={fieldId('cronExpr')}>{t('f.sched.cronExpr')}</label>
              <input
                id={fieldId('cronExpr')}
                className="mono"
                value={p.cronExpr || ''}
                onChange={(e) => set({ cronExpr: e.target.value })}
                placeholder="*/5 * * * *"
              />
              {/* Живая проверка выражения: тот же парсер, что и у валидатора. */}
              {p.cronExpr
                ? parseCronExpr(String(p.cronExpr))
                  ? <div className="muted">{t('f.sched.cron.ok')}</div>
                  : <div className="callout warn">{t('f.sched.cron.bad')}</div>
                : <div className="muted">{t('f.sched.cron.hint')}</div>}
              {issueBox('cronExpr')}
            </div>
          )}

          <div className="insp-field">
            <label htmlFor={fieldId('scheduleAudience')}>{t('f.sched.audience')}</label>
            <select
              id={fieldId('scheduleAudience')}
              value={p.scheduleAudience || 'all'}
              onChange={(e) => set({ scheduleAudience: e.target.value as BlockParams['scheduleAudience'] })}
            >
              <option value="all">{t('f.sched.aud.all')}</option>
              <option value="tag">{t('f.sched.aud.tag')}</option>
              <option value="single">{t('f.sched.aud.single')}</option>
            </select>
          </div>
          {p.scheduleAudience === 'tag' &&
            textField('audienceTag', 'f.sched.audienceTag', { placeholder: t('f.tag.namePlaceholder') })}

          <div className="insp-field">
            <label htmlFor={fieldId('timezone')}>{t('f.sched.timezone')}</label>
            <input
              id={fieldId('timezone')}
              value={p.timezone || DEFAULT_SCHEDULE_TIMEZONE}
              onChange={(e) => set({ timezone: e.target.value })}
              placeholder={DEFAULT_SCHEDULE_TIMEZONE}
            />
          </div>
          <div className="muted">{t('f.sched.limit', { max: MAX_SCHEDULES_PER_BOT })}</div>
        </Section>
      )}

      {block.type === 'note' && (
        <textarea
          value={p.note || ''}
          onChange={(e) => set({ note: e.target.value })}
          placeholder={t('f.note.placeholder')}
        />
      )}

      {block.type === 'subflow' && (
        <SubflowSection
          block={block}
          p={p}
          set={set}
          fieldId={fieldId}
          issueBox={issueBox}
        />
      )}

      {block.type === 'subflow_return' && (
        <Section title="insp.section.content">
          <div className="muted">{t('f.sfret.hint')}</div>
          {/* Явные выходы: имя выхода фрагмента -> выражение в его переменных. */}
          {Object.entries(p.outputs ?? {}).map(([name, expr]) => (
            <div className="insp-field" key={name}>
              <label>{t('f.sfret.output', { name })}</label>
              <input
                value={String(expr ?? '')}
                onChange={(e) => set({ outputs: { ...(p.outputs ?? {}), [name]: e.target.value } })}
                placeholder={`{{${name}}}`}
              />
            </div>
          ))}
        </Section>
      )}

      {block.type === 'goto' && gotoPicker()}

      {/* Профи получает служебное, что новичку только мешает: id и сырые
          параметры блока. Это те же данные, что уходят в сценарий. */}
      {skill_level === 'high' && (
        <details className="insp-advanced">
          <summary>{t('pro.advanced')}</summary>
          <div className="insp-advanced-row">
            <span className="muted">{t('pro.blockId')}</span>
            <span className="mono">{block.id}</span>
          </div>
          <div className="insp-advanced-row">
            <span className="muted">{t('pro.rawParams')}</span>
            <pre className="mono insp-raw">{JSON.stringify(p, null, 2)}</pre>
          </div>
        </details>
      )}

      {/* Служебное — одной приглушённой строкой в самом низу. Раньше «сделать
          точкой входа», чекбокс включения, id и подсказка стояли сверху и
          оттесняли поля блока. */}
      <div className="insp-footer">
        {!isStart && block.type !== 'end' && onMakeStart && (
          <button className="link" onClick={onMakeStart}>
            {t('insp.footer.makeStart')}
          </button>
        )}
        {block.type !== 'end' && (
          <button className="link" onClick={() => set({ disabled: !p.disabled })}>
            {p.disabled ? t('insp.footer.enable') : t('insp.footer.disable')}
          </button>
        )}
        <button className="link danger-link" onClick={onDelete}>
          {t('insp.footer.delete')}
        </button>
      </div>
    </div>
  );
}

const COND_OPS: ConditionOp[] = ['==', '!=', '>', '<', 'contains'];

// ---------------- подсценарии: секция блока вызова ----------------

// Библиотека фрагментов грузится самой секцией (по образцу платёжных
// подключений): выбор фрагмента, привязка входов/выходов, alias, ревизия и
// область переменных. Предупреждение про scope 'shared' — обязательный
// элемент контракта: общий фрагмент МОЖЕТ перезаписать переменные бота.
function SubflowSection({
  block,
  p,
  set,
  fieldId,
  issueBox,
}: {
  block: Block;
  p: BlockParams;
  set: (patch: Partial<BlockParams>) => void;
  fieldId: (name: string) => string;
  issueBox: (fieldKey: string) => ReactNode;
}) {
  const t = useT();
  const [library, setLibrary] = useState<
    { id: string; name: string; revision: number; description: string; inputs: { name: string; description: string; required: boolean }[]; outputs: { name: string; description: string; required: boolean }[] }[] | null
  >(null);
  useEffect(() => {
    let alive = true;
    api.subflows
      .list()
      .then((r) => {
        if (alive) setLibrary(r.subflows ?? []);
      })
      .catch(() => {
        if (alive) setLibrary([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  const selected = (library ?? []).find((s) => s.id === p.subflowId) ?? null;
  const boundInputs = p.inputs ?? {};
  const boundOutputs = p.outputs ?? {};

  return (
    <>
      <Section title="insp.section.content">
        <div className="insp-field">
          <label htmlFor={fieldId('subflowId')}>{t('f.sf.fragment')}</label>
          <select
            id={fieldId('subflowId')}
            value={p.subflowId || ''}
            onChange={(e) => {
              const id = e.target.value;
              const entry = (library ?? []).find((s) => s.id === id);
              // Смена фрагмента сбрасывает привязки входов: у другого
              // фрагмента другие имена, старые значения только мешали бы.
              set({ subflowId: id || undefined, subflowRevision: undefined, inputs: {}, alias: p.alias || (entry?.name ?? '').toLowerCase().replace(/[^\w-]+/g, '_').slice(0, 16) || undefined });
            }}
          >
            <option value="">{library === null ? t('f.sf.loading') : t('f.sf.none')}</option>
            {(library ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (rev {s.revision})
              </option>
            ))}
          </select>
          {issueBox('subflowId')}
          {library !== null && !library.length && (
            <div className="muted">{t('f.sf.empty')}</div>
          )}
          {selected?.description && <div className="muted">{selected.description}</div>}
        </div>

        {selected && (
          <>
            <div className="insp-field">
              <label htmlFor={fieldId('alias')}>{t('f.sf.alias')}</label>
              <input
                id={fieldId('alias')}
                value={p.alias || ''}
                onChange={(e) => set({ alias: e.target.value.replace(/[^\w-]/g, '_').slice(0, 24) })}
                placeholder="menu"
                className="mono"
              />
              <div className="muted">{t('f.sf.alias.hint')}</div>
            </div>

            {/* Ревизия: «последняя» по умолчанию; закрепление делает публикацию
                детерминированной. Обновление — всегда явное действие. */}
            <div className="insp-field">
              <label htmlFor={fieldId('subflowRevision')}>{t('f.sf.revision')}</label>
              <select
                id={fieldId('subflowRevision')}
                value={p.subflowRevision != null ? String(p.subflowRevision) : ''}
                onChange={(e) =>
                  set({ subflowRevision: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              >
                <option value="">{t('f.sf.revision.latest', { rev: selected.revision })}</option>
                <option value={String(selected.revision)}>rev {selected.revision}</option>
              </select>
              <div className="muted">{t('f.sf.revision.hint')}</div>
              {/* «Обновить до ревизии N» — явное действие на каждый вызов:
                  автообновления нет никогда. */}
              {p.subflowRevision != null && p.subflowRevision < selected.revision && (
                <button
                  type="button"
                  className="badge accent"
                  onClick={() => set({ subflowRevision: selected.revision })}
                >
                  {t('sf.updateOne', { rev: selected.revision })}
                </button>
              )}
            </div>

            {selected.inputs.length > 0 && (
              <div className="insp-field">
                <label>{t('f.sf.inputs')}</label>
                {selected.inputs.map((inp) => (
                  <div className="insp-field" key={inp.name}>
                    <label htmlFor={fieldId(`in_${inp.name}`)}>
                      <code className="mono">{inp.name}</code>
                      {inp.required && <span className="badge warn"> {t('f.sf.required')}</span>}
                    </label>
                    <input
                      id={fieldId(`in_${inp.name}`)}
                      value={String(boundInputs[inp.name] ?? '')}
                      onChange={(e) => set({ inputs: { ...boundInputs, [inp.name]: e.target.value } })}
                      placeholder={`{{${inp.name}}}`}
                    />
                    {inp.description && <div className="muted">{inp.description}</div>}
                  </div>
                ))}
                {issueBox('inputs')}
              </div>
            )}

            {selected.outputs.length > 0 && (
              <div className="insp-field">
                <label>{t('f.sf.outputs')}</label>
                {selected.outputs.map((o) => (
                  <div className="insp-field" key={o.name}>
                    <label htmlFor={fieldId(`out_${o.name}`)}>
                      <code className="mono">{o.name}</code> →
                    </label>
                    <input
                      id={fieldId(`out_${o.name}`)}
                      value={String(boundOutputs[o.name] ?? o.name)}
                      onChange={(e) => set({ outputs: { ...boundOutputs, [o.name]: e.target.value } })}
                    />
                  </div>
                ))}
                <div className="muted">{t('f.sf.outputs.hint')}</div>
              </div>
            )}

            <div className="insp-field">
              <label htmlFor={fieldId('scope')}>{t('f.sf.scope')}</label>
              <select
                id={fieldId('scope')}
                value={p.scope || 'isolated'}
                onChange={(e) => set({ scope: e.target.value as 'isolated' | 'shared' })}
              >
                <option value="isolated">{t('f.sf.scope.isolated')}</option>
                <option value="shared">{t('f.sf.scope.shared')}</option>
              </select>
              {/* Предупреждение про shared — часть контракта: это не ошибка, а
                  осознанное решение, и UI обязан это показать. */}
              {p.scope === 'shared' && <div className="callout warn">{t('f.sf.scope.warn')}</div>}
              {p.scope !== 'shared' && <div className="muted">{t('f.sf.scope.hint')}</div>}
            </div>
          </>
        )}
      </Section>
      <div className="muted insp-sf-note">{t('f.sf.note', { id: block.id })}</div>
    </>
  );
}


// Полный набор операторов (набор 2026-09): легаси-путь движка делегирует
// новые операторы общей реализации (evalLegacyCond), поэтому их можно
// предлагать и в одиночном условии, и в списке.
const ALL_OPS: ConditionOp[] = [
  ...COND_OPS,
  '>=',
  '<=',
  'in',
  'not_in',
  'starts_with',
  'ends_with',
  'empty',
  'not_empty',
  'regex',
];

// Для тега осмысленны только «равно», «не равно» и проверка пустоты: тег —
// это факт «есть/нет» (движок отдаёт '1' или ''), остальные операторы
// валидатор помечает предупреждением cond-tag-op.
const TAG_CONDS: ConditionOp[] = ['==', '!=', 'empty', 'not_empty'];

// i18n-ключ оператора: старые пять живут в базовом словаре, новые девять —
// там же под своими именами (f.op.in/notIn/startsWith/…).
const OP_KEYS: Record<ConditionOp, string> = {
  '==': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '<': 'lt',
  contains: 'contains',
  '>=': 'gte',
  '<=': 'lte',
  in: 'in',
  not_in: 'notIn',
  starts_with: 'startsWith',
  ends_with: 'endsWith',
  empty: 'empty',
  not_empty: 'notEmpty',
  regex: 'regex',
};

function opKey(op: ConditionOp): string {
  return OP_KEYS[op] ?? 'eq';
}

// Блоки, у которых текст реально уходит в Telegram с parseMode (движок зовёт
// render/attachMarkup для их текстовых полей). invoice и ai сюда не входят:
// счёт и ответ ИИ отправляются без parse_mode — select обещал бы то, чего нет.
const FORMATTING_TYPES: BlockType[] = [
  'message',
  'media',
  'media_group',
  'chain',
  'buttons',
  'menu',
  'command',
  'web_app',
];

// Виды ввода-вложения (движок: ATTACHMENT_INPUT_KINDS). Для них regex-проверка
// неприменима, а в переменную попадает file_id / «lat,lon».
const ATTACHMENT_KINDS: string[] = ['photo', 'document', 'video', 'voice', 'audio', 'location', 'any'];

// Все типы набора 2026-09: им показываем остаточные замечания валидатора
// (про ветки и прочее, что не привязано к конкретному полю).
const NEW_BLOCK_TYPES: BlockType[] = [
  'poll',
  'forward',
  'chat_action',
  'web_app',
  'wait',
  'channel_check',
  'segment_broadcast',
  'user_stats',
  'payment_link',
  'payment_check',
  'foreach',
  'random_text',
  'assert',
  'counter',
  'subflow',
  'subflow_return',
];

// Код валидатора → поле инспектора, рядом с которым показать замечание.
// Ключи — имена полей BlockParams; fieldId() строит из них id инпута, поэтому
// scrollIntoView при открытии блока находит нужный контрол.
// Замечания про ветки (poll-answered, wait-timeout, chk-member, fe-each…) сюда
// не входят: они рисуются стрелками на холсте и уходят в restIssues.
const ISSUE_FIELD: Record<string, string> = {
  'subflow-id': 'subflowId',
  'subflow-input': 'inputs',
  'subflow-missing': 'subflowId',
  'subflow-revision': 'subflowRevision',
  'subflow-outdated': 'subflowRevision',
  'subflow-cycle': 'subflowId',
  'subflow-depth': 'subflowId',
  'poll-question': 'question',
  'poll-options': 'pollOptions',
  'poll-options-max': 'pollOptions',
  'poll-option-text': 'pollOptions',
  'poll-correct': 'correctOptionId',
  'fwd-text': 'forwardText',
  'fwd-target': 'toChatId',
  'chat-action': 'chatAction',
  'wait-seconds': 'seconds',
  'wait-max': 'maxWaitMinutes',
  'chk-id': 'channelId',
  'chk-cache': 'cacheMinutes',
  'seg-content': 'segmentText',
  'seg-segment': 'segmentTag',
  'seg-cap': 'dailyCap',
  'seg-chunk': 'chunkSize',
  'usr-template': 'template',
  'pay-conn': 'connectionId',
  'pay-amount': 'amount',
  'payc-conn': 'connectionId',
  'payc-order': 'orderIdVar',
  'fe-list': 'listVar',
  'fe-max': 'maxIterations',
  'fe-max-cap': 'maxIterations',
  'rt-empty': 'variants',
  'rt-text': 'variants',
  'rt-nowhere': 'outVar',
  'as-msg': 'failMessage',
  'cnt-name': 'counterName',
  'cnt-amount': 'amount',
  'cnt-max': 'counterMax',
  'webapp-text': 'text',
  'webapp-button': 'button',
  'webapp-url': 'url',
  'webapp-url-path': 'url',
  // общие проверки (все блоки): текст, медиа, разметка, команда, ввод
  'msg-empty': 'text',
  'media-empty': 'mediaUrl',
  'markup-tags': 'parseMode',
  'cmd-name': 'command',
  'input-var': 'var',
  'input-regex': 'regex',
  'http-url': 'url',
  'http-scheme': 'url',
};

// Инлайн-замечание валидатора: человеческий текст + код мелким mono.
function IssueBox({ issue, language }: { issue: Issue; language: Lang }) {
  return (
    <div className={`insp-issue${issue.level === 'error' ? ' error' : ''}`} role={issue.level === 'error' ? 'alert' : 'status'}>
      <span>
        {validationIssueMessage(issue, language)}
        {issue.hint ? ` ${issue.hint}` : ''}
      </span>
      <span className="insp-issue-code">{issue.code}</span>
    </div>
  );
}
