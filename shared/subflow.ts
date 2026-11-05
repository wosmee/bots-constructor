// Подсценарии (subflows) — РАСКРЫТИЕ в плоский сценарий.
//
// Проектное решение (не «оптимизировать» в рантайм-вызовы!):
// подсценарий — это АВТОРСКАЯ конструкция времени разработки. Перед запуском
// движка он КОМПИЛИРУЕТСЯ (раскрывается) в плоский Scenario:
//
//   авторский сценарий (с блоками `subflow`)
//     -> A) expandSubflows(scenario, library)   [чистая, детерминированная, синхронная]
//     -> B) validateScenario(expanded)          [тот же валидатор; проблемы мапятся на блок вызова]
//     -> C) runEngine(expanded)                 [движок НЕ изменён]
//
// Почему так, а не динамические вызовы в движке:
//   - движок остаётся чистой функцией, каждый существующий тест движка сохраняет смысл;
//   - превью точно: что автор прогнал, то и работает в проде;
//   - публикация детерминирована: живой бот не меняет поведение из-за того,
//     что кто-то позже поправил фрагмент в библиотеке;
//   - никакого рантайм-стека вызовов, никаких дополнительных чтений D1 на
//     горячем пути, никакого счётчика глубины на сообщение.
//
// ОТКЛОНЕНО сознательно: разрешение подсценариев в момент сообщения в воркере
// (чтения D1 на горячем пути, нерепродуцируемая публикация, неоднозначный
// rollback); VM/стек вызовов в engine.ts (огромная поверхность для макроса).
import {
  Block,
  BlockParams,
  Scenario,
  SUBFLOW_ID_PREFIX,
  isInternalVar,
  PUBLIC_SYSTEM_VARS,
} from './types';

// Глубина вложенности фрагментов: A вызывает B, B вызывает C — это 3 уровня.
export const SUBFLOW_MAX_DEPTH = 3;
// Потолок блоков в раскрытом результате. Защита от раздувания: история версий
// и KV-кэш хранят полную копию JSON, лимит flow_json — 1 МБ.
export const SUBFLOW_MAX_BLOCKS = 500;

// Объявленный вход/выход фрагмента.
export interface SubflowIoDef {
  name: string;
  description?: string;
  required?: boolean;
}

// Один фрагмент библиотеки. flow_json — Scenario фрагмента (со своим start;
// среди блоков могут быть вложенные `subflow` и терминалы `subflow_return`).
// revision — текущая ревизия в библиотеке; latestRevision дублирует её для
// читаемости вызовов. revisions — снимки закреплённых вызовами ревизий
// (загружаются из subflow_versions): закрепление на несуществующей ревизии
// даёт ошибку subflow-revision.
export interface SubflowRevisionSnapshot {
  flow_json: Scenario;
  inputs: SubflowIoDef[];
  outputs: SubflowIoDef[];
}

export interface SubflowLibEntry {
  id: string;
  name: string;
  revision: number;
  flow_json: Scenario;
  inputs: SubflowIoDef[];
  outputs: SubflowIoDef[];
  latestRevision?: number;
  revisions?: Record<number, SubflowRevisionSnapshot>;
}

export type SubflowLibrary = Record<string, SubflowLibEntry>;

export interface SubflowIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
  hint?: string;
  // ВСЕГДА id блока ВЫЗОВА в авторском сценарии: автор узнаёт проблему там,
  // где поставил вызов, а не внутри развёрнутого артефакта.
  blockId?: string;
  // Вторичный указатель на блок внутри фрагмента (для «открыть фрагмент здесь»).
  fragmentBlockId?: string;
  subflowId?: string;
}

export interface ExpandResult {
  scenario: Scenario;
  issues: SubflowIssue[];
}

// ------------------------------------------------------------------ системные имена

// Системные переменные НИКОГДА не переименовываются и не экранируются: их
// выставляют движок и воркер (last_input, __*, ref.*, pay.*, user.*, poll.*).
const SYSTEM_PREFIXES = ['ref.', 'pay.', 'user.', 'poll.', '__'];
const SYSTEM_EXACT = new Set(['last_input', 'payment']);
for (const v of PUBLIC_SYSTEM_VARS) SYSTEM_EXACT.add(v);

function isSystemVar(name: string): boolean {
  if (!name) return false;
  if (SYSTEM_EXACT.has(name)) return true;
  if (isInternalVar(name)) return true;
  return SYSTEM_PREFIXES.some((p) => name.startsWith(p));
}

// ------------------------------------------------------------------ переименование переменных

