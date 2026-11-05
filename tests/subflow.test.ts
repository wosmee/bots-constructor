// Подсценарии (subflows): расширяющий компилятор shared/subflow.ts.
// TDD: тесты написаны ДО реализации. Ключевые инварианты:
//  - детерминизм (одинаковый вход -> одинаковый хэш),
//  - неизменяемость авторского сценария,
//  - изоляция переменных (кроме объявленных выходов и системных имён),
//  - лимиты глубины/размера — ошибка, а не тихое усечение,
//  - ошибки несут id БЛОКА ВЫЗОВА в авторском сценарии.
import { describe, expect, it } from 'vitest';
import {
  expandSubflows,
  selectionIo,
  SUBFLOW_MAX_BLOCKS,
  type SubflowLibrary,
} from '../shared/subflow';
import { scenarioContentHash, findCycles } from '../shared/graph';
import { SUBFLOW_ID_PREFIX, type Scenario, type Block } from '../shared/types';

// ------------------------------------------------------------------ helpers

const msgBlock = (id: string, text: string, next?: string): Block => ({
  id,
  type: 'message',
  params: { text },
  ...(next ? { next } : {}),
});

function fragScenario(blocks: Record<string, Block>, start: string): Scenario {
  return { version: 1, start, blocks };
}

function lib(entries: Record<string, { name?: string; revision?: number; scenario: Scenario; inputs?: any[]; outputs?: any[] }>): SubflowLibrary {
  const out: SubflowLibrary = {};
  for (const [id, e] of Object.entries(entries)) {
    out[id] = {
      id,
      name: e.name ?? id,
      revision: e.revision ?? 1,
      flow_json: e.scenario,
      inputs: e.inputs ?? [],
      outputs: e.outputs ?? [],
    };
  }
  return out;
}

// Сценарий: start -> subflow(cs) -> after; ветки done/failed заданы.
function callerWith(csParams: Record<string, unknown>): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'cs' },
      cs: {
        id: 'cs',
        type: 'subflow',
        params: csParams as any,
        branches: { done: 'after', failed: 'failmsg' },
      },
      after: msgBlock('after', 'после'),
      failmsg: msgBlock('failmsg', 'провал'),
    },
  };
}

