// Утилиты графа сценария: конвертация, структурный хэш, авторазметка,
// переменные и копирование подграфов. Вынесены из Constructor, чтобы тот
// оставался про компоненты, а не про обход графа.
import { Block, Scenario, usesBranches, REF_COUNT_VAR, REF_LEADERBOARD_VAR, REF_VERIFIED_VAR } from '../../shared/types';
import type { Node, Edge } from '@xyflow/react';

export interface NodeData extends Record<string, unknown> {
  block: Block;
}

// ---------------------------------------------------------------- canvas groups

// Визуальные группы блоков — ЧИСТО canvas-метаданные: движок, валидатор и
// analyzeConflicts их не видят. Живут в верхнеуровневом поле `groups` JSON
// сценария: scenarioContentHash (shared/graph.ts) хэширует только {start,
// blocks}, поэтому правки групп не создают новых «версий содержимого» и не
// сбрасывают черновик — так же, как позиции блоков.
export interface CanvasGroup {
  id: string;
  title: string;
  /** Один из GROUP_COLORS (токены совпадают с палитрой блоков). */
  color: string;
  collapsed: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** id блоков-участников. Членство живёт ЗДЕСЬ, а не в block: блоки уходят
   *  в движок, и лишнее поле изменило бы хэш содержимого. */
  members: string[];
}

export type CanvasScenario = Scenario & { groups?: CanvasGroup[] };

// Палитра групп — цвета из BLOCK_META, чтобы группы не спорили с блоками.
export const GROUP_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#eab308',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
];

// Высота заголовка группы: рамка строится так, чтобы блоки не залезали под него.
export const GROUP_HEADER_H = 26;
export const GROUP_MIN_W = 160;
export const GROUP_MIN_H = 80;
export const COLLAPSED_W = 220;
export const COLLAPSED_H = 44;

// Размеры блока до первого измерения: react-flow проставляет measured после
// рендера, а группа может создаваться и на ещё не измеренных узлах.
const FALLBACK_NODE_W = 220;
const FALLBACK_NODE_H = 96;

function nodeRect(n: Node): { x: number; y: number; w: number; h: number } {
  const w = n.measured?.width ?? n.width ?? FALLBACK_NODE_W;
  const h = n.measured?.height ?? n.height ?? FALLBACK_NODE_H;
  return { x: n.position.x, y: n.position.y, w, h };
}

export function newGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Рамка вокруг набора узлов: общий bbox + padding, сверху запас под заголовок.
export function createGroupAround(id: string, nodes: Node[], padding = 28): CanvasGroup | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = nodeRect(n);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return {
    id,
    title: '',
    color: GROUP_COLORS[0],
    collapsed: false,
    x: minX - padding,
    y: minY - padding - GROUP_HEADER_H,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2 + GROUP_HEADER_H,
    members: nodes.map((n) => n.id),
  };
}

// Точка (позиция блока) внутри рамки группы. Граница считается попаданием.
export function pointInGroup(pos: { x: number; y: number }, group: CanvasGroup): boolean {
  return (
    pos.x >= group.x &&
    pos.x <= group.x + group.w &&
    pos.y >= group.y &&
    pos.y <= group.y + group.h
  );
}

// Кто из переданных блоков оказался в рамке после драга: блок утащили наружу —
// членство снято, затащили внутрь — добавлено. Позиции передаёт вызывающий
// (обычно участники группы + перетащенные узлы), поэтому функция чистая.
export function membersAfterDrag(
  group: CanvasGroup,
  nodePositions: Record<string, { x: number; y: number }>
): string[] {
  return Object.keys(nodePositions).filter((id) => pointInGroup(nodePositions[id], group));
}

// Плитка свёрнутой группы: фиксированный размер, anchored в левом верхнем углу.
export function collapseRect(group: CanvasGroup): { x: number; y: number; w: number; h: number } {
  return { x: group.x, y: group.y, w: COLLAPSED_W, h: COLLAPSED_H };
}

// Защита от битого/чужого JSON: оставляем только группы корректной формы.
export function sanitizeGroups(value: unknown): CanvasGroup[] {
  if (!Array.isArray(value)) return [];
  const out: CanvasGroup[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Partial<CanvasGroup>;
    const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
    if (typeof g.id !== 'string' || !g.id || seen.has(g.id)) continue;
    if (!Array.isArray(g.members) || !g.members.every((m) => typeof m === 'string')) continue;
    seen.add(g.id);
    out.push({
      id: g.id,
      title: typeof g.title === 'string' ? g.title : '',
      color: typeof g.color === 'string' && g.color ? g.color : GROUP_COLORS[0],
      collapsed: g.collapsed === true,
      x: num(g.x, 0),
      y: num(g.y, 0),
      w: Math.max(GROUP_MIN_W, num(g.w, GROUP_MIN_W)),
      h: Math.max(GROUP_MIN_H, num(g.h, GROUP_MIN_H)),
      members: [...new Set(g.members as string[])],
    });
  }
  return out;
}