// Имя переменной внутри фрагмента при isolated-области. Выходы (pinned) не
// переименовываются: они пишутся в пространство вызывающего.
function scopedVarName(raw: string, alias: string, pinned: Set<string>, isolated: boolean): string {
  const name = String(raw ?? '').trim();
  if (!name || !isolated || isSystemVar(name) || pinned.has(name)) return raw;
  return `sf.${alias}.${name}`;
}

// {{name}} внутри текста: переименовываются только полные совпадения.
const TEMPLATE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function rewriteTemplate(text: string, ren: (v: string) => string): string {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  return text.replace(TEMPLATE_RE, (_m, v: string) => `{{${ren(v)}}}`);
}

// Поля params со строковыми шаблонами {{var}}. Список явный (как
// MARKUP_TEXT_FIELDS в validate.ts): пропущенное поле — видимый баг, а не
// тихая поломка, его легко добавить.
const TEMPLATE_PARAM_FIELDS: (keyof BlockParams)[] = [
  'text',
  'prompt',
  'caption',
  'menuPrompt',
  'question',
  'explanation',
  'template',
  'forwardText',
  'segmentText',
  'notifyText',
  'broadcastText',
  'refText',
  'refBonusText',
  'failMessage',
  'errorText',
  'note',
  'condValue',
  'expr',
  'keywords',
  // F-027: текстовые поля набора 2026-10 (движок render/interpolate'ит их).
  // deadlineVar — тоже шаблон: engine.ts делает interpolate(p.deadlineVar),
  // а чипсы инспектора вставляют в поле форму {{имя}}.
  'editText',
  'deadlineVar',
  'deadlineText',
  'classifyPrompt',
  'classifyInput',
  'locationPrompt',
  'locationButtonLabel',
  'quizFailText',
  'reminderText',
];

// Поля params, хранящие ИМЯ переменной (движок читает/пишет их напрямую).
// F-027 (аудит 18.10.2026): перечень обязан быть ПОЛНЫМ — grep 'Var?:' в
// shared/types.ts. Пропущенное поле = isolated-фрагмент пишет в переменную
// вызывающего сценария («чёрный ящик» портит чужое состояние).
const VAR_PARAM_FIELDS: (keyof BlockParams)[] = [
  'var',
  'assignVar',
  'condVar',
  'switchVar',
  'outVar',
  'collectVar',
  'aiVar',
  'refVar',
  'refBonusVar',
  'tagVar',
  'orderIdVar',
  'linkVar',
  'listVar',
  'itemVar',
  'indexVar',
  'fromVar',
  'refGoalVar',
  // набор 2026-10: edit/delete_message, timer_deadline, ai_classify.
  // deadlineVar НЕ здесь: engine.ts интерполирует его как ШАБЛОН
  // (interpolate(p.deadlineVar), форма {{имя}} из чипсов инспектора) — он в
  // TEMPLATE_PARAM_FIELDS. renVar на '{{x}}' дал бы мусор.
  'msgRefVar',
  'cancelVar',
  'classifyOutVar',
  // §5 (2026-09): память диалога ai — имя переменной с историей.
  'historyVar',
];

// Копия params с переименованными переменными и шаблонами.
function rewriteParams(p: BlockParams, renVar: (v: string) => string): BlockParams {
  const out: BlockParams = { ...p };
  for (const f of VAR_PARAM_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v) (out as any)[f] = renVar(v);
  }
  for (const f of TEMPLATE_PARAM_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v) (out as any)[f] = rewriteTemplate(v, renVar);
  }
  // Составные условия: var переименовывается только для source 'var'
  // ('tag' и 'user' — не переменные сценария), value — шаблон.
  const rewriteCond = (c: any) =>
    c
      ? {
          ...c,
          var: !c.source || c.source === 'var' ? renVar(String(c.var ?? '')) : c.var,
          value: rewriteTemplate(String(c.value ?? ''), renVar),
        }
      : c;
  if (Array.isArray(out.conditions)) out.conditions = out.conditions.map(rewriteCond);
  if (Array.isArray(out.segmentWhere)) out.segmentWhere = out.segmentWhere.map(rewriteCond);
  const rewriteMap = (m: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!m) return m;
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(m)) r[k] = rewriteTemplate(String(v ?? ''), renVar);
    return r;
  };
  out.dataFields = rewriteMap(out.dataFields);
  out.dataWhere = rewriteMap(out.dataWhere);
  if (out.invoice) {
    const inv = { ...out.invoice };
    for (const f of ['title', 'description', 'label', 'payload'] as const) {
      if (typeof inv[f] === 'string') inv[f] = rewriteTemplate(inv[f] as string, renVar);
    }
    if (typeof inv.amount === 'string') inv.amount = rewriteTemplate(inv.amount, renVar);
    if (typeof inv.photoUrl === 'string') inv.photoUrl = rewriteTemplate(inv.photoUrl, renVar);
    out.invoice = inv;
  }
  if (Array.isArray(out.buttons)) {
    out.buttons = out.buttons.map((b) => (b ? { ...b, label: rewriteTemplate(String(b.label ?? ''), renVar) } : b));
  }
  if (Array.isArray(out.pollOptions)) {
    out.pollOptions = out.pollOptions.map((o) => (o ? { ...o, text: rewriteTemplate(String(o.text ?? ''), renVar) } : o));
  }
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map((v) => (v ? { ...v, text: rewriteTemplate(String(v.text ?? ''), renVar) } : v));
  }
  if (Array.isArray(out.chainItems)) {
    out.chainItems = out.chainItems.map((it) =>
      it
        ? {
            ...it,
            ...(typeof it.text === 'string' ? { text: rewriteTemplate(it.text, renVar) } : {}),
            ...(typeof it.caption === 'string' ? { caption: rewriteTemplate(it.caption, renVar) } : {}),
          }
        : it
    );
  }
  if (Array.isArray(out.mediaItems)) {
    out.mediaItems = out.mediaItems.map((it) =>
      it && typeof it.caption === 'string' ? { ...it, caption: rewriteTemplate(it.caption, renVar) } : it
    );
  }
  for (const f of ['tagName', 'amount', 'channelId', 'url', 'bodyJson', 'aiPrompt', 'aiSystem', 'toChatId', 'refPayload', 'refEventName'] as const) {
    const v = out[f];
    if (typeof v === 'string' && v) (out as any)[f] = rewriteTemplate(v, renVar);
  }
  return out;
}

