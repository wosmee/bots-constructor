// Валидатор и подсценарии (TASK 5): авторский вид сценария проверяется без
// библиотеки (структура вызова) и с библиотекой (dangling/чужие/циклы/входы).
// Граф: вызов — обычный узел с ветками done/failed; внутренние блоки фрагмента
// не «недостижимы» в боте; два вызова одного фрагмента — не цикл.
import { describe, expect, it } from 'vitest';
import { validateScenario, countIssues } from '../shared/validate';
import { reachableFrom, findCycles } from '../shared/graph';
import type { Scenario, Block } from '../shared/types';
import type { SubflowLibrary } from '../shared/subflow';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function scenarioOf(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks };
}

const msg = (id: string, text: string, next?: string): Block => ({ id, type: 'message', params: { text }, ...(next ? { next } : {}) });

function libraryOf(entries: Record<string, { scenario: Scenario; revision?: number; inputs?: any[]; outputs?: any[] }>): SubflowLibrary {
  const out: SubflowLibrary = {};
  for (const [id, e] of Object.entries(entries)) {
    out[id] = {
      id,
      name: id,
      revision: e.revision ?? 1,
      flow_json: e.scenario,
      inputs: e.inputs ?? [],
      outputs: e.outputs ?? [],
    };
  }
  return out;
}

const frag = (extra?: Record<string, Block>): Scenario =>
  scenarioOf(
    {
      fm: msg('fm', 'меню', 'fr'),
      fr: { id: 'fr', type: 'subflow_return', params: {} },
      ...(extra ?? {}),
    },
    'fm'
  );

function botWithCall(params: Record<string, unknown>, branches?: Record<string, string>): Scenario {
  return scenarioOf({
    s: { id: 's', type: 'start', params: { command: '/start' }, next: 'cs' },
    cs: { id: 'cs', type: 'subflow', params: params as any, branches: branches ?? { done: 'e', failed: 'err' } },
    err: msg('err', 'сбой', 'e'),
    e: { id: 'e', type: 'end', params: {} },
  });
}

describe('validateScenario: подсценарии (авторский вид)', () => {
  it('вызов без subflowId — ошибка subflow-id', () => {
    const issues = validateScenario(botWithCall({}));
    expect(codes(issues)).toContain('subflow-id');
  });

  it('незаполненные ветки — ошибка subflow-branches (обе)', () => {
    const issues = validateScenario(botWithCall({ subflowId: 'f' }, { done: 'e', failed: '' }));
    const br = issues.filter((i) => i.code === 'subflow-branches');
    expect(br.length).toBe(1);
    expect(br[0].blockId).toBe('cs');
  });

  it('subflow_return в сценарии бота — ошибка subflow-return-outside', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'r' },
      r: { id: 'r', type: 'subflow_return', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('subflow-return-outside');
  });

  it('subflow_return во фрагменте (isFragment) — НЕ ошибка', () => {
    const sc = frag();
    const issues = validateScenario(sc, { isFragment: true });
    expect(codes(issues)).not.toContain('subflow-return-outside');
  });

  it('dangling-ссылка с библиотекой — subflow-missing на блоке вызова', () => {
    const issues = validateScenario(botWithCall({ subflowId: 'gone' }), { subflows: libraryOf({}) });
    const miss = issues.find((i) => i.code === 'subflow-missing');
    expect(miss).toBeTruthy();
    expect(miss!.blockId).toBe('cs');
  });

  it('чужой фрагмент (нет в библиотеке владельца) — тоже subflow-missing', () => {
    // Библиотека грузится по owner_id: чужой фрагмент в неё не попадает,
    // поэтому для валидатора это обычная dangling-ссылка.
    const issues = validateScenario(botWithCall({ subflowId: 'foreign-id' }), {
      subflows: libraryOf({ mine: { scenario: frag() } }),
    });
    expect(codes(issues)).toContain('subflow-missing');
  });

  it('обязательный вход не привязан — subflow-input с именем входа', () => {
    const lib = libraryOf({ f: { scenario: frag(), inputs: [{ name: 'who', required: true }] } });
    const issues = validateScenario(botWithCall({ subflowId: 'f', inputs: {} }), { subflows: lib });
    const err = issues.find((i) => i.code === 'subflow-input');
    expect(err).toBeTruthy();
    expect(err!.message).toContain('who');
    expect(err!.blockId).toBe('cs');
  });

  it('закреплённая несуществующая ревизия — ошибка subflow-revision', () => {
    const lib = libraryOf({ f: { scenario: frag(), revision: 2 } });
    const issues = validateScenario(botWithCall({ subflowId: 'f', subflowRevision: 99 }), { subflows: lib });
    expect(codes(issues)).toContain('subflow-revision');
  });

  it('устаревшая, но существующая ревизия — предупреждение subflow-outdated, публикация не блокируется', () => {
    const lib = libraryOf({ f: { scenario: frag(), revision: 2 } });
    lib.f.revisions = { 1: { flow_json: frag(), inputs: [], outputs: [] } };
    const issues = validateScenario(botWithCall({ subflowId: 'f', subflowRevision: 1, inputs: {} }), { subflows: lib });
    const warn = issues.find((i) => i.code === 'subflow-outdated');
    expect(warn).toBeTruthy();
    expect(warn!.level).toBe('warn');
    expect(countIssues(issues).errors).toBe(0);
  });

  it('корректный вызов с библиотекой — ошибок нет', () => {
    const lib = libraryOf({ f: { scenario: frag() } });
    const issues = validateScenario(botWithCall({ subflowId: 'f', alias: 'a' }), { subflows: lib });
    expect(countIssues(issues).errors).toBe(0);
  });
});

describe('graph: подсценарии не ломают обходы', () => {
  it('вызов — обычный узел: reachableFrom идёт по веткам done/failed, внутрь фрагмента не заходит', () => {
    const sc = botWithCall({ subflowId: 'f' });
    const reach = reachableFrom(sc, ['s']);
    expect(reach.has('cs')).toBe(true);
    expect(reach.has('e')).toBe(true);
    expect(reach.has('err')).toBe(true);
    // id внутренних блоков фрагмента в боте не существуют.
    expect(reach.has('fm')).toBe(false);
  });

  it('два вызова одного фрагмента — НЕ цикл', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'c1' },
      c1: { id: 'c1', type: 'subflow', params: { subflowId: 'f' }, branches: { done: 'c2', failed: 'e' } },
      c2: { id: 'c2', type: 'subflow', params: { subflowId: 'f' }, branches: { done: 'e', failed: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(findCycles(sc)).toEqual([]);
  });

  it('вызов — ветвящийся блок: dead-end не репортится, тупик ветки failed проверяется как обычно', () => {
    const sc = botWithCall({ subflowId: 'f' });
    const issues = validateScenario(sc, { subflows: libraryOf({ f: { scenario: frag() } }) });
    expect(codes(issues)).not.toContain('dead-end');
  });
});
