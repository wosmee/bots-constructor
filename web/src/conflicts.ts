// Инспектор конфликтов: статический анализ графа прямо на клиенте.
// Никаких запросов к бэку — считаем по уже загруженному сценарию.
import { Scenario } from '../../shared/types';
// Обход графа живёт в shared: раньше он был продублирован здесь и расходился с
// валидатором (здесь не было блока «Оплата» — корректный цикл через него
// помечался как бесконечный).
import { outTargets, reachableFrom, findCycles, breaksInstantLoop } from '../../shared/graph';
import type { TKey } from './i18n';

export type ConflictCode =
  | 'dup-trigger'
  | 'unreachable'
  | 'loop'
  | 'dead-end'
  // предупреждения набора 2026-09: сценарий рабочеспособен, но ветка-страховка
  // не нарисована. Это НЕ ошибки: тег сегмента может не поймать никого, а
  // payment_check почти всегда доходит до paid.
  | 'no-fail-path'
  | 'wait-no-timeout'
  | 'broadcast-empty';

export type ConflictLevel = 'error' | 'warn';

export interface Conflict {
  blockId: string;
  code: ConflictCode;
  key: TKey; // строка берётся из словаря i18n в момент отрисовки
  vars?: Record<string, string | number>;
  /** undefined = 'error' — старые коды не меняют поведение. */
  level?: ConflictLevel;
}

export function conflictLevel(c: Conflict): ConflictLevel {
  return c.level === 'warn' ? 'warn' : 'error';
}

function normalizeCommand(cmd: string): string {
  return (cmd || '').trim().replace(/^\//, '').replace(/@.*$/, '').toLowerCase();
}

export function analyzeConflicts(sc: Scenario): Conflict[] {
  const blocks = sc?.blocks ?? {};
  const ids = Object.keys(blocks);
  const conflicts: Conflict[] = [];
  if (!ids.length) return conflicts;

  const live = (id: string) => {
    const b = blocks[id];
    return !!b && !b.params?.disabled && b.type !== 'note';
  };

  // 1. два триггера на одно и то же слово / команду
  const cmdOwners = new Map<string, string[]>();
  for (const id of ids) {
    const b = blocks[id];
    if (!live(id)) continue;
    if (b.type !== 'start' && b.type !== 'command') continue;
    const cmd = normalizeCommand(b.params.command || '');
    if (!cmd) continue;
    const list = cmdOwners.get(cmd) ?? [];
    list.push(id);
    cmdOwners.set(cmd, list);
  }
  const wordOwners = new Map<string, string[]>();
  for (const id of ids) {
    const b = blocks[id];
    if (!live(id) || b.type !== 'keyword') continue;
    for (const w of (b.params.keywords || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      const list = wordOwners.get(w) ?? [];
      list.push(id);
      wordOwners.set(w, list);
    }
  }
  const reportDup = (owners: Map<string, string[]>, value: (v: string) => string) => {
    for (const [v, list] of owners) {
      if (list.length < 2) continue;
      for (const id of list) {
        conflicts.push({ blockId: id, code: 'dup-trigger', key: 'conflict.dupTrigger', vars: { value: value(v) } });
      }
    }
  };
  reportDup(cmdOwners, (v) => `/${v}`);
  reportDup(wordOwners, (v) => v);

  // 2. недостижимые блоки
  const roots = ids.filter((id) => blocks[id].type === 'start' || blocks[id].type === 'command');
  if (sc.start && blocks[sc.start]) roots.push(sc.start);
  const seen = reachableFrom(sc, roots);
  for (const id of ids) {
    if (seen.has(id) || !live(id)) continue;
    conflicts.push({ blockId: id, code: 'unreachable', key: 'conflict.unreachable' });
  }

  // 3. зацикленные пути без выхода
  for (const cycle of findCycles(sc)) {
    const set = new Set(cycle);
    const hasExit = cycle.some((id) => outTargets(blocks[id]).some((t) => !set.has(t)));
    // breaksInstantLoop, а не isWaitBlock: цикл «тело → foreach» конечен по
    // построению (индекс и лимит итераций), поэтому бесконечным он не считается.
    const hasWait = cycle.some((id) => breaksInstantLoop(blocks[id]));
    if (hasExit || hasWait) continue; // нормальный цикл: есть выход или ожидание ввода
    for (const id of cycle) conflicts.push({ blockId: id, code: 'loop', key: 'conflict.loop' });
  }

  // 4. блок без исходящего выхода
  for (const id of ids) {
    const b = blocks[id];
    if (!live(id) || b.type === 'end') continue;
    if (outTargets(b).length) continue;
    conflicts.push({ blockId: id, code: 'dead-end', key: 'conflict.deadEnd' });
  }

  // 5. предупреждения набора 2026-09: страховочные ветки не нарисованы.
  // Это не ошибки — сценарий работоспособен, но автору стоит знать:
  //  - wait без timeout зависнет навсегда, если пользователь не ответит;
  //  - payment_check без failed не заметит отмену платежа;
  //  - segment_broadcast с пустой empty веткой молча остановится, если сегмент пуст.
  // Полностью пустые блоки сюда не попадают: их уже ловит dead-end (п. 4).
  for (const id of ids) {
    const b = blocks[id];
    if (!live(id)) continue;
    const branches = b.branches ?? {};
    if (b.type === 'wait' && branches.reply && !branches.timeout) {
      conflicts.push({ blockId: id, code: 'wait-no-timeout', key: 'conflict.waitNoTimeout', level: 'warn' });
    } else if (b.type === 'payment_check' && branches.pending && !branches.failed) {
      conflicts.push({ blockId: id, code: 'no-fail-path', key: 'conflict.noFailPath', level: 'warn' });
    } else if (b.type === 'segment_broadcast' && branches.queued && !branches.empty) {
      conflicts.push({ blockId: id, code: 'broadcast-empty', key: 'conflict.broadcastEmpty', level: 'warn' });
    }
  }

  return conflicts;
}

export function groupConflicts(conflicts: Conflict[]): Map<string, Conflict[]> {
  const map = new Map<string, Conflict[]>();
  for (const c of conflicts) {
    const list = map.get(c.blockId) ?? [];
    list.push(c);
    map.set(c.blockId, list);
  }
  return map;
}

// Ветка, которую нужно подсветить в режиме «сон»: от блока по связям вперёд.
export function branchFrom(sc: Scenario, startId: string | null): Set<string> {
  const out = new Set<string>();
  if (!startId || !sc?.blocks?.[startId]) return out;
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    const b = sc.blocks[id];
    if (!b) continue;
    for (const t of outTargets(b)) if (!out.has(t)) queue.push(t);
  }
  return out;
}
