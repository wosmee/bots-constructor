// F-023 (аудит 18.10.2026): эвристика катастрофического бэктрекинга.
// Repro аудитa: (a|a)+$ блокировал изолят на 15 с при 22 символах входа
// (tmp/audit-2026-10-18/s1/run-expr-filter3.txt). ВАЖНО: сам взрывающийся
// regex здесь НИГДЕ не выполняется на длинном входе — проверяется только
// эвристика и её интеграция в валидатор и движок (оператор 'regex' на
// опасном паттерне обязан вернуть false, не вызывая RegExp.test).
import { describe, it, expect } from 'vitest';
import { hasDangerousRepetition } from '../shared/types';
import { validateScenario } from '../shared/validate';
import { evalConditionOp } from '../worker/src/engine';
import type { Scenario, Block } from '../shared/types';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('hasDangerousRepetition: форма 1 — вложенные квантификаторы', () => {
  it('ловит (a+)+, (\\w*)*, ([a-z]+){2,} и их вариации', () => {
    for (const p of ['(a+)+', '(a+)+$', '(\\w*)*', '([a-z]+){2,}', '((a+))+', '(a+)*']) {
      expect(hasDangerousRepetition(p), JSON.stringify(p)).toBe(true);
    }
  });
});

describe('hasDangerousRepetition: форма 2 — перекрытие альтернатив (F-023)', () => {
  it('ловит идентичные альтернативы (a|a)+', () => {
    expect(hasDangerousRepetition('(a|a)+')).toBe(true);
    expect(hasDangerousRepetition('(a|a)+$')).toBe(true);
  });

  it('ловит альтернативы с общим префиксом (a|ab)+, (foo|foobar)+', () => {
    expect(hasDangerousRepetition('(a|ab)+')).toBe(true);
    expect(hasDangerousRepetition('(foo|foobar)+')).toBe(true);
    expect(hasDangerousRepetition('(ab|a|b)+')).toBe(true);
  });

  it('ловит * и {n,}-формы с перекрытием', () => {
    expect(hasDangerousRepetition('(x|y|ya)*')).toBe(true);
    expect(hasDangerousRepetition('(a|a){3,}')).toBe(true);
  });

  it('пустая альтернатива (a|)+ считается опасной', () => {
    expect(hasDangerousRepetition('(a|)+')).toBe(true);
  });

  it('не трогает безопасные паттерны', () => {
    for (const p of [
      '^\\d{4}-\\d{2}-\\d{2}$',
      '^[a-z]+$',
      '(a|b)c', // квантификатора за группой нет
      '(cat|dog)',
      '(a|ab)', // без повтора перекрытие не экспоненциально
      'x{3}', // точный счётчик
      '[a-z0-9_]+',
      '^https?://',
      '\\b\\w+@\\w+\\.\\w+\\b',
      '(?:hello|world)',
    ]) {
      expect(hasDangerousRepetition(p), JSON.stringify(p)).toBe(false);
    }
  });

  it('линейна: паттерн из 500 альтернатив проверяется быстро', () => {
    const big = '(' + 'a|'.repeat(500) + 'a)+';
    const t0 = Date.now();
    expect(hasDangerousRepetition(big)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

// ---------------- интеграция: оператор 'regex' в движке ----------------

describe('evalConditionOp regex: опасный паттерн отклоняется без выполнения', () => {
  it('(a|a)+$ на «почти совпадающем» входе — false мгновенно, не блокируя', () => {
    // 22 символа 'a' без завершающего символа — вход из repro аудита, на
    // котором RegExp.test висел 15 с. Здесь вызов обязан вернуть false сразу.
    const input = 'a'.repeat(22);
    const t0 = Date.now();
    expect(evalConditionOp(input, 'regex', '(a|a)+$')).toBe(false);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('безопасный regex по-прежнему работает', () => {
    expect(evalConditionOp('abc123', 'regex', '^[a-z]+\\d+$')).toBe(true);
    expect(evalConditionOp('!!!', 'regex', '^[a-z]+\\d+$')).toBe(false);
  });
});

// ---------------- интеграция: валидатор ----------------

function block(id: string, type: Block['type'], params: Block['params'], branchesOrNext?: Block['branches'] | string): Block {
  const isNext = typeof branchesOrNext === 'string';
  return { id, type, params, ...(isNext ? { next: branchesOrNext } : { branches: branchesOrNext }) } as any;
}

function withStart(blocks: Scenario['blocks']): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: Object.keys(blocks)[0] ?? '' },
      ...blocks,
    },
  } as Scenario;
}

describe('validateScenario: катастрофический regex — error до публикации', () => {
  it('condition: op=regex с (a|a)+ — cond-regex-danger (error)', () => {
    const c = block(
      'c',
      'condition',
      { conditions: [{ source: 'var', var: 'x', op: 'regex', value: '(a|a)+$' }] },
      { then: 'e', else: 'e' }
    );
    const issues = validateScenario(withStart({ c, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('cond-regex-danger');
    expect(issues.find((i) => i.code === 'cond-regex-danger')?.level).toBe('error');
  });

  it('input: regex (a|a)+ — input-regex-danger (error)', () => {
    const i = block('i', 'input', { var: 'name', prompt: 'имя?', regex: '(a|a)+$' }, 'e');
    const issues = validateScenario(withStart({ i, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('input-regex-danger');
    expect(issues.find((i) => i.code === 'input-regex-danger')?.level).toBe('error');
  });

  it('безопасный regex не трогает: ни danger-кодов, ни cond-regex', () => {
    const c = block(
      'c',
      'condition',
      { conditions: [{ source: 'var', var: 'x', op: 'regex', value: '^\\d+$' }] },
      { then: 'e', else: 'e' }
    );
    const issues = validateScenario(withStart({ c, e: block('e', 'end', {}) }));
    expect(codes(issues)).not.toContain('cond-regex-danger');
    expect(codes(issues)).not.toContain('cond-regex');
  });

  it('легаси-путь одиночного условия (condValue) тоже проверяется', () => {
    const c = block('c', 'condition', { condVar: 'x', op: 'regex', condValue: '(a+)+' }, { then: 'e', else: 'e' });
    const issues = validateScenario(withStart({ c, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('cond-regex-danger');
  });
});