// Стабильный alias вызова: явный alias автора (очищенный) либо индекс вызова.
// Alias входит в префикс id (`sf:<alias>:<id>`) и в префикс переменных
// (`sf.<alias>.<var>`), поэтому два вызова одного фрагмента не сталкиваются.
function sanitizeAlias(raw: unknown, index: number): string {
  const s = String(raw ?? '').trim().replace(/[^\w-]/g, '_').slice(0, 24);
  return s || `c${index}`;
}

// ------------------------------------------------------------------ раскрытие одного вызова

// Куда указывает проблема: блок вызова в авторском сценарии (blockId) плюс,
// для вложенных ошибок, блок внутри фрагмента (fragmentBlockId).
interface IssueOrigin {
  blockId: string;
  fragmentBlockId?: string;
}

interface ExpansionStep {
  // Точка входа раскрытия (пролог входов или start фрагмента); null при ошибке.
  entry: string | null;
  // Блоки, чей next должен получить продолжение ВЫЗЫВАЮЩЕГО (done/failed).
  tails: { id: string; kind: 'done' | 'failed' }[];
  // Все созданные блоки (уже с полными id).
  blocks: Record<string, Block>;
}

function expandCallSite(
  call: Block,
  alias: string,
  library: SubflowLibrary,
  depth: number,
  chain: string[],
  issues: SubflowIssue[],
  origin: IssueOrigin,
  // F-024: занятые псевдонимы всего раскрытия (включая вложенные вызовы —
  // их блоки живут в том же плоском пространстве имён sf:<alias>:*).
  aliasOwners?: Map<string, string>
): ExpansionStep {
  aliasOwners?.set(alias, origin.fragmentBlockId ? `${origin.blockId}/${origin.fragmentBlockId}` : origin.blockId);
  const p = call.params ?? {};
  const push = (level: 'error' | 'warn', code: string, message: string, hint?: string, subflowId?: string, fragmentBlockId?: string) =>
    issues.push({
      level,
      code,
      message,
      hint,
      blockId: origin.blockId,
      ...(fragmentBlockId || origin.fragmentBlockId ? { fragmentBlockId: fragmentBlockId ?? origin.fragmentBlockId } : {}),
      ...(subflowId ? { subflowId } : {}),
    });

  const subflowId = String(p.subflowId ?? '').trim();
  if (!subflowId) {
    push('error', 'subflow-id', 'Блок подсценария не выбрал фрагмент', 'Укажите фрагмент из библиотеки.');
    return { entry: null, tails: [], blocks: {} };
  }
  const entry = library[subflowId];
  if (!entry) {
    push(
      'error',
      'subflow-missing',
      `Фрагмент «${subflowId}» не найден в библиотеке`,
      'Фрагмент удалён или принадлежит другому аккаунту. Замените вызов или восстановите фрагмент.',
      subflowId
    );
    return { entry: null, tails: [], blocks: {} };
  }

  // Резолв содержимого: закреплённая ревизия -> снимок из entry.revisions;
  // undefined -> последняя (flow_json). Закрепление на отсутствующей ревизии
  // — ОШИБКА (не тихая подмена последней): публикация должна быть
  // детерминированной и воспроизводимой.
  const pinnedRev = p.subflowRevision != null ? Number(p.subflowRevision) : null;
  let frag = entry.flow_json;
  let fragInputs = entry.inputs ?? [];
  let fragOutputs = entry.outputs ?? [];
  if (pinnedRev != null && pinnedRev !== entry.revision) {
    const snap = entry.revisions?.[pinnedRev];
    if (!snap) {
      push(
        'error',
        'subflow-revision',
        `Фрагмент «${entry.name}»: закреплена ревизия ${pinnedRev}, в библиотеке её нет (текущая ${entry.revision})`,
        'Закреплённая ревизия удалена. Обновите вызов до доступной ревизии.',
        subflowId
      );
      return { entry: null, tails: [], blocks: {} };
    }
    frag = snap.flow_json;
    fragInputs = snap.inputs ?? fragInputs;
    fragOutputs = snap.outputs ?? fragOutputs;
  }

  // Закреплённая ревизия есть, но в библиотеке уже новее — ПРЕДУПРЕЖДЕНИЕ:
  // публикация разрешена (решает автор), вызов помечается устаревшим.
  const latest = entry.latestRevision ?? entry.revision;
  if (pinnedRev != null && pinnedRev < latest) {
    push(
      'warn',
      'subflow-outdated',
      `Фрагмент «${entry.name}»: вызов закреплён на ревизии ${pinnedRev}, доступна ${latest}`,
      'Обновите вызов до свежей ревизии, когда будете готовы — сейчас раскрывается закреплённая.',
      subflowId
    );
  }

  // Цикл: фрагмент уже в текущей цепочке раскрытия (A->A или A->B->A).
  if (chain.includes(subflowId)) {
    push(
      'error',
      'subflow-cycle',
      `Цикл подсценариев: ${[...chain, subflowId].map((x) => library[x]?.name ?? x).join(' → ')}`,
      'Фрагмент вызывает сам себя (прямо или через другие). Уберите один из вызовов.',
      subflowId,
      call.id
    );
    return { entry: null, tails: [], blocks: {} };
  }
  if (depth >= SUBFLOW_MAX_DEPTH) {
    push(
      'error',
      'subflow-depth',
      `Вложенность подсценариев больше ${SUBFLOW_MAX_DEPTH}`,
      'Упростите структуру: вынесите общие куски в один фрагмент вместо цепочки.',
      subflowId,
      call.id
    );
    return { entry: null, tails: [], blocks: {} };
  }

  const fragBlocks = frag?.blocks ?? {};
  const isolated = (p.scope ?? 'isolated') !== 'shared';

  // Обязательные входы: отсутствие привязки — ошибка с именем входа.
  const boundInputs = { ...(p.inputs ?? {}) };
  for (const inp of fragInputs) {
    if (!inp?.required) continue;
    const v = boundInputs[inp.name];
    if (v == null || String(v).trim() === '') {
      push(
        'error',
        'subflow-input',
        `Фрагмент «${entry.name}»: обязательный вход «${inp.name}» не привязан`,
        'Заполните вход в инспекторе блока подсценария.',
        subflowId
      );
    }
  }

  // Имена, закреплённые за вызывающим: объявленные выходы пишутся в его
  // пространство имён и не переименовываются.
  const pinnedOutputs = new Set<string>();
  for (const o of fragOutputs) if (o?.name) pinnedOutputs.add(o.name);
  const declaredInputs = new Set<string>();
  for (const i of fragInputs) if (i?.name) declaredInputs.add(i.name);

  const renVar = (v: string): string => {
    const name = String(v ?? '').trim();
    if (!name) return v;
    // Объявленные входы ВСЕГДА переименовываются в sf.<alias>.<name>: пролог
    // присваивания пишет именно туда, иначе {{name}} в шаблоне перехватил бы
    // одноимённую переменную вызывающего.
    if (declaredInputs.has(name)) return isolated ? `sf.${alias}.${name}` : name;
    return scopedVarName(name, alias, pinnedOutputs, isolated);
  };

  const prefix = `${SUBFLOW_ID_PREFIX}${alias}:`;
  const newBlocks: Record<string, Block> = {};
  const tails: { id: string; kind: 'done' | 'failed' }[] = [];

  // 1. Пролог входов: setvar-блоки `sf:<alias>:in_<name>` = выражение вызывающего.
  // Пролог нужен, потому что входы фрагмент читает не только шаблонами {{name}}:
  // условие condVar='name' или setvar expr='{{name}}+1' без присваивания
  // остались бы на значении вызывающего (подстановка текста их бы не покрыла).
  const prologueIds: string[] = [];
  for (const inp of fragInputs) {
    const name = String(inp?.name ?? '').trim();
    if (!name) continue;
    const expr = boundInputs[name];
    if (expr == null || String(expr).trim() === '') continue;
    const id = `${prefix}in_${name}`;
    newBlocks[id] = {
      id,
      type: 'setvar',
      params: { assignVar: isolated ? `sf.${alias}.${name}` : name, expr: String(expr) },
    };
    prologueIds.push(id);
  }

  // 2. Блоки фрагмента. Карта «старый id -> новый» заполняется ДО обхода:
  // связи next/branches/goto могут указывать на блок, который ещё не создан.
  const fragIds = Object.keys(fragBlocks);
  const idMap = new Map<string, string>();
  for (const id of fragIds) idMap.set(id, `${prefix}${id}`);
  // Предпроход return-блоков с явными выходами: ссылки на return должны вести
  // в ПЕРВЫЙ out-блок (присваивание выхода), а его может создать только обход
  // ниже. Без предпрохода ветка, ведущая в return, осталась бы битой.
  for (const id of fragIds) {
    const b = fragBlocks[id];
    if (b?.type !== 'subflow_return') continue;
    const explicit = (b.params?.outputs ?? {}) as Record<string, string>;
    const first = fragOutputs.find(
      (o) => o?.name && String(explicit[String(o.name)] ?? '').trim() !== ''
    );
    if (first) idMap.set(id, `${prefix}out_${first.name}_${id}`);
  }
  const mapTarget = (t: string | undefined): string | undefined => (t ? (idMap.get(t) ?? t) : t);

  for (let idx = 0; idx < fragIds.length; idx++) {
    const id = fragIds[idx];
    const b = fragBlocks[id];
    if (!b) continue;
    const newId = `${prefix}${id}`;

    if (b.type === 'subflow_return') {
      // Терминал: явные выходы (params.outputs) становятся setvar-блоками в
      // пространстве вызывающего; неявные (совпадение имён) уже написаны
      // переименованными блоками фрагмента (pinned не переименовывается).
      const explicit = (b.params?.outputs ?? {}) as Record<string, string>;
      const outIds: string[] = [];
      for (const o of fragOutputs) {
        const name = String(o?.name ?? '').trim();
        if (!name) continue;
        const expr = explicit[name];
        if (expr == null || String(expr).trim() === '') continue;
        const outId = `${prefix}out_${name}_${id}`;
        newBlocks[outId] = {
          id: outId,
          type: 'setvar',
          params: { assignVar: name, expr: rewriteTemplate(String(expr), renVar) },
        };
        outIds.push(outId);
      }
      if (outIds.length) {
        for (let i = 0; i < outIds.length - 1; i++) newBlocks[outIds[i]].next = outIds[i + 1];
        tails.push({ id: outIds[outIds.length - 1], kind: 'done' });
      } else {
        // Return без явных выходов — маркер возврата: note-блок, чтобы в
        // плоском сценарии не осталось неизвестного движку типа.
        newBlocks[newId] = { id: newId, type: 'note', params: { note: `возврат: ${entry.name}` } };
        tails.push({ id: newId, kind: 'done' });
      }
      continue;
    }

    if (b.type === 'subflow') {
      // Вложенный вызов: рекурсия с той же библиотекой, глубина +1. Его
      // done/failed — ветки ВНУТРИ фрагмента, а не ветки внешнего вызова.
      const nestedAlias = sanitizeAlias(b.params?.alias, idx);
      const step = expandCallSite(
        b,
        nestedAlias,
        library,
        depth + 1,
        [...chain, subflowId],
        issues,
        { blockId: origin.blockId, fragmentBlockId: b.id },
        aliasOwners
      );
      if (step.entry) {
        // Кто вёл во вложенный вызов — теперь ведёт в точку входа раскрытия.
        idMap.set(id, step.entry);
        const nestedDone = mapTarget(b.branches?.done) ?? '';
        const nestedFailed = mapTarget(b.branches?.failed) ?? '';
        for (const t of step.tails) {
          const tb = step.blocks[t.id];
          if (tb && !tb.next) tb.next = t.kind === 'done' ? nestedDone : nestedFailed;
        }
        Object.assign(newBlocks, step.blocks);
      } else {
        // Вложенный вызов не раскрылся (ошибка уже записана): тупик-заметка,
        // чтобы валидатор показал проблему, а граф остался связным.
        newBlocks[newId] = { id: newId, type: 'note', params: { note: `сбой вызова: ${b.params?.subflowId ?? '?'}` } };
        tails.push({ id: newId, kind: 'failed' });
      }
      continue;
    }

    const params = rewriteParams(b.params ?? {}, renVar);
    const nb: Block = { id: newId, type: b.type, params };
    const next = mapTarget(b.next);
    if (next) nb.next = next;
    if (b.branches) {
      const br: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.branches)) br[k] = mapTarget(v) ?? '';
      nb.branches = br;
    }
    if (b.type === 'goto' && typeof params.target === 'string' && params.target) {
      params.target = mapTarget(params.target) ?? params.target;
    }
    // params.disabled сохраняется как есть: замороженный блок внутри
    // фрагмента остаётся замороженным (движок его пропускает).
    newBlocks[newId] = nb;
  }

  // 3. Пролог -> точка входа фрагмента.
  const fragStart = frag?.start && fragBlocks[frag.start] ? idMap.get(frag.start) ?? `${prefix}${frag.start}` : null;
  for (let i = 0; i < prologueIds.length - 1; i++) newBlocks[prologueIds[i]].next = prologueIds[i + 1];
  let entryId: string | null;
  if (prologueIds.length) {
    if (fragStart) newBlocks[prologueIds[prologueIds.length - 1]].next = fragStart;
    entryId = prologueIds[0];
  } else {
    entryId = fragStart;
  }

  // Фрагмент без единого subflow_return: блок-лист (без next) становится
  // done-хвостом. Это поддерживаемый, хоть и не рекомендованный стиль.
  if (!tails.length && entryId) {
    for (const b of Object.values(newBlocks)) {
      const outgoing = [b.next, ...Object.values(b.branches ?? {}), b.type === 'goto' ? (b.params?.target as string) : ''].filter(Boolean);
      if (outgoing.length) continue;
      if (b.type === 'end' || b.type === 'note') continue;
      tails.push({ id: b.id, kind: 'done' });
    }
  }

  return { entry: entryId, tails, blocks: newBlocks };
}

