// §1/§2: бюджет шагов движка и защита от runaway-цикла.
//
// Ключевые отличия нового поведения от прежнего guard>200:
//  - MAX_ENGINE_STEPS = 1000 (shared/limits.ts), настраивается аргументом
//    maxSteps (пол — MIN_ENGINE_STEPS);
//  - исчерпание бюджета НЕ паркует сессию: в outs появляется trace
//    { kind: 'engine-budget-resume', resumeBlockId, vars } — воркер уносит
//    остаток потока в scheduled_sends;
//  - настоящий цикл A→B→A обрывается visit-guard'ом (LOOP_VISIT_GUARD=100)
//    с trace { kind: 'engine-loop-break', event: 'engine.loop.break.<id>' };
//  - foreach не считается runaway (реентерабельность по конструкции): цикл
//    на maxIterations итераций доходит до ветки done за один проход;
//  - цикл, прерванный бюджетом, оставляет trace engine.loop.deferred.<id>.<i>/<n>
//    и состояние __loop.<id> в vars — resume продолжит с той же итерации.
import { describe, expect, it } from 'vitest';
import { runEngine } from '../worker/src/engine';
import type { Scenario } from '../shared/types';
import { MAX_ENGINE_STEPS, LOOP_VISIT_GUARD } from '../shared/limits';

const msg = (text: string) => ({ message: { chat: { id: 1 }, from: { id: 1 }, text } });

// Линейная цепочка из N message-блоков: start → m0 → m1 → … → mN-1 → fin.
function chainScenario(n: number): Scenario {
  const blocks: Scenario['blocks'] = {
    s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm0' } as any,
  };
  for (let i = 0; i < n; i++) {
    blocks[`m${i}`] = {
      id: `m${i}`,
      type: 'message',
      params: { text: `шаг ${i}` },
      next: i + 1 < n ? `m${i + 1}` : 'fin',
    } as any;
  }
  blocks.fin = { id: 'fin', type: 'message', params: { text: 'ФИНИШ' } } as any;
  return { version: 1, start: 's', blocks };
}

describe('§1 бюджет шагов: 250-блочная цепочка', () => {
  it('250 блоков проходят за ОДИН проход целиком, без guardCutoff', async () => {
    const sc = chainScenario(250);
    const r = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    const texts = r.outs.filter((o) => o.method === 'sendMessage').map((o) => String(o.payload.text));
    expect(texts).toContain('шаг 0');
    expect(texts).toContain('шаг 249');
    expect(texts).toContain('ФИНИШ');
    expect(r.guardCutoff).toBeUndefined();
    expect(r.loopBreak).toBeUndefined();
    expect(r.currentBlock).toBeNull();
  });

  it('прежнее поведение было бы обрезано на 200: цепочка 990 блоков всё ещё целиком за один проход', async () => {
    // 990 message + start = 991 шаг < MAX_ENGINE_STEPS(1000).
    const sc = chainScenario(990);
    const r = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    expect(r.guardCutoff).toBeUndefined();
    const texts = r.outs.filter((o) => o.method === 'sendMessage').map((o) => String(o.payload.text));
    expect(texts).toContain('ФИНИШ');
  });

  it('цепочка длиннее бюджета: guardCutoff + trace engine-budget-resume с точкой продолжения и vars', async () => {
    const sc = chainScenario(1500);
    const r = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    expect(r.guardCutoff).toBe(true);
    expect(r.loopBreak).toBeUndefined();
    // currentBlock — блок, на котором бюджет кончился (не null, не «начало»).
    expect(typeof r.currentBlock).toBe('string');
    const marker = r.outs.find((o) => o.method === 'trace' && o.payload.kind === 'engine-budget-resume');
    expect(marker).toBeTruthy();
    expect(marker!.payload.resumeBlockId).toBe(r.currentBlock);
    expect(marker!.payload.event).toBe(`engine.budget.resume.${r.currentBlock}`);
    // Продолжение с точки обрыва доводит поток до конца.
    const r2 = await runEngine({
      scenario: sc,
      update: {},
      session: { currentBlock: null, vars: r.vars },
      startBlockId: r.currentBlock!,
    });
    const texts2 = r2.outs.filter((o) => o.method === 'sendMessage').map((o) => String(o.payload.text));
    expect(texts2).toContain('ФИНИШ');
  });

  it('maxSteps аргументом урезает бюджет, но не ниже MIN_ENGINE_STEPS', async () => {
    const sc = chainScenario(400);
    // maxSteps=50 < MIN_ENGINE_STEPS(200) → бюджет остаётся 200: цепочка 400
    // обрезается на ~200 шаге.
    const r = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} }, maxSteps: 50 });
    expect(r.guardCutoff).toBe(true);
    // maxSteps=300 (в пределах [200, …]) → цепочка 400 обрезана примерно на 300.
    const r2 = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} }, maxSteps: 300 });
    expect(r2.guardCutoff).toBe(true);
    const sent2 = r2.outs.filter((o) => o.method === 'sendMessage').length;
    expect(sent2).toBeLessThanOrEqual(301);
    expect(sent2).toBeGreaterThan(200);
  });

  it('MAX_ENGINE_STEPS и LOOP_VISIT_GUARD — константы единого источника', () => {
    expect(MAX_ENGINE_STEPS).toBe(1000);
    expect(LOOP_VISIT_GUARD).toBe(100);
  });
});