export function serializeGroups(groups: CanvasGroup[]): string {
  return JSON.stringify(groups ?? []);
}

// Обратная сторона serialize: битый JSON не роняет редактор — просто [].
export function parseGroups(json: string): CanvasGroup[] {
  try {
    return sanitizeGroups(JSON.parse(json));
  } catch {
    return [];
  }
}

// Участники свёрнутых групп скрываются с холста (node.hidden — runtime-флаг
// react-flow, в JSON сценария он не попадает: collapsed живёт в группе).
export function nodesWithCollapsedHidden(nodes: Node[], groups: CanvasGroup[]): Node[] {
  const hidden = new Set<string>();
  for (const g of groups ?? []) {
    if (g.collapsed) for (const m of g.members) hidden.add(m);
  }
  if (!hidden.size) return nodes;
  return nodes.map((n) => (hidden.has(n.id) ? { ...n, hidden: true } : n));
}

// Соответствие old→new id для результата copySubgraph/duplicateWithLinks:
// обе функции выдают копии в порядке `nodes`, отфильтрованных по ids.
export function copyIdMap(nodes: Node[], ids: string[], copied: Node[]): Map<string, string> {
  const idSet = new Set(ids);
  const ordered = nodes.filter((n) => idSet.has(n.id)).map((n) => n.id);
  const map = new Map<string, string>();
  ordered.forEach((oldId, i) => {
    const nn = copied[i];
    if (nn) map.set(oldId, nn.id);
  });
  return map;
}

// Копии групп при copy/paste и дублировании: группа переносится, только если
// скопированы ВСЕ её участники; id группы всегда свежий.
export function copiedGroups(
  groups: CanvasGroup[],
  idMap: Map<string, string>,
  dx = 0,
  dy = 0
): CanvasGroup[] {
  const out: CanvasGroup[] = [];
  for (const g of groups ?? []) {
    if (!g.members.length || !g.members.every((m) => idMap.has(m))) continue;
    out.push({
      ...g,
      id: newGroupId(),
      collapsed: false,
      x: g.x + dx,
      y: g.y + dy,
      members: g.members.map((m) => idMap.get(m) as string),
    });
  }
  return out;
}

// ---------------------------------------------------------------- conversion

// Бывшая O(N×E): рёбра фильтровались внутри цикла по узлам. Здесь один проход
// по рёбрам в Map — на больших сценариях разница заметна.
export function graphToScenario(
  nodes: Node[],
  edges: Edge[],
  startId?: string | null,
  groups?: CanvasGroup[] | null
): CanvasScenario {
  const outBySource = new Map<string, Edge[]>();
  for (const e of edges) {
    if (e.label) continue; // помеченные рёбра — это ветки, они живут в block.branches
    const list = outBySource.get(e.source);
    if (list) list.push(e);
    else outBySource.set(e.source, [e]);
  }

  const blocks: Record<string, Block> = {};
  for (const n of nodes) {
    const b = (n.data as NodeData).block;
    const nb: Block = { ...b, position: n.position };
    // Единый источник правды о ветвящихся блоках: раньше локальный branching()
    // не знал про «Оплату» и затирал её next при сохранении.
    if (!usesBranches(b.type)) nb.next = outBySource.get(n.id)?.[0]?.target ?? '';
    blocks[b.id] = nb;
  }

  const startNode = nodes.find((n) => (n.data as NodeData).block.type === 'start');
  const sc: CanvasScenario = {
    version: 1,
    start: startId ?? startNode?.id ?? nodes[0]?.id ?? 'start',
    blocks,
  };
  // Пустой массив не сериализуем: сценарий без групп обязан оставаться
  // байт-в-байт прежним (старые боты, шаблоны, совместимость). Участники
  // фильтруются по живым блокам: удалённый блок не должен оставаться в группе.
  if (groups && groups.length) {
    const pruned = groups
      .map((g) => ({ ...g, members: g.members.filter((m) => blocks[m]) }))
      .filter((g) => g.members.length);
    if (pruned.length) sc.groups = pruned;
  }
  return sc;
}

// ---------------------------------------------------------------- structure hash

// Хэш по СОДЕРЖАНИЮ графа без позиций. Нужен, чтобы превью не сбрасывалось
// на каждое перетаскивание блока и чтобы история правок не пухла от движений мышью.
export function structuralHash(nodes: Node[], edges: Edge[]): string {
  const nodeParts: string[] = [];
  for (const n of nodes) {
    const b = (n.data as NodeData).block;
    nodeParts.push(`${b.id}|${b.type}|${JSON.stringify(b.params ?? {})}`);
  }
  nodeParts.sort();
  const edgeParts = edges
    .map((e) => `${e.source}>${e.target}${e.label ? `:${e.label}` : ''}`)
    .sort();
  return `${nodeParts.join(';')}#${edgeParts.join(',')}`;
}

