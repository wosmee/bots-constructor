// Инспектор конфликтов (Промпт 2, TASK 10): новые формы веток набора 2026-09
// не должны давать ложных срабатываний, а отсутствие страховочных веток —
// предупреждение уровня warn (не error).
import { describe, expect, it } from 'vitest';
import { analyzeConflicts, conflictLevel, type Conflict } from '../web/src/conflicts';
import type { Block, BlockType, Scenario } from '../shared/types';

function sc(blocks: Block[], start = blocks[0]?.id ?? 'start'): Scenario {
  const rec: Record<string, Block> = {};
  for (const b of blocks) rec[b.id] = b;
  return { version: 1, start, blocks: rec };
}

function blk(id: string, type: BlockType, over: Partial<Block> = {}): Block {
  return { id, type, params: {}, ...over } as Block;
}

function end(id: string): Block {
  return blk(id, 'end');
}

const codes = (list: Conflict[], blockId?: string) =>
  list.filter((c) => !blockId || c.blockId === blockId).map((c) => c.code);

describe('analyzeConflicts: цикл foreach', () => {
  it('полный foreach (each + тело → foreach + done → end) — НЕ loop', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'loop' }),
      blk('loop', 'foreach', { branches: { each: 'body', done: 'after' } }),
      blk('body', 'message', { params: { text: 'item {{__loop.loop.value}}' }, next: 'loop' }),
      blk('after', 'message', { params: { text: 'готово' }, next: 'fin' }),
      end('fin'),
    ]);
    const out = analyzeConflicts(s);
    expect(codes(out)).not.toContain('loop');
    expect(out).toEqual([]);
  });

  it('foreach без done — dead-end не выдаёт (ветка each есть), но и loop нет', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'loop' }),
      blk('loop', 'foreach', { branches: { each: 'body' } }),
      blk('body', 'message', { params: { text: 'x' }, next: 'loop' }),
    ]);
    const out = analyzeConflicts(s);
    expect(codes(out)).not.toContain('loop');
  });

  it('настоящий мгновенный цикл без выхода — по-прежнему loop', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'a' }),
      blk('a', 'message', { params: { text: '1' }, next: 'b' }),
      blk('b', 'message', { params: { text: '2' }, next: 'a' }),
    ]);
    const out = analyzeConflicts(s);
    expect(codes(out, 'a')).toContain('loop');
  });
});

describe('analyzeConflicts: assert', () => {
  it('assert с обеими ветками — обычная развилка, конфликтов нет', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'as' }),
      blk('as', 'assert', { branches: { pass: 'ok', fail: 'bad' } }),
      blk('ok', 'message', { params: { text: 'ok' }, next: 'fin' }),
      blk('bad', 'message', { params: { text: 'bad' }, next: 'fin' }),
      end('fin'),
    ]);
    expect(analyzeConflicts(s)).toEqual([]);
  });

  it('assert с обеими ПУСТЫМИ ветками — dead-end error', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'as' }),
      blk('as', 'assert', { branches: { pass: '', fail: '' } }),
    ]);
    const out = analyzeConflicts(s);
    expect(codes(out, 'as')).toContain('dead-end');
    const deadEnd = out.find((c) => c.blockId === 'as' && c.code === 'dead-end')!;
    expect(conflictLevel(deadEnd)).toBe('error');
  });
});

describe('analyzeConflicts: warn-проверки набора 2026-09', () => {
  it('wait только с reply (timeout пуст) — warn wait-no-timeout', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'w' }),
      blk('w', 'wait', { params: { seconds: 60 }, branches: { reply: 'r' } }),
      blk('r', 'message', { params: { text: 'ок' }, next: 'fin' }),
      end('fin'),
    ]);
    const out = analyzeConflicts(s);
    const warn = out.find((c) => c.code === 'wait-no-timeout');
    expect(warn?.blockId).toBe('w');
    expect(conflictLevel(warn!)).toBe('warn');
    expect(warn!.key).toBe('conflict.waitNoTimeout');
  });

  it('wait с обеими ветками — предупреждения нет', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'w' }),
      blk('w', 'wait', { branches: { reply: 'r', timeout: 'to' } }),
      blk('r', 'message', { params: { text: '1' }, next: 'fin' }),
      blk('to', 'message', { params: { text: '2' }, next: 'fin' }),
      end('fin'),
    ]);
    expect(codes(analyzeConflicts(s))).not.toContain('wait-no-timeout');
  });

  it('payment_check с pending но БЕЗ failed — warn no-fail-path', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'pc' }),
      blk('pc', 'payment_check', { branches: { paid: 'ok', pending: 'pc' } }),
      blk('ok', 'message', { params: { text: 'спасибо' }, next: 'fin' }),
      end('fin'),
    ]);
    const out = analyzeConflicts(s);
    const warn = out.find((c) => c.code === 'no-fail-path');
    expect(warn?.blockId).toBe('pc');
    expect(conflictLevel(warn!)).toBe('warn');
  });

  it('payment_check со всеми тремя ветками — чисто', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'pc' }),
      blk('pc', 'payment_check', { branches: { paid: 'ok', pending: 'pc', failed: 'bad' } }),
      blk('ok', 'message', { params: { text: '1' }, next: 'fin' }),
      blk('bad', 'message', { params: { text: '2' }, next: 'fin' }),
      end('fin'),
    ]);
    expect(codes(analyzeConflicts(s))).not.toContain('no-fail-path');
  });

  it('segment_broadcast с пустой веткой empty — warn broadcast-empty', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'sb' }),
      blk('sb', 'segment_broadcast', { params: { segmentTag: 'vip' }, branches: { queued: 'ok' } }),
      blk('ok', 'message', { params: { text: 'в очереди' }, next: 'fin' }),
      end('fin'),
    ]);
    const out = analyzeConflicts(s);
    const warn = out.find((c) => c.code === 'broadcast-empty');
    expect(warn?.blockId).toBe('sb');
    expect(conflictLevel(warn!)).toBe('warn');
    // Это НЕ ошибка: публикация и валидатор не должны блокироваться.
    expect(out.every((c) => conflictLevel(c) !== 'error')).toBe(true);
  });
});

describe('analyzeConflicts: регрессии старых кодов', () => {
  it('мёртвый конец message-блока — по-прежнему dead-end error', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'm' }),
      blk('m', 'message', { params: { text: 'привет' } }),
    ]);
    const out = analyzeConflicts(s);
    const deadEnd = out.find((c) => c.code === 'dead-end');
    expect(deadEnd?.blockId).toBe('m');
    expect(conflictLevel(deadEnd!)).toBe('error');
  });

  it('недостижимый блок — unreachable', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'fin' }),
      end('fin'),
      blk('orphan', 'message', { params: { text: 'x' }, next: 'fin' }),
    ]);
    expect(codes(analyzeConflicts(s), 'orphan')).toContain('unreachable');
  });

  it('два триггера на одну команду — dup-trigger', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'fin' }),
      blk('cmd', 'command', { params: { command: '/start' }, next: 'fin' }),
      end('fin'),
    ]);
    expect(codes(analyzeConflicts(s), 'cmd')).toContain('dup-trigger');
  });

  it('замороженный блок (disabled) не даёт warn-конфликтов', () => {
    const s = sc([
      blk('start', 'start', { params: { command: '/start' }, next: 'w' }),
      blk('w', 'wait', { params: { disabled: true }, branches: { reply: 'r' } }),
      blk('r', 'message', { params: { text: 'ок' }, next: 'fin' }),
      end('fin'),
    ]);
    expect(codes(analyzeConflicts(s))).not.toContain('wait-no-timeout');
  });
});
