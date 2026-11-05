// Обход графа сценария: общий код для валидатора (воркер) и инспектора
// конфликтов (фронт). Раньше reachableFrom/findCycles/WAIT_TYPES жили двумя
// копиями и расходились: конфликты не знали про блок «Оплата» и помечали
// корректный цикл через него как бесконечный.
import { Scenario, Block, BlockType, REFERRAL_BLOCK_TYPES } from './types';

// ------------------------------------------------------------------ content hash

// Стабильная сериализация: ключи объектов сортируются, поэтому один и тот же
// сценарий даёт одну и ту же строку независимо от порядка полей.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// FNV-1a 32-bit — дешёвый и достаточный, чтобы отличить «сценарий изменился»
// от «просто подвинули блок».
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Содержимое сценария без координат блоков: перетаскивание мышью хэш не меняет.
export function scenarioContentHash(sc: Scenario): string {
  const blocks: Record<string, unknown> = {};
  for (const [id, b] of Object.entries(sc?.blocks ?? {})) {
    const { position: _ignored, ...rest } = b;
    blocks[id] = rest;
  }
  return fnv1a(stableStringify({ start: sc?.start ?? '', blocks }));
}

// То же самое, но по сырому JSON из базы. Невалидный JSON не роняет вызывающего:
// хэш считается по строке как есть (тогда он просто всегда разный).
export function jsonContentHash(flowJson: string): string {
  try {
    return scenarioContentHash(JSON.parse(flowJson) as Scenario);
  } catch {
    return `raw:${fnv1a(flowJson)}`;
  }
}

// Есть ли в сценарии блок реферальной системы. Считать по типу блока, а не
// подстрокой в JSON: иначе любое слово referral в тексте сообщения включает
// лишние запросы к D1 на каждое входящее сообщение.
export function scenarioHasReferral(sc: Scenario | null | undefined): boolean {
  if (!sc?.blocks) return false;
  for (const b of Object.values(sc.blocks)) if (REFERRAL_BLOCK_TYPES.includes(b.type)) return true;
  return false;
}

// Блоки, после которых бот ждёт действий пользователя — они разрывают
// «мгновенный» цикл, поэтому цикл через них не считается бесконечным.
// `wait` и `poll` ждут ответа явно (таймаут/ответ на опрос), `channel_check` и
// `payment_check` ходят наружу и получают ответ только следующим апдейтом.
export const WAIT_TYPES: BlockType[] = [
  'input',
  'buttons',
  'menu',
  'keyword',
  'contact',
  'end',
  'invoice',
  'wait',
  'poll',
  'channel_check',
  'payment_check',
];

// Все исходящие связи блока: next + ветки + цель goto.
export function outTargets(b: Block): string[] {
  const out: string[] = [];
  if (b.next) out.push(b.next);
  if (b.branches) for (const v of Object.values(b.branches)) if (v) out.push(v);
  if (b.type === 'goto' && b.params.target) out.push(b.params.target);
  return out;
}

// Блок стоит в ожидании ввода (либо сам ждёт, либо это пауза — она разрывает цикл).
export function isWaitBlock(b: Block | undefined): boolean {
  if (!b) return false;
  if (WAIT_TYPES.includes(b.type)) return true;
  return !!(b.params?.actionKind === 'delay' && b.params?.seconds);
}

// Цикл «тело → foreach» — это НЕ бесконечный цикл: foreach перебирает список
// конечной длины, хранит индекс в переменных и жёстко ограничен лимитом
// (maxIterations, потолок 500). Каждая итерация возвращается в foreach как
// отдельный вход, поэтому ребро выглядит как цикл, но завершается по `done`.
// Отдельная функция, чтобы правило было видно и в валидаторе, и в инспекторе
// конфликтов (оба ходят через shared/graph.ts).
export function isLoopBlock(b: Block | undefined): boolean {
  return !!b && b.type === 'foreach';
}

// Разрывает ли блок «мгновенный» цикл: ждёт пользователя, пауза или foreach.
export function breaksInstantLoop(b: Block | undefined): boolean {
  return isWaitBlock(b) || isLoopBlock(b);
}

// Размер тела цикла foreach: сколько блоков движок проходит между повторными
// входами в сам цикл (включая foreach-блок). Одна итерация стоит bodySize + 1
// шагов бюджета прохода, поэтому валидатор использует размер тела, чтобы
// подсказка maxIterations говорила правду о вместимости одного прохода
// (shared/limits.ts: foreachPassCapacity). Обход в глубину по всем исходящим
// связям с защитой от циклов; ответвления веток считаются — движок может
// пройти любое из них, оценка сверху честнее оценки снизу.
export function foreachBodySize(sc: Scenario, foreachId: string): number {
  const blocks = sc.blocks;
  const visited = new Set<string>([foreachId]);
  const stack: string[] = [];
  const each = blocks[foreachId]?.branches?.each;
  if (each) stack.push(each);
  while (stack.length) {
    const id = stack.pop() as string;
    if (visited.has(id)) continue;
    const b = blocks[id];
    if (!b) continue;
    visited.add(id);
    for (const t of outTargets(b)) if (!visited.has(t)) stack.push(t);
  }
  return visited.size;
}

// BFS от корней: какие блоки достижимы.
export function reachableFrom(sc: Scenario, roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    const b = sc.blocks[id];
    if (!b) continue;
    seen.add(id);
    for (const t of outTargets(b)) if (!seen.has(t)) queue.push(t);
  }
  return seen;
}

// Простые циклы графа (DFS со стеком пути). Один и тот же набор узлов
// возвращается один раз — порядок в ключе не важен.
export function findCycles(sc: Scenario): string[][] {
  const blocks = sc.blocks;
  const loops: string[][] = [];
  const seenLoops = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>(); // 0 — не начат, 1 — на стеке, 2 — готов
  const path: string[] = [];

  const walk = (id: string) => {
    if (state.get(id) === 1) {
      const start = path.indexOf(id);
      const cycle = start >= 0 ? path.slice(start) : [];
      if (cycle.length) {
        const key = [...cycle].sort().join('>');
        if (!seenLoops.has(key)) {
          seenLoops.add(key);
          loops.push(cycle);
        }
      }
      return;
    }
    if (state.get(id) === 2) return;
    if (!blocks[id]) return;
    state.set(id, 1);
    path.push(id);
    for (const t of outTargets(blocks[id])) walk(t);
    path.pop();
    state.set(id, 2);
  };

  for (const id of Object.keys(blocks)) walk(id);
  return loops;
}
