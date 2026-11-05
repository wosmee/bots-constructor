// UI блока «Расписание» и памяти диалога блока ИИ (набор 2026-09-30).
// Проверяем чистую логику блоков и полноту словаря — JSX-компоненты здесь
// не импортируем (как и tests/inspector-fields.test.ts).
import { describe, expect, it } from 'vitest';
import { defaultBlock, summary, nodeLabel, BLOCK_META, WHAT_IF, PALETTE_GROUPS } from '../web/src/blocks';
import { usesBranches } from '../shared/types';
import { translate, loadDict } from '../web/src/i18n';
import { logLabel } from '../web/src/logLabels';
import { DEFAULT_SCHEDULE_TIMEZONE, MAX_SCHEDULES_PER_BOT } from '../shared/limits';

describe('defaultBlock("schedule")', () => {
  const b = defaultBlock('schedule', 'x');

  it('дефолты расписания: ежедневно в 10:00, зона по умолчанию', () => {
    expect(b.params.scheduleKind).toBe('daily');
    expect(b.params.atTime).toBe('10:00');
    expect(b.params.timezone).toBe(DEFAULT_SCHEDULE_TIMEZONE);
    expect(b.params.timezone).toBe('Europe/Moscow');
    expect(b.params.everyMinutes).toBe(60);
    expect(b.params.weekdays).toEqual([1]);
    expect(b.params.scheduleAudience).toBe('all');
  });

  it('блок без ветвей: только next, как у message/web_app', () => {
    expect(usesBranches('schedule')).toBe(false);
    expect(b.branches ?? {}).toEqual({});
    expect(b.next).toBe('');
    // Для сравнения: defaultBlock('message') тоже без branches.
    expect(defaultBlock('message', 'm').branches ?? {}).toEqual({});
  });

  it('лежит в группе «Время» первым (набор 2026-10: семья «когда»)', () => {
    const time = PALETTE_GROUPS.find((g) => g.id === 'time')!;
    expect(time.items.indexOf('schedule')).toBe(0);
  });
});

describe('сводка блока schedule на холсте', () => {
  it('ежедневное расписание содержит время 10:00', () => {
    const s = summary(defaultBlock('schedule', 'x'), 'ru');
    expect(s).toContain('10:00');
    expect(s).toContain('⏰');
  });

  it('виды расписания дают разные сводки', () => {
    const base = defaultBlock('schedule', 'x').params;
    const weekly = summary({ id: 'x', type: 'schedule', params: { ...base, scheduleKind: 'weekly', weekdays: [1, 3, 5] } }, 'ru');
    const interval = summary({ id: 'x', type: 'schedule', params: { ...base, scheduleKind: 'interval', everyMinutes: 15 } }, 'ru');
    const cron = summary({ id: 'x', type: 'schedule', params: { ...base, scheduleKind: 'cron', cronExpr: '*/5 * * * *' } }, 'ru');
    expect(weekly).toContain('10:00');
    expect(interval).toContain('15');
    expect(cron).toContain('*/5 * * * *');
  });

  it('аудитория по тегу показывает тег', () => {
    const base = defaultBlock('schedule', 'x').params;
    const s = summary(
      { id: 'x', type: 'schedule', params: { ...base, scheduleAudience: 'tag', audienceTag: 'vip' } },
      'ru'
    );
    expect(s).toContain('vip');
  });

  it('nodeLabel укладывается в 30 символов узла (контракт registry-теста)', () => {
    const label = nodeLabel(defaultBlock('schedule', 'x'), 'ru');
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(31);
  });
});