describe('expandSubflows — ядро', () => {
  it('a) фрагмент из 3 блоков, вызванный дважды с разными alias -> 6 блоков, id не пересекаются', () => {
    const frag = fragScenario(
      {
        f1: msgBlock('f1', 'шаг1', 'f2'),
        f2: msgBlock('f2', 'шаг2', 'f3'),
        f3: { id: 'f3', type: 'subflow_return', params: {} },
      },
      'f1'
    );
    const library = lib({ menu: { scenario: frag } });
    const sc: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'c1' },
        c1: { id: 'c1', type: 'subflow', params: { subflowId: 'menu', alias: 'a' }, branches: { done: 'c2', failed: 'x' } },
        c2: { id: 'c2', type: 'subflow', params: { subflowId: 'menu', alias: 'b' }, branches: { done: 'e', failed: 'x' } },
        x: msgBlock('x', 'ошибка'),
        e: { id: 'e', type: 'end', params: {} },
      },
    };
    const { scenario, issues } = expandSubflows(sc, library);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    // Два вызова по 3 блока = 6 развёрнутых, префикс sf: у каждого.
    const expandedIds = Object.keys(scenario.blocks).filter((id) => id.startsWith(SUBFLOW_ID_PREFIX));
    expect(expandedIds.length).toBe(6);
    expect(new Set(expandedIds).size).toBe(6);
    expect(expandedIds).toContain(`${SUBFLOW_ID_PREFIX}a:f1`);
    expect(expandedIds).toContain(`${SUBFLOW_ID_PREFIX}b:f1`);
    // Продолжение: done первого вызова ведёт во вход второго вызова, done второго — в end.
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}a:f3`].next).toBe(`${SUBFLOW_ID_PREFIX}b:f1`);
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}b:f3`].next).toBe('e');
    // Блоков subflow в результате не осталось.
    expect(Object.values(scenario.blocks).some((b) => b.type === 'subflow' || b.type === 'subflow_return')).toBe(false);
  });

  it('b) вход используется и в шаблоне сообщения, и в условии — связан в обоих местах', () => {
    const frag = fragScenario(
      {
        f1: msgBlock('f1', 'Привет, {{name}}!', 'f2'),
        f2: {
          id: 'f2',
          type: 'condition',
          params: { condVar: 'name', op: '==', condValue: 'Илья' },
          branches: { then: 'r1', else: 'r2' },
        },
        r1: { id: 'r1', type: 'subflow_return', params: {} },
        r2: { id: 'r2', type: 'subflow_return', params: {} },
      },
      'f1'
    );
    const library = lib({ greet: { scenario: frag, inputs: [{ name: 'name', required: true }] } });
    const sc = callerWith({ subflowId: 'greet', alias: 'g', inputs: { name: '{{user_name}}' } });
    const { scenario, issues } = expandSubflows(sc, library);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    const prologueId = `${SUBFLOW_ID_PREFIX}g:in_name`;
    // Пролог присваивает переменной входа выражение вызывающего.
    expect(scenario.blocks[prologueId]).toBeTruthy();
    expect(scenario.blocks[prologueId].params.assignVar).toBe('sf.g.name');
    expect(scenario.blocks[prologueId].params.expr).toBe('{{user_name}}');
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}g:f1`].params.text).toBe('Привет, {{sf.g.name}}!');
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}g:f2`].params.condVar).toBe('sf.g.name');
    // Точка входа сценария ведёт в пролог входов (блок вызова заменён).
    expect(scenario.blocks['s'].next).toBe(prologueId);
    expect(scenario.blocks[prologueId].next).toBe(`${SUBFLOW_ID_PREFIX}g:f1`);
  });

  it('c) два объявленных выхода видны вызывающему, внутренние переменные — в пространстве имён sf:', () => {
    const frag = fragScenario(
      {
        f1: { id: 'f1', type: 'setvar', params: { assignVar: 'tmp', expr: '1' }, next: 'f2' },
        f2: { id: 'f2', type: 'setvar', params: { assignVar: 'total', expr: '{{tmp}} + 1' }, next: 'r' },
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'f1'
    );
    const library = lib({ calc: { scenario: frag, outputs: [{ name: 'total' }, { name: 'tmp2' }] } });
    // Второй выход tmp2: фрагмент пишет его в return-блоке явным маппингом.
    library.calc.outputs = [{ name: 'total' }, { name: 'tmp2' }];
    frag.blocks.r.params.outputs = { tmp2: '{{tmp}} * 10' };
    const sc = callerWith({ subflowId: 'calc', alias: 'c' });
    const { scenario, issues } = expandSubflows(sc, library);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    // Объявленный выход total НЕ переименован — вызывающий читает {{total}}.
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}c:f2`].params.assignVar).toBe('total');
    // Внутренняя tmp переименована.
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}c:f1`].params.assignVar).toBe('sf.c.tmp');
    // ...и её переименованное значение читается следующим блоком фрагмента.
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}c:f2`].params.expr).toBe('{{sf.c.tmp}} + 1');
    // Явный выход tmp2 из return-блока: присвоение в пространство вызывающего.
    const outBlocks = Object.values(scenario.blocks).filter(
      (b) => b.type === 'setvar' && b.params.assignVar === 'tmp2'
    );
    expect(outBlocks.length).toBe(1);
    expect(outBlocks[0].params.expr).toBe('{{sf.c.tmp}} * 10');
  });

  it('d) scope shared: внутренняя переменная доступна вызывающему как есть', () => {
    const frag = fragScenario(
      {
        f1: { id: 'f1', type: 'setvar', params: { assignVar: 'tmp', expr: '7' }, next: 'r' },
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'f1'
    );
    const library = lib({ sh: { scenario: frag } });
    const sc = callerWith({ subflowId: 'sh', alias: 's1', scope: 'shared' });
    const { scenario, issues } = expandSubflows(sc, library);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}s1:f1`].params.assignVar).toBe('tmp');
  });

  it('e) last_input и __menu внутри фрагмента НЕ переименовываются в isolated', () => {
    const frag = fragScenario(
      {
        f1: msgBlock('f1', 'Вы написали: {{last_input}}', 'f2'),
        f2: { id: 'f2', type: 'setvar', params: { assignVar: '__menu', expr: 'x' }, next: 'f3' },
        f3: msgBlock('f3', 'меню {{__menu}} / ref {{ref.count}} / pay {{pay.order}} / poll {{poll.answer}}', 'r'),
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'f1'
    );
    const library = lib({ sys: { scenario: frag } });
    const sc = callerWith({ subflowId: 'sys', alias: 'z' });
    const { scenario } = expandSubflows(sc, library);
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}z:f1`].params.text).toBe('Вы написали: {{last_input}}');
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}z:f2`].params.assignVar).toBe('__menu');
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}z:f3`].params.text).toBe(
      'меню {{__menu}} / ref {{ref.count}} / pay {{pay.order}} / poll {{poll.answer}}'
    );
  });

  it('f) глубина 2 раскрывается полностью; глубина 4 — ошибка subflow-depth, не усечение', () => {
    // Цепочка L1 -> L2 -> L3 -> L4, каждый уровень — один фрагмент.
    const leaf = (id: string): Scenario =>
      fragScenario({ m: msgBlock('m', id, 'r'), r: { id: 'r', type: 'subflow_return', params: {} } }, 'm');
    const callLevel = (target: string): Scenario =>
      fragScenario(
        {
          c: { id: 'c', type: 'subflow', params: { subflowId: target }, branches: { done: 'r', failed: 'r' } },
          r: { id: 'r', type: 'subflow_return', params: {} },
        },
        'c'
      );
    const library = lib({
      L2: { scenario: leaf('лист2') },
      L1: { scenario: callLevel('L2') },
    });
    const ok2 = expandSubflows(callerWith({ subflowId: 'L1', alias: 'a' }), library);
    expect(ok2.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(Object.values(ok2.scenario.blocks).some((b) => b.type === 'subflow')).toBe(false);

    const deepLibrary = lib({
      L4: { scenario: leaf('лист4') },
      L3: { scenario: callLevel('L4') },
      L2b: { scenario: callLevel('L3') },
      L1b: { scenario: callLevel('L2b') },
    });
    const tooDeep = expandSubflows(callerWith({ subflowId: 'L1b', alias: 'a' }), deepLibrary);
    const depthErrors = tooDeep.issues.filter((i) => i.code === 'subflow-depth' && i.level === 'error');
    expect(depthErrors.length).toBeGreaterThan(0);
    expect(depthErrors[0].blockId).toBe('cs'); // id блока вызова
  });

  it('g) прямой цикл A->A и непрямой A->B->A — ошибки subflow-cycle с читаемым сообщением', () => {
    const selfCall: Scenario = fragScenario(
      {
        c: { id: 'c', type: 'subflow', params: { subflowId: 'A' }, branches: { done: 'r', failed: 'r' } },
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'c'
    );
    const direct = expandSubflows(callerWith({ subflowId: 'A', alias: 'a' }), lib({ A: { scenario: selfCall } }));
    const cyc = direct.issues.filter((i) => i.code === 'subflow-cycle');
    expect(cyc.length).toBeGreaterThan(0);
    expect(cyc[0].message.toLowerCase()).toContain('цикл');
    expect(cyc[0].blockId).toBe('cs');

    const aFrag: Scenario = fragScenario(
      {
        c: { id: 'c', type: 'subflow', params: { subflowId: 'B' }, branches: { done: 'r', failed: 'r' } },
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'c'
    );
    const bFrag: Scenario = fragScenario(
      {
        c: { id: 'c', type: 'subflow', params: { subflowId: 'A' }, branches: { done: 'r', failed: 'r' } },
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'c'
    );
    const indirect = expandSubflows(callerWith({ subflowId: 'A', alias: 'a' }), lib({ A: { scenario: aFrag }, B: { scenario: bFrag } }));
    expect(indirect.issues.some((i) => i.code === 'subflow-cycle' && i.blockId === 'cs')).toBe(true);
  });

  it('h) отсутствующий обязательный вход — ошибка, называющая вход и блок вызова', () => {
    const frag = fragScenario(
      { m: msgBlock('m', '{{name}}', 'r'), r: { id: 'r', type: 'subflow_return', params: {} } },
      'm'
    );
    const library = lib({ g: { scenario: frag, inputs: [{ name: 'name', required: true }] } });
    const { issues } = expandSubflows(callerWith({ subflowId: 'g', alias: 'a', inputs: {} }), library);
    const err = issues.find((i) => i.code === 'subflow-input');
    expect(err).toBeTruthy();
    expect(err!.level).toBe('error');
    expect(err!.message).toContain('name');
    expect(err!.blockId).toBe('cs');
  });

  it('i) висячая ссылка (фрагмент удалён) — ошибка subflow-missing с id блока вызова', () => {
    const { issues } = expandSubflows(callerWith({ subflowId: 'gone', alias: 'a' }), lib({}));
    const err = issues.find((i) => i.code === 'subflow-missing');
    expect(err).toBeTruthy();
    expect(err!.blockId).toBe('cs');
  });

  it('j) замороженный (disabled) блок внутри фрагмента остаётся замороженным', () => {
    const frag = fragScenario(
      {
        m: { id: 'm', type: 'message', params: { text: 'не увидят', disabled: true }, next: 'r' },
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'm'
    );
    const { scenario } = expandSubflows(callerWith({ subflowId: 'f', alias: 'a' }), lib({ f: { scenario: frag } }));
    expect(scenario.blocks[`${SUBFLOW_ID_PREFIX}a:m`].params.disabled).toBe(true);
  });

  it('k) больше 500 развёрнутых блоков — ошибка subflow-size с объяснением', () => {
    // Фрагмент из 60 блоков, вызванный 9 раз = 540 > SUBFLOW_MAX_BLOCKS.
    const blocks: Record<string, Block> = {};
    for (let i = 0; i < 60; i++) {
      blocks[`m${i}`] = msgBlock(`m${i}`, `сообщение ${i}`, i === 59 ? 'r' : `m${i + 1}`);
    }
    blocks.r = { id: 'r', type: 'subflow_return', params: {} };
    const frag = fragScenario(blocks, 'm0');
    const library = lib({ big: { scenario: frag } });
    const sc: Scenario = { version: 1, start: 's', blocks: { s: { id: 's', type: 'start', params: {}, next: 'c0' } } };
    for (let i = 0; i < 9; i++) {
      sc.blocks[`c${i}`] = {
        id: `c${i}`,
        type: 'subflow',
        params: { subflowId: 'big', alias: `a${i}` },
        branches: { done: i === 8 ? 'e' : `c${i + 1}`, failed: 'e' },
      };
    }
    sc.blocks.e = { id: 'e', type: 'end', params: {} };
    const { issues } = expandSubflows(sc, library);
    const err = issues.find((i) => i.code === 'subflow-size');
    expect(err).toBeTruthy();
    expect(err!.level).toBe('error');
    expect(err!.message).toContain(String(SUBFLOW_MAX_BLOCKS));
  });

  it('закреплённая ревизия не совпадает — ошибка subflow-revision с id блока вызова', () => {
    const frag = fragScenario({ m: msgBlock('m', 'x', 'r'), r: { id: 'r', type: 'subflow_return', params: {} } }, 'm');
    const library = lib({ f: { scenario: frag, revision: 3 } });
    const { issues } = expandSubflows(callerWith({ subflowId: 'f', alias: 'a', subflowRevision: 2 }), library);
    expect(issues.some((i) => i.code === 'subflow-revision' && i.blockId === 'cs')).toBe(true);
  });
});

describe('expandSubflows — гарантии', () => {  const frag = fragScenario(
    {
      m: msgBlock('m', 'привет {{last_input}}', 'r'),
      r: { id: 'r', type: 'subflow_return', params: {} },
    },
    'm'
  );
  const library = lib({ f: { scenario: frag } });
  const sc = callerWith({ subflowId: 'f', alias: 'a' });

  it('детерминизм: два прогона дают одинаковый хэш содержимого', () => {
    const r1 = expandSubflows(sc, library);
    const r2 = expandSubflows(sc, library);
    expect(scenarioContentHash(r1.scenario)).toBe(scenarioContentHash(r2.scenario));
  });

  it('иммутабельность: авторский сценарий и библиотека не изменяются', () => {
    const before = JSON.stringify(sc);
    const libBefore = JSON.stringify(library);
    expandSubflows(sc, library);
    expect(JSON.stringify(sc)).toBe(before);
    expect(JSON.stringify(library)).toBe(libBefore);
  });

  it('без блоков subflow результат идентичен входу (побайтово по хэшу)', () => {
    const plain: Scenario = {
      version: 1,
      start: 's',
      blocks: { s: { id: 's', type: 'start', params: {}, next: 'm' }, m: msgBlock('m', 'x') },
    };
    const { scenario, issues } = expandSubflows(plain, {});
    expect(issues).toEqual([]);
    expect(scenarioContentHash(scenario)).toBe(scenarioContentHash(plain));
  });

  it('развёрнутый граф не содержит циклов через блоки вызова', () => {
    const { scenario } = expandSubflows(sc, library);
    expect(findCycles(scenario)).toEqual([]);
  });
});

// selectionIo: дефолтное отображение входов/выходов для «создать подсценарий
// из выделения» (диалог показывает его ДО действия).
describe('selectionIo — входы/выходы выделения', () => {
  it('вход: выделение читает переменную, которую пишет внешний блок', () => {
    const sc: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'out' },
        out: { id: 'out', type: 'input', params: { var: 'name' }, next: 'm1' },
        m1: msgBlock('m1', 'Привет, {{name}}!', 'm2'),
        m2: { id: 'm2', type: 'setvar', params: { assignVar: 'greeting', expr: 'готово' }, next: 'after' },
        after: msgBlock('after', 'итог: {{greeting}}'),
      },
    };
    const io = selectionIo(sc, ['m1', 'm2']);
    expect(io.inputs).toContain('name');
    expect(io.outputs).toContain('greeting');
  });

  it('системные переменные не попадают во входы', () => {
    const sc: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'm1' },
        m1: msgBlock('m1', '{{last_input}} {{ref.link}} {{__menu}}', 'after'),
        after: { id: 'after', type: 'end', params: {} },
      },
    };
    const io = selectionIo(sc, ['m1']);
    expect(io.inputs).toEqual([]);
  });

  it('внутренняя переменная (пишется и читается в выделении) — не вход', () => {
    const sc: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'sv' },
        sv: { id: 'sv', type: 'setvar', params: { assignVar: 'tmp', expr: '1' }, next: 'm1' },
        m1: msgBlock('m1', 'tmp={{tmp}}'),
      },
    };
    const io = selectionIo(sc, ['sv', 'm1']);
    expect(io.inputs).not.toContain('tmp');
  });
});

// ------------------------------------------------------------------ эквивалентность рантайма

// Главный контракт публикации: expanded(сценарий с subflow) даёт БАЙТ-ИДЕНТИЧНЫЙ
// TelegramOut[] рукописному эквиваленту при тех же вводах. Если это не так —
// превью врёт, а публикация меняет поведение.
describe('эквивалентность рантайма: expanded == hand-written', () => {
  it('сообщение из фрагмента идентично рукописному блоку', async () => {
    const { runEngine } = await import('../worker/src/engine');
    const frag = fragScenario(
      {
        g: msgBlock('g', 'Добро пожаловать, {{name}}!', 'r'),
        r: { id: 'r', type: 'subflow_return', params: {} },
      },
      'g'
    );
    const library = lib({ welcome: { scenario: frag } });
    const withSubflow: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'cs' },
        cs: { id: 'cs', type: 'subflow', params: { subflowId: 'welcome', alias: 'w' }, branches: { done: 'end', failed: '' } },
        end: { id: 'end', type: 'end', params: {} },
      },
    };
    const handwritten: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'g' },
        g: msgBlock('g', 'Добро пожаловать, {{name}}!'),
      },
    };
    const { scenario: expanded } = expandSubflows(withSubflow, library);
    const vars = { name: 'Илья', last_input: '/start' };
    const update = { message: { chat: { id: 1 }, from: { id: 1 }, text: '/start' } };
    const r1 = await runEngine({ scenario: expanded, update, session: { currentBlock: null, vars: {} } });
    const r2 = await runEngine({ scenario: handwritten, update, session: { currentBlock: null, vars: {} } });
    // name проставим до старта (свежий /start стирает vars): сравниваем тексты.
    const texts1 = r1.outs.map((o) => o.payload.text ?? '').filter(Boolean);
    const texts2 = r2.outs.map((o) => o.payload.text ?? '').filter(Boolean);
    expect(texts1).toEqual(texts2);
    expect(r1.outs.map((o) => o.method)).toEqual(r2.outs.map((o) => o.method));
    void vars;
  });

  it('вход + условие внутри фрагмента: ветвление и outs идентичны рукописному', async () => {
    const { runEngine } = await import('../worker/src/engine');
    const frag = fragScenario(
      {
        ask: { id: 'ask', type: 'input', params: { var: 'age', prompt: 'Сколько лет?' }, next: 'c' },
        c: {
          id: 'c',
          type: 'condition',
          params: { condVar: 'age', op: '>', condValue: '18' },
          branches: { then: 't', else: 'e2' },
        },
        t: { id: 't', type: 'subflow_return', params: { outputs: { verdict: 'взрослый' } } },
        e2: { id: 'e2', type: 'subflow_return', params: { outputs: { verdict: 'ребёнок' } } },
      },
      'ask'
    );
    const library = lib({
      check: { scenario: frag, inputs: [], outputs: [{ name: 'verdict' }] },
    });
    const withSubflow: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'cs' },
        cs: { id: 'cs', type: 'subflow', params: { subflowId: 'check', alias: 'k' }, branches: { done: 'm', failed: '' } },
        m: msgBlock('m', 'Вердикт: {{verdict}}'),
      },
    };
    const { scenario: expanded } = expandSubflows(withSubflow, library);
    const update = { message: { chat: { id: 1 }, from: { id: 1 }, text: '/go' } };
    const first = await runEngine({ scenario: expanded, update, session: { currentBlock: null, vars: {} } });
    // Первая остановка — на input внутри фрагмента (id с префиксом sf:k:).
    expect(first.currentBlock).toBe('sf:k:ask');
    const answer = { message: { chat: { id: 1 }, from: { id: 1 }, text: '25' } };
    const second = await runEngine({ scenario: expanded, update: answer, session: { currentBlock: first.currentBlock, vars: first.vars } });
    const sent = second.outs.map((o) => o.payload.text ?? '');
    expect(sent).toContain('Вердикт: взрослый');
    // Выход записан в переменную вызывающего, внутренняя — в sf.k.age.
    expect(second.vars['verdict']).toBe('взрослый');
    expect(second.vars['sf.k.age']).toBe('25');
    expect(second.vars['age']).toBeUndefined();
  });
});