/**
 * Раскрыть все блоки `subflow` в плоский сценарий.
 *
 * Чистая, синхронная, детерминированная; входной сценарий и библиотека НЕ
 * мутируются. Ошибки несут id блока вызова в АВТОРСКОМ сценарии.
 */
export function expandSubflows(scenario: Scenario, library: SubflowLibrary): ExpandResult {
  const issues: SubflowIssue[] = [];
  // Глубокая копия: результат — новый объект.
  const blocks: Record<string, Block> = JSON.parse(JSON.stringify(scenario?.blocks ?? {}));
  let start = scenario?.start ?? '';

  const callIds = Object.keys(blocks).filter((id) => blocks[id]?.type === 'subflow');
  // Карта замен «id вызова -> точка входа раскрытия (или failed-цель)».
  // Применяется ПОСЛЕ всех раскрытий: вызов c1 может вести в вызов c2, который
  // обрабатывается позже, и порядок Object.keys не обязан совпадать с порядком
  // ссылок. Финальный проход транзитивно подставляет все замены.
  const replacements = new Map<string, string>();
  // F-024: alias входит в префикс id раскрытых блоков (sf:<alias>:*), поэтому
  // дубль alias = коллизия — второй вызов молча затирал первый. Карта занятых
  // alias общая для всего раскрытия (включая вложенные вызовы: их блоки живут
  // в том же плоском пространстве имён).
  const aliasOwners = new Map<string, string>();
  for (let callIndex = 0; callIndex < callIds.length; callIndex++) {
    const callId = callIds[callIndex];
    const call = blocks[callId];
    const alias = sanitizeAlias(call.params?.alias, callIndex);
    const clash = aliasOwners.get(alias);
    if (clash) {
      // Дубль: ошибка на оба блока вызова, оба уходят в ветку failed и не
      // раскрываются — иначе блоки sf:<alias>:* одного вызова затёрли бы
      // блоки другого (Object.assign) и сценарий потерял бы целый вызов молча.
      issues.push({
        level: 'error',
        code: 'subflow-alias-dup',
        message: `Псевдоним «${alias}» используется в двух блоках подсценария (${clash} и ${callId})`,
        hint: 'Задайте блокам разные псевдонимы в инспекторе: по псевдониму различаются копии фрагмента, при совпадении один вызов затирает другой.',
        blockId: callId,
      });
      if (!issues.some((i) => i.code === 'subflow-alias-dup' && i.blockId === clash)) {
        issues.push({
          level: 'error',
          code: 'subflow-alias-dup',
          message: `Псевдоним «${alias}» используется в двух блоках подсценария (${clash} и ${callId})`,
          hint: 'Задайте блокам разные псевдонимы в инспекторе: по псевдониму различаются копии фрагмента, при совпадении один вызов затирает другой.',
          blockId: clash,
        });
      }
      replacements.set(callId, call.branches?.failed ?? '');
      if (start === callId) start = call.branches?.failed ?? '';
      delete blocks[callId];
      continue;
    }
    aliasOwners.set(alias, callId);
    const step = expandCallSite(call, alias, library, 0, [], issues, { blockId: callId }, aliasOwners);
    const doneTarget = call.branches?.done ?? '';
    const failedTarget = call.branches?.failed ?? '';

    if (!step.entry) {
      // Ошибка раскрытия: вызов удаляется, входящие ссылки перенаправляются
      // в ветку failed (или обрываются). Блок `subflow` не должен остаться в
      // плоском сценарии: движок его не понимает (см. guard в engine.ts).
      replacements.set(callId, failedTarget);
      if (start === callId) start = failedTarget;
      delete blocks[callId];
      continue;
    }

    // Хвосты: done -> ветка done вызывающего, failed -> ветка failed.
    for (const t of step.tails) {
      const tb = step.blocks[t.id];
      if (tb && !tb.next) tb.next = t.kind === 'done' ? doneTarget : failedTarget;
    }

    replacements.set(callId, step.entry);
    if (start === callId) start = step.entry;
    delete blocks[callId];
    Object.assign(blocks, step.blocks);
  }

  // Финальный проход ссылок: все указатели на заменённые вызовы — на новые
  // точки входа. Транзитивно (замена может вести на другую замену).
  const resolve = (t: string): string => {
    let cur: string = t;
    let guard = 0;
    while (replacements.has(cur) && guard++ < callIds.length + 1) {
      const nextVal: string | undefined = replacements.get(cur);
      cur = nextVal ?? '';
    }
    return cur;
  };
  if (replacements.size) {
    for (const b of Object.values(blocks)) {
      if (b.next) b.next = resolve(b.next);
      if (b.branches) for (const k of Object.keys(b.branches)) if (b.branches[k]) b.branches[k] = resolve(b.branches[k]);
      if (b.type === 'goto' && b.params?.target) b.params.target = resolve(b.params.target);
    }
  }

  // Лимит размера раскрытого результата — ошибка, никогда не тихое усечение.
  const total = Object.keys(blocks).length;
  if (total > SUBFLOW_MAX_BLOCKS) {
    issues.push({
      level: 'error',
      code: 'subflow-size',
      message: `Раскрытый сценарий больше ${SUBFLOW_MAX_BLOCKS} блоков (${total})`,
      hint: 'Уменьшите фрагменты или число вызовов: большой сценарий не публикуется.',
    });
  }

  // В плоском результате не должно остаться ни subflow, ни subflow_return.
  for (const b of Object.values(blocks)) {
    if (b.type === 'subflow' || b.type === 'subflow_return') {
      issues.push({
        level: 'error',
        code: 'subflow-leftover',
        message: `Блок «${b.type}» не раскрыт (${b.id})`,
        hint: 'Проверьте библиотеку фрагментов.',
        blockId: b.id,
      });
    }
  }

  return { scenario: { version: scenario?.version ?? 1, start, blocks }, issues };
}

