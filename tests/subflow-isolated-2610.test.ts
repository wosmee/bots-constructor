// F-027 (аудит 18.10.2026): isolated-scope фрагмента переименовывал var-поля
// по неполному хардкод-списку — поля блоков набора 2026-10 (msgRefVar,
// editText-шаблоны, classifyOutVar, cancelVar, historyVar) оставались как есть,
// и «чёрный ящик»-фрагмент читал/писал переменные вызывающего сценария.
// Порт repro из tmp/audit-2026-10-18/s1/repro/s1-expr-subflow-repro.test.ts (P4).
import { describe, it, expect } from 'vitest';
import { expandSubflows, type SubflowLibrary } from '../shared/subflow';
import type { Scenario, Block } from '../shared/types';

function fragScenario(blocks: Record<string, Block>, start: string): Scenario {
  return { version: 1, start, blocks } as Scenario;
}

function expandWith(fragBlocks: Record<string, Block>, fragStart: string, alias = 'a') {
  const frag = fragScenario({ fr: { id: 'fr', type: 'subflow_return', params: {} } as Block, ...fragBlocks }, fragStart);
  const library: SubflowLibrary = {
    f1: { id: 'f1', name: 'F1', revision: 1, flow_json: frag, inputs: [], outputs: [] },
  };
  const sc = {
    version: 1,
    start: 'c1',
    blocks: {
      c1: { id: 'c1', type: 'subflow', params: { subflowId: 'f1', alias }, branches: { done: 'e', failed: 'e' } } as Block,
      e: { id: 'e', type: 'end', params: {} } as Block,
    },
  } as Scenario;
  return expandSubflows(sc, library);
}

const paramsOf = (scenario: Scenario, type: string) =>
  Object.values(scenario.blocks).find((b) => b.type === type)?.params as Record<string, unknown>;

describe('F-027: isolated-scope переименовывает var-поля набора 2026-10', () => {
  it('edit_message: msgRefVar и шаблоны {{…}} в editText уходят в пространство фрагмента', () => {
    const { scenario } = expandWith(
      {
        em: {
          id: 'em',
          type: 'edit_message',
          params: { msgRefVar: 'myref', editText: 'значение: {{myvar}}' },
          branches: { ok: 'fr', too_old: '', not_found: '' },
        } as Block,
      },
      'em'
    );
    const p = paramsOf(scenario, 'edit_message')!;
    expect(p.msgRefVar).toBe('sf.a.myref');
    expect(p.editText).toBe('значение: {{sf.a.myvar}}');
  });

  it('ai_classify: classifyOutVar и {{…}} в classifyInput/classifyPrompt переименованы', () => {
    const { scenario } = expandWith(
      {
        ac: {
          id: 'ac',
          type: 'ai_classify',
          params: { classifyLabels: ['да', 'нет'], classifyOutVar: 'label', classifyInput: '{{user_text}}', classifyPrompt: 'контекст {{ctx}}' },
        } as Block,
      },
      'ac'
    );
    const p = paramsOf(scenario, 'ai_classify')!;
    expect(p.classifyOutVar).toBe('sf.a.label');
    expect(p.classifyInput).toBe('{{sf.a.user_text}}');
    expect(p.classifyPrompt).toBe('контекст {{sf.a.ctx}}');
  });

  it('timer_deadline: cancelVar переименован, deadlineVar-шаблон и deadlineText переписаны', () => {
    const { scenario } = expandWith(
      {
        td: {
          id: 'td',
          type: 'timer_deadline',
          params: { deadlineVar: '{{due_date}}', cancelVar: 'paid', deadlineText: 'срок: {{due_date}}' },
          branches: { done: '', expired: '' },
        } as Block,
      },
      'td'
    );
    const p = paramsOf(scenario, 'timer_deadline')!;
    expect(p.cancelVar).toBe('sf.a.paid');
    expect(p.deadlineVar).toBe('{{sf.a.due_date}}');
    expect(p.deadlineText).toBe('срок: {{sf.a.due_date}}');
  });

  it('ai: historyVar переименован (память диалога остаётся внутри фрагмента)', () => {
    const { scenario } = expandWith(
      {
        ai: { id: 'ai', type: 'ai', params: { aiPrompt: 'спроси', aiVar: 'answer', historyVar: 'hist' } } as Block,
      },
      'ai'
    );
    const p = paramsOf(scenario, 'ai')!;
    expect(p.historyVar).toBe('sf.a.hist');
    expect(p.aiVar).toBe('sf.a.answer');
  });

  it('системные переменные (__bot_msg и др.) НЕ переименовываются', () => {
    const { scenario } = expandWith(
      {
        em: {
          id: 'em',
          type: 'edit_message',
          params: { msgRefVar: '__bot_msg', editText: 'привет' },
          branches: { ok: 'fr', too_old: '', not_found: '' },
        } as Block,
      },
      'em'
    );
    const p = paramsOf(scenario, 'edit_message')!;
    expect(p.msgRefVar).toBe('__bot_msg');
  });

  it('pinned-выход (объявленный output) остаётся в пространстве вызывающего', () => {
    const frag = fragScenario(
      {
        em: {
          id: 'em',
          type: 'edit_message',
          params: { msgRefVar: 'myref', editText: 'x' },
          branches: { ok: 'fr', too_old: '', not_found: '' },
        } as Block,
        fr: { id: 'fr', type: 'subflow_return', params: {} } as Block,
      },
      'em'
    );
    const library: SubflowLibrary = {
      f1: { id: 'f1', name: 'F1', revision: 1, flow_json: frag, inputs: [], outputs: [{ name: 'myref' }] },
    };
    const sc = {
      version: 1,
      start: 'c1',
      blocks: {
        c1: { id: 'c1', type: 'subflow', params: { subflowId: 'f1', alias: 'a' }, branches: { done: 'e', failed: 'e' } } as Block,
        e: { id: 'e', type: 'end', params: {} } as Block,
      },
    } as Scenario;
    const { scenario } = expandSubflows(sc, library);
    expect(paramsOf(scenario, 'edit_message')!.msgRefVar).toBe('myref');
  });
});