// ---------------------------------------------------------------- auto layout

// Послойная раскладка от точки входа: BFS по рёбрам, уровень = столбец.
// Недостижимые блоки уезжают в правый столбец — их видно и можно починить.
export function autoLayout(nodes: Node[], edges: Edge[], startId: string): Node[] {
  if (!nodes.length) return nodes;
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }

  const level = new Map<string, number>();
  const queue: string[] = [];
  if (nodes.some((n) => n.id === startId)) {
    level.set(startId, 0);
    queue.push(startId);
  }
  while (queue.length) {
    const id = queue.shift() as string;
    for (const next of out.get(id) ?? []) {
      if (level.has(next)) continue;
      level.set(next, (level.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }

  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const lvl = level.get(n.id) ?? -1;
    const list = columns.get(lvl);
    if (list) list.push(n.id);
    else columns.set(lvl, [n.id]);
  }

  const COL = 300;
  const ROW = 150;
  const positions = new Map<string, { x: number; y: number }>();
  const sortedLevels = [...columns.keys()].sort((a, b) => a - b);
  for (const lvl of sortedLevels) {
    const ids = columns.get(lvl) as string[];
    ids.forEach((id, i) => {
      const column = lvl < 0 ? sortedLevels.length : lvl;
      positions.set(id, { x: 80 + column * COL, y: 80 + i * ROW });
    });
  }

  return nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }));
}

// ---------------------------------------------------------------- subgraph copy

export interface CopiedSubgraph {
  nodes: Node[];
  edges: Edge[];
}

// Копия выделения с восстановленными связями.
//
// Обычный copySubgraph обнуляет `next` (см. выше) — этого достаточно для
// «продублировать и дорисовать», но профи нужен вариант, где копия ведёт туда
// же, куда ведёт оригинал. Внутренние цели (внутри выделения) перенаправляются
// на копии, внешние остаются прежними. Чистая функция — покрыта тестом.
export function duplicateWithLinks(
  nodes: Node[],
  edges: Edge[],
  ids: string[]
): CopiedSubgraph {
  const copy = copySubgraph(nodes, edges, ids, 48);
  // copySubgraph выдаёт id по порядку ids, поэтому сопоставляем по индексу.
  // Внимание: порядок копий повторяет порядок `nodes`, а не `ids` — внутри
  // copySubgraph идёт проход по массиву узлов, поэтому строим тот же порядок.
  const idSet = new Set(ids);
  const orderedIds = nodes.filter((n) => idSet.has(n.id)).map((n) => n.id);
  const map = new Map<string, string>();
  orderedIds.forEach((oldId, i) => {
    const newNode = copy.nodes[i];
    if (newNode) map.set(oldId, newNode.id);
  });

  const restored = copy.nodes.map((n, i) => {
    const src = nodes.find((x) => x.id === orderedIds[i]);
    if (!src) return n;
    const sb = (src.data as NodeData).block;
    const cb = (n.data as NodeData).block;
    const branches: Record<string, string> = {};
    for (const [k, v] of Object.entries(sb.branches ?? {})) branches[k] = map.get(v) ?? v;
    return {
      ...n,
      data: {
        ...n.data,
        block: {
          ...cb,
          next: sb.next ? map.get(sb.next) ?? sb.next : '',
          branches: Object.keys(branches).length ? branches : undefined,
        },
      },
    };
  });

  // copySubgraph копирует только внутренние связи; внешние цели восстанавливаем
  // здесь, иначе копия окажется отрезанной от сценария.
  const internal = new Set(copy.edges.map((e) => `${e.source}>${e.target}`));
  const extra: Edge[] = [];
  for (const n of restored) {
    const b = (n.data as NodeData).block;
    if (b.next && !internal.has(`${n.id}>${b.next}`)) {
      extra.push({ id: `e-${n.id}-next`, source: n.id, target: b.next, sourceHandle: 'next' });
    }
    for (const [k, target] of Object.entries(b.branches ?? {})) {
      if (!target || internal.has(`${n.id}>${target}`)) continue;
      extra.push({
        id: `e-${n.id}-${k}`,
        source: n.id,
        target,
        sourceHandle: `branch:${k}`,
        label: k,
        animated: true,
        style: { stroke: '#f59e0b' },
      });
    }
  }

  return { nodes: restored, edges: [...copy.edges, ...extra] };
}

