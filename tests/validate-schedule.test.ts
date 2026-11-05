// §4: валидатор блока schedule + §2: подсказка реальной вместимости foreach.
import { describe, it, expect } from 'vitest';
import { validateScenario, countIssues } from '../shared/validate';
import type { Scenario, Block } from '../shared/types';
import { MAX_SCHEDULES_PER_BOT, foreachPassCapacity, HARD_LOOP_CAP } from '../shared/limits';
import { foreachBodySize } from '../shared/graph';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function block(id: string, type: Block['type'], params: Block['params'], branches?: Block['branches'], next?: string): Block {
  return { id, type, params, branches, ...(next ? { next } : {}) } as Block;
}

function withStart(blocks: Scenario['blocks']): Scenario {
  return { version: 1, start: 's', blocks: { s: { id: 's', type: 'start', params: { command: '/start' }, next: Object.keys(blocks)[0] ?? '' }, ...blocks } };
}

const dailyOk = block('sch', 'schedule', { scheduleKind: 'daily', atTime: '10:00', scheduleAudience: 'all', timezone: 'Europe/Moscow' }, undefined, 'e');

describe('validate: schedule', () => {
  it('корректное daily-расписание — без ошибок', () => {
    const issues = validateScenario(withStart({ sch: dailyOk, e: block('e', 'end', {}) }));
    expect(countIssues(issues).errors).toBe(0);
  });

  it('daily без времени — sch-time', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'daily' }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) })))).toContain('sch-time');
  });

  it('daily с битым временем — sch-time', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'daily', atTime: '25:99' }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) })))).toContain('sch-time');
  });

  it('weekly без дней — sch-weekdays', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'weekly', atTime: '09:00', weekdays: [] }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) })))).toContain('sch-weekdays');
  });

  it('weekly с днями — чисто', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'weekly', atTime: '09:00', weekdays: [1, 3, 5] }, undefined, 'e');
    expect(countIssues(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) }))).errors).toBe(0);
  });

  it('interval 0 минут — sch-interval', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'interval', everyMinutes: 0 }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) })))).toContain('sch-interval');
  });

  it('interval 7 минут (не делитель часа) — допустим (маркер every:7)', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'interval', everyMinutes: 7 }, undefined, 'e');
    expect(countIssues(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) }))).errors).toBe(0);
  });

  it('cron: пустое выражение — sch-cron, битое — sch-cron-bad, валидное — чисто', () => {
    const empty = block('sch', 'schedule', { scheduleKind: 'cron' }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: empty, e: block('e', 'end', {}) })))).toContain('sch-cron');
    const bad = block('sch', 'schedule', { scheduleKind: 'cron', cronExpr: '61 * * * *' }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: bad, e: block('e', 'end', {}) })))).toContain('sch-cron-bad');
    const ok = block('sch', 'schedule', { scheduleKind: 'cron', cronExpr: '0 10 * * 1-5' }, undefined, 'e');
    expect(countIssues(validateScenario(withStart({ sch: ok, e: block('e', 'end', {}) }))).errors).toBe(0);
  });

  it('audience tag без тега — sch-tag', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'daily', atTime: '10:00', scheduleAudience: 'tag', audienceTag: '  ' }, undefined, 'e');
    expect(codes(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) })))).toContain('sch-tag');
  });

  it('audience tag с тегом — чисто', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'daily', atTime: '10:00', scheduleAudience: 'tag', audienceTag: 'vip' }, undefined, 'e');
    expect(countIssues(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) }))).errors).toBe(0);
  });

  it('нет потока запуска (next) — sch-next', () => {
    const b = block('sch', 'schedule', { scheduleKind: 'daily', atTime: '10:00' });
    expect(codes(validateScenario(withStart({ sch: b, e: block('e', 'end', {}) })))).toContain('sch-next');
  });

  it(`больше ${MAX_SCHEDULES_PER_BOT} расписаний — sch-bot-limit (warn, не блокирует)`, () => {
    const blocks: Scenario['blocks'] = {};
    for (let i = 0; i <= MAX_SCHEDULES_PER_BOT; i++) {
      blocks[`sch${i}`] = block(`sch${i}`, 'schedule', { scheduleKind: 'daily', atTime: '10:00' }, undefined, 'e');
    }
    blocks.e = block('e', 'end', {});
    const issues = validateScenario(withStart(blocks));
    expect(codes(issues)).toContain('sch-bot-limit');
    expect(issues.find((i) => i.code === 'sch-bot-limit')?.level).toBe('warn');
    // warn не блокирует публикацию: ошибки только если есть другие проблемы.
    expect(countIssues(issues).errors).toBe(0);
  });

  it('unknown-type больше не срабатывает для schedule (тип зарегистрирован)', () => {
    const issues = validateScenario(withStart({ sch: dailyOk, e: block('e', 'end', {}) }));
    expect(codes(issues)).not.toContain('unknown-type');
  });
});

describe('§2 validate: foreach — реальная вместимость одного прохода', () => {
  function loopSc(bodyLen: number, maxIterations?: number): Scenario {
    const blocks: Scenario['blocks'] = {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'fe' } as any,
      fe: block('fe', 'foreach', { listVar: 'items', ...(maxIterations ? { maxIterations } : {}) }, { each: 'b0', done: 'e' }) as any,
    };
    for (let i = 0; i < bodyLen; i++) {
      blocks[`b${i}`] = block(`b${i}`, 'message', { text: 'x' }, undefined, i + 1 < bodyLen ? `b${i + 1}` : 'fe') as any;
    }
    blocks.e = block('e', 'end', {}) as any;
    return { version: 1, start: 's', blocks };
  }

  it('foreachBodySize считает тело + сам foreach', () => {
    expect(foreachBodySize(loopSc(5), 'fe')).toBe(6); // foreach + 5 блоков тела
  });

  it('fe-pass-capacity: warn, когда maxIterations больше вместимости прохода', () => {
    const sc = loopSc(5, 300);
    const issues = validateScenario(sc);
    const hint = issues.find((i) => i.code === 'fe-pass-capacity');
    expect(hint).toBeTruthy();
    expect(hint!.level).toBe('warn');
    const cap = foreachPassCapacity(6); // ~166
    expect(hint!.message).toContain(String(cap));
    // Ошибкой не является: цикл завершится фоново.
    expect(countIssues(issues).errors).toBe(0);
  });

  it('нет warn, когда maxIterations в пределах одного прохода', () => {
    const sc = loopSc(2, 100); // тело 3 блока → вместимость ~333
    expect(codes(validateScenario(sc))).not.toContain('fe-pass-capacity');
  });

  it('fe-max-cap теперь ссылается на HARD_LOOP_CAP (единый источник)', () => {
    const sc = loopSc(1, HARD_LOOP_CAP + 1);
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('fe-max-cap');
    expect(issues.find((i) => i.code === 'fe-max-cap')?.message).toContain(String(HARD_LOOP_CAP));
  });
});