// ------------------------------------------------------------------ проверка вызовов

export interface SubflowCallStatus {
  blockId: string;
  subflowId: string;
  alias: string;
  status: 'ok' | 'outdated' | 'missing' | 'cycle' | 'depth' | 'revision-missing';
  // Ревизия, которую библиотека считает текущей (для «обновить до ревизии N»).
  latestRevision?: number;
  pinnedRevision?: number;
}

function callsOf(sc: Scenario | undefined | null): string[] {
  const res: string[] = [];
  for (const b of Object.values(sc?.blocks ?? {})) {
    if (b.type === 'subflow' && b.params?.subflowId) res.push(String(b.params.subflowId));
  }
  return res;
}

// Сухой прогон по блокам вызова: статус каждого для бейджей UI
// (ok / outdated / missing / cycle / depth). Не раскрывает — только смотрит.
export function checkSubflowCalls(scenario: Scenario, library: SubflowLibrary): SubflowCallStatus[] {
  const out: SubflowCallStatus[] = [];
  const blocks = scenario?.blocks ?? {};
  let index = 0;
  for (const id of Object.keys(blocks)) {
    const b = blocks[id];
    if (b.type !== 'subflow') continue;
    const subflowId = String(b.params?.subflowId ?? '').trim();
    const alias = sanitizeAlias(b.params?.alias, index++);
    const entry = subflowId ? library[subflowId] : undefined;
    const base = { blockId: id, subflowId, alias };
    if (!subflowId || !entry) {
      out.push({ ...base, status: 'missing' });
      continue;
    }
    const pinned = b.params?.subflowRevision != null ? Number(b.params.subflowRevision) : undefined;
    if (pinned != null && pinned !== entry.revision) {
      out.push({ ...base, status: pinned < entry.revision ? 'outdated' : 'revision-missing', latestRevision: entry.revision, pinnedRevision: pinned });
      continue;
    }
    // Цепочка вложенных вызовов: цикл или превышение глубины.
    const chain = [subflowId];
    let cur: SubflowLibEntry | undefined = entry;
    let status: SubflowCallStatus['status'] = 'ok';
    while (cur) {
      const next: string | undefined = callsOf(cur.flow_json)[0];
      if (!next) break;
      if (chain.includes(next)) {
        status = 'cycle';
        break;
      }
      chain.push(next);
      if (chain.length > SUBFLOW_MAX_DEPTH) {
        status = 'depth';
        break;
      }
      cur = library[next];
      if (!cur && next) {
        status = 'missing';
        break;
      }
    }
    if (status !== 'ok') {
      out.push({ ...base, status, latestRevision: entry.revision });
      continue;
    }
    out.push({ ...base, status: 'ok', latestRevision: entry.revision, ...(pinned != null ? { pinnedRevision: pinned } : {}) });
  }
  return out;
}

