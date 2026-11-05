// Валидатор набора 2026-09: у каждого нового блока — свои коды замечаний.
// Правило из промпта: validation test per new code. Старые коды не трогаем —
// их покрывает tests/validate.test.ts (он должен оставаться зелёным без правок).
import { describe, it, expect } from 'vitest';
import { validateScenario, countIssues } from '../shared/validate';
import type { Scenario, Block } from '../shared/types';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function scenarioOf(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks };
}

// Минимальный корректный блок: вызывающий тест добавляет только то, что ломает.
function block(id: string, type: Block['type'], params: Block['params'], branches?: Block['branches']): Block {
  return { id, type, params, branches } as Block;
}

function withStart(blocks: Scenario['blocks']): Scenario {
  return scenarioOf({ s: { id: 's', type: 'start', params: { command: '/start' }, next: Object.keys(blocks)[0] ?? '' }, ...blocks });
}

// ---------------- poll ----------------

describe('validate: poll', () => {
  const ok = block('p', 'poll', {
    question: 'Любимый цвет?',
    pollOptions: [
      { id: 'a', text: 'Красный' },
      { id: 'b', text: 'Синий' },
    ],
  }, { answered: 'e', skipped: 'e' });

  it('корректный опрос — без ошибок', () => {
    const issues = validateScenario(withStart({ p: ok, e: block('e', 'end', {}) }));
    expect(countIssues(issues).errors).toBe(0);
  });

  it('пустой вопрос — poll-question', () => {
    const b = block('p', 'poll', { pollOptions: [{ text: 'а' }, { text: 'б' }] }, { answered: 'e', skipped: 'e' });
    expect(codes(validateScenario(withStart({ p: b, e: block('e', 'end', {}) })))).toContain('poll-question');
  });

  it('один вариант — poll-options', () => {
    const b = block('p', 'poll', { question: '?', pollOptions: [{ text: 'а' }] }, { answered: 'e', skipped: 'e' });
    expect(codes(validateScenario(withStart({ p: b, e: block('e', 'end', {}) })))).toContain('poll-options');
  });

  it('одиннадцать вариантов — poll-options-max', () => {
    const opts = Array.from({ length: 11 }, (_, i) => ({ text: `вариант ${i + 1}` }));
    const b = block('p', 'poll', { question: '?', pollOptions: opts }, { answered: 'e', skipped: 'e' });
    expect(codes(validateScenario(withStart({ p: b, e: block('e', 'end', {}) })))).toContain('poll-options-max');
  });

  it('пустой текст варианта — poll-option-text', () => {
    const b = block('p', 'poll', { question: '?', pollOptions: [{ text: 'а' }, { text: '  ' }] }, { answered: 'e', skipped: 'e' });
    expect(codes(validateScenario(withStart({ p: b, e: block('e', 'end', {}) })))).toContain('poll-option-text');
  });

  it('correctOptionId не из списка — poll-correct', () => {
    const b = block('p', 'poll', {
      question: '?',
      pollOptions: [{ id: 'a', text: 'а' }, { id: 'b', text: 'б' }],
      correctOptionId: 'ghost',
    }, { answered: 'e', skipped: 'e' });
    expect(codes(validateScenario(withStart({ p: b, e: block('e', 'end', {}) })))).toContain('poll-correct');
  });

  it('нет ветки «ответил» — poll-answered (error), нет «пропустил» — poll-skipped (warn)', () => {
    const b = block('p', 'poll', { question: '?', pollOptions: [{ text: 'а' }, { text: 'б' }] });
    const issues = validateScenario(withStart({ p: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('poll-answered');
    expect(codes(issues)).toContain('poll-skipped');
    expect(issues.find((i) => i.code === 'poll-answered')?.level).toBe('error');
    expect(issues.find((i) => i.code === 'poll-skipped')?.level).toBe('warn');
  });
});

// ---------------- forward ----------------

describe('validate: forward', () => {
  it('text-режим без текста — fwd-text', () => {
    const b = block('f', 'forward', { forwardMode: 'text', toChatId: '@chan' }, { ok: 'e', failed: 'e' });
    expect(codes(validateScenario(withStart({ f: b, e: block('e', 'end', {}) })))).toContain('fwd-text');
  });

  it('без получателя — fwd-target (warn)', () => {
    const b = block('f', 'forward', {}, { ok: 'e', failed: 'e' });
    const issues = validateScenario(withStart({ f: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('fwd-target');
    expect(issues.find((i) => i.code === 'fwd-target')?.level).toBe('warn');
  });

  it('нет ветки ok — fwd-ok (error)', () => {
    const b = block('f', 'forward', { toChatId: '@chan' });
    expect(codes(validateScenario(withStart({ f: b, e: block('e', 'end', {}) })))).toContain('fwd-ok');
  });

  it('корректный forward — без ошибок', () => {
    const b = block('f', 'forward', { toChatId: '@chan' }, { ok: 'e', failed: 'e' });
    expect(countIssues(validateScenario(withStart({ f: b, e: block('e', 'end', {}) }))).errors).toBe(0);
  });
});

// ---------------- chat_action ----------------

describe('validate: chat_action', () => {
  it('без действия — chat-action (warn), сценарий не блокируется', () => {
    const b = block('c', 'chat_action', {}, 'e');
    const issues = validateScenario(withStart({ c: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('chat-action');
    expect(countIssues(issues).errors).toBe(0);
  });
});

// ---------------- wait ----------------

describe('validate: wait', () => {
  it('без секунд — wait-seconds', () => {
    const b = block('w', 'wait', {}, { reply: 'e', timeout: 'e' });
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('wait-seconds');
  });

  it('отрицательный потолок — wait-max', () => {
    const b = block('w', 'wait', { seconds: 60, maxWaitMinutes: -5 }, { reply: 'e', timeout: 'e' });
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('wait-max');
  });

  it('нет ветки timeout — wait-timeout (error), нет reply — wait-reply (warn)', () => {
    const b = block('w', 'wait', { seconds: 60 });
    const issues = validateScenario(withStart({ w: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('wait-timeout');
    expect(codes(issues)).toContain('wait-reply');
    expect(issues.find((i) => i.code === 'wait-timeout')?.level).toBe('error');
    expect(issues.find((i) => i.code === 'wait-reply')?.level).toBe('warn');
  });

  it('корректный wait — без ошибок', () => {
    const b = block('w', 'wait', { seconds: 60 }, { reply: 'e', timeout: 'e' });
    expect(countIssues(validateScenario(withStart({ w: b, e: block('e', 'end', {}) }))).errors).toBe(0);
  });
});

// ---------------- channel_check ----------------

describe('validate: channel_check', () => {
  it('без канала — chk-id', () => {
    const b = block('ch', 'channel_check', {}, { member: 'e', not_member: 'e', error: 'e' });
    expect(codes(validateScenario(withStart({ ch: b, e: block('e', 'end', {}) })))).toContain('chk-id');
  });

  it('всегда предупреждает про администратора — chk-admin', () => {
    const b = block('ch', 'channel_check', { channelId: '@chan' }, { member: 'e', not_member: 'e', error: 'e' });
    const issues = validateScenario(withStart({ ch: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('chk-admin');
    expect(countIssues(issues).errors).toBe(0);
  });

  it('отрицательный кэш — chk-cache', () => {
    const b = block('ch', 'channel_check', { channelId: '@chan', cacheMinutes: -1 }, { member: 'e', not_member: 'e', error: 'e' });
    expect(codes(validateScenario(withStart({ ch: b, e: block('e', 'end', {}) })))).toContain('chk-cache');
  });

  it('пустые ветки — chk-member/chk-notmember (error), chk-error (warn)', () => {
    const b = block('ch', 'channel_check', { channelId: '@chan' });
    const issues = validateScenario(withStart({ ch: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('chk-member');
    expect(codes(issues)).toContain('chk-notmember');
    expect(codes(issues)).toContain('chk-error');
    expect(issues.find((i) => i.code === 'chk-member')?.level).toBe('error');
    expect(issues.find((i) => i.code === 'chk-error')?.level).toBe('warn');
  });
});

// ---------------- segment_broadcast ----------------

describe('validate: segment_broadcast', () => {
  it('без текста и медиа — seg-content', () => {
    const b = block('sb', 'segment_broadcast', { segmentTag: 'vip' }, { queued: 'e', empty: 'e' });
    expect(codes(validateScenario(withStart({ sb: b, e: block('e', 'end', {}) })))).toContain('seg-content');
  });

  it('без сегмента — seg-segment (warn): рассылка всем', () => {
    const b = block('sb', 'segment_broadcast', { segmentText: 'Привет' }, { queued: 'e', empty: 'e' });
    const issues = validateScenario(withStart({ sb: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('seg-segment');
    expect(issues.find((i) => i.code === 'seg-segment')?.level).toBe('warn');
  });

  it('отрицательный дневной лимит — seg-cap', () => {
    const b = block('sb', 'segment_broadcast', { segmentText: 'Привет', segmentTag: 'vip', dailyCap: -1 }, { queued: 'e', empty: 'e' });
    expect(codes(validateScenario(withStart({ sb: b, e: block('e', 'end', {}) })))).toContain('seg-cap');
  });

  it('нулевая пачка — seg-chunk', () => {
    const b = block('sb', 'segment_broadcast', { segmentText: 'Привет', segmentTag: 'vip', chunkSize: 0 }, { queued: 'e', empty: 'e' });
    expect(codes(validateScenario(withStart({ sb: b, e: block('e', 'end', {}) })))).toContain('seg-chunk');
  });

  it('нет ветки queued — seg-queued (error)', () => {
    const b = block('sb', 'segment_broadcast', { segmentText: 'Привет', segmentTag: 'vip' });
    expect(codes(validateScenario(withStart({ sb: b, e: block('e', 'end', {}) })))).toContain('seg-queued');
  });
});

// ---------------- user_stats ----------------

describe('validate: user_stats', () => {
  it('без шаблона — usr-template (warn), без ошибок', () => {
    const b = block('us', 'user_stats', {}, 'e');
    const issues = validateScenario(withStart({ us: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('usr-template');
    expect(countIssues(issues).errors).toBe(0);
  });
});

// ---------------- payment_link / payment_check ----------------

describe('validate: payment_link', () => {
  it('без подключения — pay-conn', () => {
    const b = block('pl', 'payment_link', { amount: 100 }, { created: 'e', failed: 'e' });
    expect(codes(validateScenario(withStart({ pl: b, e: block('e', 'end', {}) })))).toContain('pay-conn');
  });

  it('нулевая сумма — pay-amount', () => {
    const b = block('pl', 'payment_link', { connectionId: 'c1', amount: 0 }, { created: 'e', failed: 'e' });
    expect(codes(validateScenario(withStart({ pl: b, e: block('e', 'end', {}) })))).toContain('pay-amount');
  });

  it('нет ветки created — pay-created (error), failed — warn', () => {
    const b = block('pl', 'payment_link', { connectionId: 'c1', amount: 100 });
    const issues = validateScenario(withStart({ pl: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('pay-created');
    expect(codes(issues)).toContain('pay-failed');
    expect(issues.find((i) => i.code === 'pay-created')?.level).toBe('error');
    expect(issues.find((i) => i.code === 'pay-failed')?.level).toBe('warn');
  });

  it('корректный — без ошибок', () => {
    const b = block('pl', 'payment_link', { connectionId: 'c1', amount: 15000 }, { created: 'e', failed: 'e' });
    expect(countIssues(validateScenario(withStart({ pl: b, e: block('e', 'end', {}) }))).errors).toBe(0);
  });
});

describe('validate: payment_check', () => {
  it('без orderIdVar и без autoOrderId — payc-order', () => {
    const b = block('pc', 'payment_check', { connectionId: 'c1' }, { paid: 'e', pending: 'e', failed: 'e' });
    expect(codes(validateScenario(withStart({ pc: b, e: block('e', 'end', {}) })))).toContain('payc-order');
  });

  it('autoOrderId снимает требование orderIdVar', () => {
    const b = block('pc', 'payment_check', { connectionId: 'c1', autoOrderId: true }, { paid: 'e', pending: 'e', failed: 'e' });
    expect(codes(validateScenario(withStart({ pc: b, e: block('e', 'end', {}) })))).not.toContain('payc-order');
  });

  it('нет ветки paid — payc-paid (error)', () => {
    const b = block('pc', 'payment_check', { connectionId: 'c1', orderIdVar: 'pay.order' });
    expect(codes(validateScenario(withStart({ pc: b, e: block('e', 'end', {}) })))).toContain('payc-paid');
  });
});

// ---------------- invoice + connectionId (набор 2026-09) ----------------

describe('validate: invoice с connectionId', () => {
  const inv = { title: 'Курс', description: 'Доступ', amount: 1500, currency: 'RUB' };

  it('без provider_token и без подключения — inv-token (как раньше)', () => {
    const b = block('i', 'invoice', { invoice: inv }, { paid: 'e', cancelled: 'e' });
    expect(codes(validateScenario(withStart({ i: b, e: block('e', 'end', {}) })))).toContain('inv-token');
  });

  it('connectionId заменяет provider_token — inv-token не появляется', () => {
    const b = block('i', 'invoice', { invoice: inv, connectionId: 'c1' }, { paid: 'e', cancelled: 'e' });
    expect(codes(validateScenario(withStart({ i: b, e: block('e', 'end', {}) })))).not.toContain('inv-token');
  });
});

// ---------------- foreach ----------------

describe('validate: foreach', () => {
  it('без listVar — fe-list', () => {
    const b = block('fe', 'foreach', {}, { each: 'e', done: 'e' });
    expect(codes(validateScenario(withStart({ fe: b, e: block('e', 'end', {}) })))).toContain('fe-list');
  });

  it('нулевой лимит — fe-max', () => {
    const b = block('fe', 'foreach', { listVar: 'items', maxIterations: 0 }, { each: 'e', done: 'e' });
    expect(codes(validateScenario(withStart({ fe: b, e: block('e', 'end', {}) })))).toContain('fe-max');
  });

  it('лимит выше 500 — fe-max-cap (warn)', () => {
    const b = block('fe', 'foreach', { listVar: 'items', maxIterations: 5000 }, { each: 'e', done: 'e' });
    const issues = validateScenario(withStart({ fe: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('fe-max-cap');
    expect(issues.find((i) => i.code === 'fe-max-cap')?.level).toBe('warn');
  });

  it('обратная связь тела → foreach НЕ считается tight loop', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'fe' },
      fe: block('fe', 'foreach', { listVar: 'items' }, { each: 'body' }) as any,
      body: { id: 'body', type: 'message', params: { text: '{{item}}' }, next: 'fe' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    // Ключевой регресс: тело→foreach НЕ tight-loop (foreach — «ждущий» блок).
    expect(codes(issues)).not.toContain('tight-loop');
  });

  it('нет ветки each — fe-each (error)', () => {
    const b = block('fe', 'foreach', { listVar: 'items' });
    expect(codes(validateScenario(withStart({ fe: b, e: block('e', 'end', {}) })))).toContain('fe-each');
  });
});

// ---------------- random_text ----------------

describe('validate: random_text', () => {
  it('без вариантов — rt-empty', () => {
    const b = block('rt', 'random_text', {}, 'e');
    expect(codes(validateScenario(withStart({ rt: b, e: block('e', 'end', {}) })))).toContain('rt-empty');
  });

  it('send=false без outVar — rt-nowhere (warn)', () => {
    const b = block('rt', 'random_text', { variants: [{ text: 'а' }], send: false }, 'e');
    const issues = validateScenario(withStart({ rt: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('rt-nowhere');
    expect(issues.find((i) => i.code === 'rt-nowhere')?.level).toBe('warn');
  });
});

// ---------------- assert ----------------

describe('validate: assert', () => {
  it('без failMessage — as-msg (warn)', () => {
    const b = block('as', 'assert', { condVar: 'x', op: '==', condValue: '1' }, { pass: 'e', fail: 'e' });
    const issues = validateScenario(withStart({ as: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('as-msg');
    expect(countIssues(issues).errors).toBe(0);
  });

  it('без веток — as-pass и as-fail (error)', () => {
    const b = block('as', 'assert', { condVar: 'x', op: '==', condValue: '1', failMessage: 'упс' });
    const issues = validateScenario(withStart({ as: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('as-pass');
    expect(codes(issues)).toContain('as-fail');
  });
});

// ---------------- counter ----------------

describe('validate: counter', () => {
  it('без имени — cnt-name', () => {
    const b = block('cn', 'counter', {}, 'e');
    expect(codes(validateScenario(withStart({ cn: b, e: block('e', 'end', {}) })))).toContain('cnt-name');
  });

  it('шаг 0 у inc — cnt-amount', () => {
    const b = block('cn', 'counter', { counterName: 'hits', counterOp: 'inc', amount: 0 }, 'e');
    expect(codes(validateScenario(withStart({ cn: b, e: block('e', 'end', {}) })))).toContain('cnt-amount');
  });

  it('get не требует amount', () => {
    const b = block('cn', 'counter', { counterName: 'hits', counterOp: 'get' }, 'e');
    expect(codes(validateScenario(withStart({ cn: b, e: block('e', 'end', {}) })))).not.toContain('cnt-amount');
  });

  it('нулевой порог — cnt-max', () => {
    const b = block('cn', 'counter', { counterName: 'hits', counterMax: 0 }, 'e');
    expect(codes(validateScenario(withStart({ cn: b, e: block('e', 'end', {}) })))).toContain('cnt-max');
  });
});

// ---------------- общие проверки набора ----------------

describe('validate: общие коды набора 2026-09', () => {
  it('пустой conditions[] — cond-conditions (error), не «молча истина»', () => {
    const b = block('c', 'condition', { conditions: [], logic: 'and' }, { then: 'e', else: 'e' });
    expect(codes(validateScenario(withStart({ c: b, e: block('e', 'end', {}) })))).toContain('cond-conditions');
  });

  it('битый regex в условии — cond-regex', () => {
    const b = block('c', 'condition', {
      conditions: [{ source: 'var', var: 'x', op: 'regex', value: '([a-z' }],
    }, { then: 'e', else: 'e' });
    expect(codes(validateScenario(withStart({ c: b, e: block('e', 'end', {}) })))).toContain('cond-regex');
  });

  it('условие по тегу с не-теговым оператором — cond-tag-op', () => {
    const b = block('c', 'condition', {
      conditions: [{ source: 'tag', var: 'vip', op: '>', value: '1' }],
    }, { then: 'e', else: 'e' });
    expect(codes(validateScenario(withStart({ c: b, e: block('e', 'end', {}) })))).toContain('cond-tag-op');
  });

  it('неизвестная функция в выражении — expr-unknown-fn', () => {
    const b = block('sv', 'setvar', { expr: 'evil(x)', assignVar: 'y' }, 'e');
    expect(codes(validateScenario(withStart({ sv: b, e: block('e', 'end', {}) })))).toContain('expr-unknown-fn');
  });

  it('битый вызов функции — expr-malformed', () => {
    const b = block('sv', 'setvar', { expr: 'len(', assignVar: 'y' }, 'e');
    expect(codes(validateScenario(withStart({ sv: b, e: block('e', 'end', {}) })))).toContain('expr-malformed');
  });

  it('несбалансированный HTML-тег с parseMode HTML — markup-tags (warn)', () => {
    const b = block('m', 'message', { text: '<b>привет', parseMode: 'HTML' }, 'e');
    const issues = validateScenario(withStart({ m: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('markup-tags');
    expect(issues.find((i) => i.code === 'markup-tags')?.level).toBe('warn');
  });

  it('input с kind и без next — предупреждение dead-end (TASK 4: warn, не error)', () => {
    const b = block('in', 'input', { kind: 'document', var: 'doc', prompt: 'Пришлите документ' });
    const issues = validateScenario(withStart({ in: b, e: block('e', 'end', {}) }));
    // Новый вид ввода не должен ронять валидатор в ошибку: без next блок
    // «ждёт» вложения — это законный тупик, помеченный dead-end (warn).
    expect(codes(issues)).toContain('dead-end');
    expect(countIssues(issues).errors).toBe(0);
  });
});