describe('§1 runaway-цикл: A → B → A без ожиданий', () => {
  const cycleScenario: Scenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'a' } as any,
      a: { id: 'a', type: 'message', params: { text: 'A' }, next: 'b' } as any,
      b: { id: 'b', type: 'message', params: { text: 'B' }, next: 'a' } as any,
    },
  };

  it('обрывается visit-guard с loopBreak + trace engine.loop.break.<blockId>, продолжение НЕ планируется', async () => {
    const r = await runEngine({ scenario: cycleScenario, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    expect(r.loopBreak).toBe(true);
    expect(r.loopBreakBlock).toBe('a');
    expect(r.guardCutoff).toBeUndefined();
    const marker = r.outs.find((o) => o.method === 'trace' && o.payload.kind === 'engine-loop-break');
    expect(marker).toBeTruthy();
    expect(marker!.payload.event).toBe('engine.loop.break.a');
    // Ключевое отличие от бюджета: никакого engine-budget-resume — цикл не
    // должен кормиться вечно через очередь.
    expect(r.outs.some((o) => o.method === 'trace' && o.payload.kind === 'engine-budget-resume')).toBe(false);
    // Цикл порвался ДО исчерпания бюджета 1000 шагов: сообщений меньше 2*100+1.
    const sent = r.outs.filter((o) => o.method === 'sendMessage').length;
    expect(sent).toBeLessThanOrEqual(2 * LOOP_VISIT_GUARD + 1);
    expect(sent).toBeGreaterThan(LOOP_VISIT_GUARD);
  });
});

describe('§2 foreach: заявленная вместимость = фактическая', () => {
  // Тело из 5 блоков: foreach → b1..b5 → (each) → обратно в foreach.
  function loopScenario(items: number, maxIterations?: number): Scenario {
    const blocks: Scenario['blocks'] = {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'seed' } as any,
      seed: {
        id: 'seed',
        type: 'setvar',
        params: { assignVar: 'items', expr: Array.from({ length: items }, (_, i) => `x${i}`).join(',') },
        next: 'fc',
      } as any,
      fc: {
        id: 'fc',
        type: 'foreach',
        params: { listVar: 'items', itemVar: 'item', indexVar: 'i', ...(maxIterations ? { maxIterations } : {}) },
        branches: { each: 'b1', done: 'fin' },
      } as any,
    };
    for (let i = 1; i <= 5; i++) {
      blocks[`b${i}`] = { id: `b${i}`, type: 'setvar', params: { assignVar: `v${i}`, expr: '1' }, next: i < 5 ? `b${i + 1}` : 'fc' } as any;
    }
    blocks.fin = { id: 'fin', type: 'message', params: { text: 'ГОТОВО' } } as any;
    return { version: 1, start: 's', blocks };
  }

  it('300 элементов, тело 5 блоков, maxIterations=300 — цикл завершается (за 1-2 прохода) и доходит до done', async () => {
    const sc = loopScenario(300, 300);
    // Первый проход: бюджет 1000 шагов, итерация ~6 шагов → ~166 итераций.
    const r1 = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    let vars = r1.vars;
    let current: string | null = r1.currentBlock;
    let guard = r1.guardCutoff ? 1 : 0;
    let doneSeen = r1.outs.some((o) => o.method === 'sendMessage' && o.payload.text === 'ГОТОВО');
    // Продолжения через resume-точку (как их сделал бы крон).
    while (!doneSeen && current && guard < 5) {
      const r = await runEngine({ scenario: sc, update: {}, session: { currentBlock: null, vars }, startBlockId: current });
      vars = r.vars;
      current = r.currentBlock;
      doneSeen = r.outs.some((o) => o.method === 'sendMessage' && o.payload.text === 'ГОТОВО');
      if (!r.guardCutoff) break;
      guard++;
    }
    expect(doneSeen).toBe(true);
    // Все 300 итераций выполнены: счётчик item дошёл до x299.
    expect(vars['item']).toBe('x299');
    // Состояние цикла удалено по ветке done.
    expect(vars['__loop.fc']).toBeUndefined();
    // «Несколько тиков крона» — не больше пары продолжений.
    expect(guard).toBeLessThanOrEqual(2);
  });

  it('прерванный бюджетом цикл оставляет trace engine.loop.deferred.<id>.<i>/<n> и __loop-состояние в vars', async () => {
    const sc = loopScenario(300, 300);
    const r = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    expect(r.guardCutoff).toBe(true);
    const deferred = r.outs.find((o) => o.method === 'trace' && o.payload.kind === 'loop-deferred');
    expect(deferred).toBeTruthy();
    expect(String(deferred!.payload.event)).toMatch(/^engine\.loop\.deferred\.fc\.\d+\/300$/);
    // Состояние цикла ПЕРЕЖИВАЕТ срез бюджета: resume продолжит с него же.
    const st = r.vars['__loop.fc'] as { index: number; items: unknown[] } | undefined;
    expect(st).toBeTruthy();
    expect(st!.index).toBeGreaterThan(100);
    expect(st!.items.length).toBe(300);
  });

  it('maxIterations по умолчанию (100) с телом 5 блоков доходит до done за один проход — visit-guard foreach не трогает', async () => {
    const sc = loopScenario(500); // maxIterations дефолт 100, элементов 500
    const r = await runEngine({ scenario: sc, update: msg('/start'), session: { currentBlock: null, vars: {} } });
    expect(r.guardCutoff).toBeUndefined();
    expect(r.loopBreak).toBeUndefined();
    expect(r.outs.some((o) => o.method === 'sendMessage' && o.payload.text === 'ГОТОВО')).toBe(true);
    // Ровно 100 итераций: индекс встал на maxIterations, items 500.
    expect(r.vars['i']).toBe(99);
  });
});
