// F-024 (аудит 18.10.2026): два subflow-вызова с одинаковым alias давали
// коллизию id sf:<alias>:* — второй фрагмент тихо затирал первый, issues
// оставались пустыми, публикация проходила. Порт repro из
// tmp/audit-2026-10-18/s1/s1-alias-minimal.test.ts: теперь детект — error.
import { describe, it, expect } from 'vitest';
import { expandSubflows, type SubflowLibrary } from '../shared/subflow';
import { validateScenario } from '../shared/validate';
import type { Scenario, Block } from '../shared/types';

function block(id: string, type: Block['type'], params: Block['params'] = {}, branches?: Block['branches'], next?: string): Block {
  return { id, type, params, ...(branches ? { branches } : {}), ...(next ? { next } : {}) } as Block;
}

const frag = (msgText: string): Scenario =>
  ({
    version: 1,
    start: 'fs',
    blocks: {
      fs: { id: 'fs', type: 'start', params: {}, next: 'fm' },
      fm: { id: 'fm', type: 'message', params: { text: msgText }, next: 'fr' },
      fr: { id: 'fr', type: 'subflow_return', params: {} },
    },
  }) as Scenario;

const library: SubflowLibrary = {
  f1: { id: 'f1', name: 'F1', revision: 1, flow_json: frag('ПЕРВЫЙ'), inputs: [], outputs: [] },
  f2: { id: 'f2', name: 'F2', revision: 1, flow_json: frag('ВТОРОЙ'), inputs: [], outputs: [] },
};

function twoCalls(alias1: string, alias2: string): Scenario {
  return {
    version: 1,
    start: 'c1',
    blocks: {
      c1: block('c1', 'subflow', { subflowId: 'f1', alias: alias1 }, { done: 'c2', failed: 'e' }),
      c2: block('c2', 'subflow', { subflowId: 'f2', alias: alias2 }, { done: 'e', failed: 'e' }),
      e: block('e', 'end', {}),
    },
  } as Scenario;
}

describe('F-024: дубль alias у subflow-вызовов', () => {
  it('одинаковый alias — error subflow-alias-dup на обоих блоках вызова', () => {
    const { issues } = expandSubflows(twoCalls('same', 'same'), library);
    const dups = issues.filter((i) => i.code === 'subflow-alias-dup');
    expect(dups.length).toBe(2);
    expect(dups.every((i) => i.level === 'error')).toBe(true);
    expect(dups.map((i) => i.blockId).sort()).toEqual(['c1', 'c2']);
    expect(dups[0].message).toContain('same');
  });

  it('при дубле второй вызов НЕ раскрывается: блоки ПЕРВОГО фрагмента целы', () => {
    const { scenario } = expandSubflows(twoCalls('same', 'same'), library);
    // Первый вызов остался раскрытым (его текст на месте, id не перезаписаны).
    const texts = Object.values(scenario.blocks)
      .map((b) => (b.params as any)?.text)
      .filter(Boolean);
    expect(texts).toContain('ПЕРВЫЙ');
    // Второй ушёл в ветку failed, а не затёр первый.
    expect(Object.values(scenario.blocks).some((b) => b.type === 'subflow')).toBe(false);
  });

  it('разные alias — ошибки нет, оба фрагмента раскрыты', () => {
    const { scenario, issues } = expandSubflows(twoCalls('one', 'two'), library);
    expect(issues.filter((i) => i.code === 'subflow-alias-dup')).toEqual([]);
    const texts = Object.values(scenario.blocks)
      .map((b) => (b.params as any)?.text)
      .filter(Boolean);
    expect(texts).toContain('ПЕРВЫЙ');
    expect(texts).toContain('ВТОРОЙ');
  });

  it('validateScenario с библиотекой показывает subflow-alias-dup как error', () => {
    const issues = validateScenario(twoCalls('same', 'same'), { subflows: library });
    const dup = issues.find((i) => i.code === 'subflow-alias-dup');
    expect(dup).toBeTruthy();
    expect(dup!.level).toBe('error');
  });
});