// Быстрый флаг для загрузчиков: есть ли в сценарии блоки подсценариев.
export function scenarioHasSubflows(sc: Scenario | null | undefined): boolean {
  if (!sc?.blocks) return false;
  for (const b of Object.values(sc.blocks)) if (b.type === 'subflow' || b.type === 'subflow_return') return true;
  return false;
}

// Маппинг проблем РАСКРЫТОГО артефакта обратно на блоки вызова в авторском
// сценарии. Правило: id развёрнутого блока — `sf:<alias>:<originalId>`;
// alias однозначно определяет блок вызова (два вызова одного фрагмента не
// сталкиваются). В авторском файле id НИКОГДА не переписываются — маппинг
// применяется только к отчёту.
export function remapIssuesToCallSites<T extends { blockId?: string; fragmentBlockId?: string }>(issues: T[], author: Scenario): T[] {
  // alias -> id блока вызова. Воспроизводит нумерацию expander'а: обход
  // Object.keys(blocks), индекс среди subflow-блоков, тот же sanitizeAlias.
  const aliasToCall = new Map<string, string>();
  let idx = 0;
  for (const id of Object.keys(author?.blocks ?? {})) {
    const b = author.blocks[id];
    if (b?.type !== 'subflow') continue;
    aliasToCall.set(sanitizeAlias(b.params?.alias, idx++), id);
  }
  return issues.map((i) => {
    const bid = String(i.blockId ?? '');
    if (!bid.startsWith(SUBFLOW_ID_PREFIX)) return i;
    const rest = bid.slice(SUBFLOW_ID_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep < 0) return i;
    const alias = rest.slice(0, sep);
    const originalId = rest.slice(sep + 1);
    const callId = aliasToCall.get(alias);
    if (!callId) return i;
    return { ...i, blockId: callId, fragmentBlockId: i.fragmentBlockId ?? originalId };
  });
}