// Копирует выделение ВМЕСТЕ с внутренними связями: у старой версии копировался
// только один блок, и все связи приходилось тянуть заново.
export function copySubgraph(nodes: Node[], edges: Edge[], ids: string[], shift = 48): CopiedSubgraph {
  const idSet = new Set(ids);
  const idMap = new Map<string, string>();
  const now = Date.now().toString(36);
  let i = 0;
  for (const id of ids) idMap.set(id, `b_${now}_${(i++).toString(36)}`);

  const copiedNodes: Node[] = [];
  for (const n of nodes) {
    if (!idSet.has(n.id)) continue;
    const b = (n.data as NodeData).block;
    const newId = idMap.get(n.id) as string;
    copiedNodes.push({
      ...n,
      id: newId,
      selected: true,
      position: { x: n.position.x + shift, y: n.position.y + shift },
      data: {
        ...n.data,
        block: {
          ...b,
          id: newId,
          params: { ...b.params },
          branches: b.branches ? { ...b.branches } : undefined,
          next: '',
        },
      },
    });
  }

  const copiedEdges: Edge[] = [];
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    copiedEdges.push({
      ...e,
      id: `e-${idMap.get(e.source)}-${idMap.get(e.target)}-${e.label ?? 'next'}`,
      source: idMap.get(e.source) as string,
      target: idMap.get(e.target) as string,
    });
  }
  return { nodes: copiedNodes, edges: copiedEdges };
}

// ---------------------------------------------------------------- variables

export interface VarInfo {
  name: string;
  definedIn: { id: string; label: string }[];
  usedIn: { id: string; label: string }[];
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function varsInText(text: string): string[] {
  const found: string[] = [];
  if (!text) return found;
  for (const m of text.matchAll(VAR_RE)) found.push(m[1]);
  return found;
}

// Где переменная пишется — по типу блока.
function definedVar(b: Block): string | null {
  const p = b.params;
  switch (b.type) {
    case 'input':
      return p.var || null;
    case 'contact':
      return p.var || null;
    case 'setvar':
      return p.assignVar || null;
    case 'http':
      return p.outVar || null;
    case 'ai':
      return p.aiVar || null;
    case 'referral':
      return p.refVar || 'ref.link';
    case 'referral_stats':
      // Блок выставляет сразу несколько переменных — основной считается ref.count.
      return REF_COUNT_VAR;
    case 'referral_leaderboard':
      return REF_LEADERBOARD_VAR;
    case 'referral_verification':
      return REF_VERIFIED_VAR;
    case 'tag':
      // Тег выставляет переменную только когда показывает список.
      return p.tagOp === 'list' ? p.tagVar || 'tags' : null;
    default:
      return null;
  }
}

// Полный список переменных сценария: где определены и где читаются.
// Помогает находить опечатки в {{var}} до публикации.
export function collectVars(nodes: Node[], labelOf: (b: Block) => string): VarInfo[] {
  const map = new Map<string, VarInfo>();
  const touch = (name: string) => {
    let v = map.get(name);
    if (!v) {
      v = { name, definedIn: [], usedIn: [] };
      map.set(name, v);
    }
    return v;
  };

  for (const n of nodes) {
    const b = (n.data as NodeData).block;
    const label = labelOf(b);
    const written = definedVar(b);
    if (written) touch(written).definedIn.push({ id: b.id, label });
    for (const name of varsInText(JSON.stringify(b.params ?? {}))) {
      touch(name).usedIn.push({ id: b.id, label });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// ---------------------------------------------------------------- search

export interface SearchHit {
  id: string;
  label: string;
  snippet: string;
}

// Фрагмент JSON параметров вокруг совпадения: раньше snippet обрезал первые
// 120 символов, и у новых блоков (question, segmentText, reminderText,
// failMessage) совпавший текст часто не попадал в окно.
function snippetAround(json: string, q: string): string {
  const at = json.toLowerCase().indexOf(q);
  if (at === -1) return json.slice(0, 120);
  const start = Math.max(0, at - 40);
  const end = Math.min(json.length, at + q.length + 80);
  return `${start > 0 ? '…' : ''}${json.slice(start, end)}${end < json.length ? '…' : ''}`;
}

// Поиск по содержимому блоков: тип, подпись и все тексты параметров. Новые
// поля набора 2026-09 (question, segmentText, reminderText, failMessage)
// попадают сюда через JSON.stringify(params) автоматически.
export function searchBlocks(nodes: Node[], query: string, labelOf: (b: Block) => string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    const b = (n.data as NodeData).block;
    const label = labelOf(b);
    const paramsJson = JSON.stringify(b.params ?? {});
    const haystack = `${b.type} ${label} ${paramsJson}`.toLowerCase();
    const at = haystack.indexOf(q);
    if (at === -1) continue;
    hits.push({
      id: n.id,
      label,
      snippet: snippetAround(paramsJson, q),
    });
  }
  return hits.slice(0, 50);
}