describe('реестры блока schedule', () => {
  it('BLOCK_META: цвет формата #rrggbb', () => {
    expect(BLOCK_META.schedule.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('WHAT_IF: ключ переведён в обоих языках', async () => {
    await loadDict('en');
    expect(WHAT_IF.schedule).toBe('whatif.schedule');
    expect(translate('ru', 'whatif.schedule')).not.toBe('whatif.schedule');
    expect(translate('en', 'whatif.schedule')).not.toBe('whatif.schedule');
  });
});

describe('i18n: новые ключи расписания и памяти ИИ', () => {
  it('label/hint/example/guide переведены в обоих языках', async () => {
    await loadDict('en');
    for (const key of [
      'block.schedule.label',
      'block.schedule.hint',
      'block.schedule.example',
      'node.schedule.daily',
      'node.schedule.interval',
      'node.schedule.cron',
      'node.schedule.weekly',
      'f.sched.kind',
      'f.sched.kind.daily',
      'f.sched.kind.weekly',
      'f.sched.kind.interval',
      'f.sched.kind.cron',
      'f.sched.atTime',
      'f.sched.weekdays',
      'f.sched.day.1',
      'f.sched.day.7',
      'f.sched.everyMinutes',
      'f.sched.cronExpr',
      'f.sched.cron.ok',
      'f.sched.cron.bad',
      'f.sched.cron.hint',
      'f.sched.audience',
      'f.sched.aud.all',
      'f.sched.aud.tag',
      'f.sched.aud.single',
      'f.sched.audienceTag',
      'f.sched.timezone',
      'f.sched.limit',
      'insp.section.aiMemory',
      'f.ai.historyVar',
      'f.ai.historyVar.hint',
      'f.ai.historyTurns',
      'f.ai.historyTurns.hint',
      'f.ai.persistHistoryTo',
      'f.ai.persistHistoryTo.hint',
      'log.ev.engineResume',
      'log.ev.engineGaveup',
      'log.ev.loopBreak',
      'log.ev.chainDeferred',
      'log.ev.aiTruncated',
      'log.ev.scanCapped',
      'log.ev.scheduleReg',
      'log.ev.scheduleFired',
      'log.ev.scheduleDisabled',
      'log.ev.scheduleLimit',
    ] as const) {
      expect(translate('ru', key), `нет RU для ${key}`).not.toBe(key);
      expect(translate('en', key), `нет EN для ${key}`).not.toBe(key);
    }
  });

  it('лимит расписаний подставляется в подсказку', () => {
    const s = translate('ru', 'f.sched.limit', { max: MAX_SCHEDULES_PER_BOT });
    expect(s).toContain(String(MAX_SCHEDULES_PER_BOT));
    expect(s).not.toContain('{max}');
  });

  it('дни недели 1–7 имеют ключи', () => {
    for (let d = 1; d <= 7; d++) {
      const key = `f.sched.day.${d}` as const;
      expect(translate('ru', key)).not.toBe(key);
    }
  });
});

describe('logLabels: новые события движка и расписаний', () => {
  // t() journey-теста: ключ как есть — проверяем маршрутизацию, не перевод.
  const t = (key: string) => key;
  // Формат logLabel: `<перевод> · <event>` — берём часть до разделителя.
  const labelOf = (event: string) => logLabel(event, t as never).split(' · ')[0];

  it('события расписаний идут к своим ключам', () => {
    expect(labelOf('schedule.registered.s1')).toBe('log.ev.scheduleReg');
    expect(labelOf('schedule.fired.s2')).toBe('log.ev.scheduleFired');
    expect(labelOf('schedule.disabled.s3')).toBe('log.ev.scheduleDisabled');
    expect(labelOf('schedule.limit.exceeded')).toBe('log.ev.scheduleLimit');
  });

  it('бюджет движка, цепочки, память ИИ, скан данных', () => {
    expect(labelOf('engine.budget.resume.b1')).toBe('log.ev.engineResume');
    expect(labelOf('engine.budget.gaveup')).toBe('log.ev.engineGaveup');
    expect(labelOf('engine.loop.break.b7')).toBe('log.ev.loopBreak');
    expect(labelOf('async.chain.deferred.3')).toBe('log.ev.chainDeferred');
    expect(labelOf('ai.history.truncated.2')).toBe('log.ev.aiTruncated');
    expect(labelOf('data.scan.capped.5000')).toBe('log.ev.scanCapped');
  });

  it('старые паттерны не сломаны: scheduled.* не съеден schedule.*', () => {
    expect(labelOf('scheduled.retry.2')).toBe('log.ev.scheduled');
    // send.error ловится более ранним ^send\. — так было и в journey.test.ts.
    expect(labelOf('send.error')).toBe('log.ev.send');
    expect(labelOf('payment.fail')).toBe('log.ev.error');
    expect(labelOf('some.future.event')).toBe('some.future.event');
  });
});