// Переменные, которые выделение читает СНАРУЖИ (кандидаты во входы) и которые
// пишет, а внешний сценарий читает (кандидаты в выходы). Нужно фронту для
// «создать подсценарий из выделения».
export function selectionIo(scenario: Scenario, selectedIds: string[]): { inputs: string[]; outputs: string[] } {
  const sel = new Set(selectedIds);
  const WRITES: (keyof BlockParams)[] = [
    'assignVar', 'var', 'outVar', 'aiVar', 'collectVar', 'refVar', 'tagVar',
    'orderIdVar', 'linkVar', 'itemVar', 'indexVar',
  ];
  const reads = new Set<string>();
  const writes = new Set<string>();
  const externalReads = new Set<string>();
  const externalWrites = new Set<string>();

  for (const id of Object.keys(scenario.blocks)) {
    const b = scenario.blocks[id];
    const p = b.params ?? {};
    const w = sel.has(id) ? writes : externalWrites;
    const r = sel.has(id) ? reads : externalReads;
    for (const f of WRITES) {
      const v = (p as any)[f];
      if (typeof v === 'string' && v.trim()) w.add(v.trim());
    }
    for (const f of VAR_PARAM_FIELDS) {
      const v = (p as any)[f];
      if (typeof v === 'string' && v.trim()) r.add(v.trim());
    }
    for (const f of TEMPLATE_PARAM_FIELDS) {
      const v = (p as any)[f];
      if (typeof v === 'string') for (const m of v.matchAll(TEMPLATE_RE)) r.add(m[1]);
    }
    for (const c of p.conditions ?? []) if (c?.var) r.add(String(c.var).trim());
  }

  const inputs = [...reads].filter((v) => !isSystemVar(v) && !writes.has(v) && externalWrites.has(v));
  const outputs = [...writes].filter((v) => !isSystemVar(v) && externalReads.has(v));
  return { inputs: inputs.sort(), outputs: outputs.sort() };
}
