// §4: чистая математика расписаний (shared/cron.ts) — парсер cron, генератор
// выражения из параметров блока, вычисление срабатываний с учётом часовой зоны.
import { describe, expect, it } from 'vitest';
import {
  parseCronExpr,
  scheduleToCron,
  nextFireAfter,
  nextRunFor,
  isScheduleDue,
  timezoneOffsetMinutes,
} from '../shared/cron';

const MIN = 60_000;

describe('parseCronExpr', () => {
  it('разбирает 5-полевое выражение', () => {
    const e = parseCronExpr('0 10 * * *');
    expect(e).toBeTruthy();
    expect(e!.minutes).toEqual([0]);
    expect(e!.hours).toEqual([10]);
    expect(e!.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('списки, диапазоны и шаги', () => {
    const e = parseCronExpr('*/15 9-17 * * 1,3,5');
    expect(e!.minutes).toEqual([0, 15, 30, 45]);
    expect(e!.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(e!.daysOfWeek).toEqual([1, 3, 5]);
  });

  it('7 = воскресенье -> 0', () => {
    const e = parseCronExpr('0 0 * * 7');
    expect(e!.daysOfWeek).toEqual([0]);
  });

  it('мусор не парсится', () => {
    expect(parseCronExpr('')).toBeNull();
    expect(parseCronExpr('* * *')).toBeNull();
    expect(parseCronExpr('61 0 * * *')).toBeNull();
    expect(parseCronExpr('0 24 * * *')).toBeNull();
    expect(parseCronExpr('a b c d e')).toBeNull();
    expect(parseCronExpr('*/0 * * * *')).toBeNull();
    expect(parseCronExpr('5-1 * * * *')).toBeNull();
  });
});

describe('scheduleToCron', () => {
  it('daily в 10:00', () => {
    expect(scheduleToCron({ scheduleKind: 'daily', atTime: '10:00' })).toEqual({ cronExpr: '0 10 * * *', ok: true });
  });

  it('weekly по понедельникам и средам (1,3) в 09:30', () => {
    expect(scheduleToCron({ scheduleKind: 'weekly', atTime: '09:30', weekdays: [1, 3] })).toEqual({
      cronExpr: '30 9 * * 1,3',
      ok: true,
    });
  });

  it('weekly: воскресенье 7 -> 0', () => {
    expect(scheduleToCron({ scheduleKind: 'weekly', atTime: '08:00', weekdays: [7] }).cronExpr).toBe('0 8 * * 0');
  });

  it('interval 5 минут — делитель часа', () => {
    expect(scheduleToCron({ scheduleKind: 'interval', everyMinutes: 5 })).toEqual({ cronExpr: '*/5 * * * *', ok: true });
  });

  it('interval 120 минут — каждый 2-й час', () => {
    expect(scheduleToCron({ scheduleKind: 'interval', everyMinutes: 120 })).toEqual({ cronExpr: '0 */2 * * *', ok: true });
  });

  it('interval 7 минут — маркер every:7', () => {
    expect(scheduleToCron({ scheduleKind: 'interval', everyMinutes: 7 })).toEqual({ cronExpr: 'every:7', ok: true });
  });

  it('interval < 1 минуты невалиден', () => {
    expect(scheduleToCron({ scheduleKind: 'interval', everyMinutes: 0 }).ok).toBe(false);
  });

  it('cron-вид: валидное выражение проходит, битое — нет', () => {
    expect(scheduleToCron({ scheduleKind: 'cron', cronExpr: '0 0 1 * *' }).ok).toBe(true);
    expect(scheduleToCron({ scheduleKind: 'cron', cronExpr: 'oops' }).ok).toBe(false);
  });

  it('daily без времени невалиден', () => {
    expect(scheduleToCron({ scheduleKind: 'daily', atTime: '' }).ok).toBe(false);
    expect(scheduleToCron({ scheduleKind: 'weekly', atTime: '10:00', weekdays: [] }).ok).toBe(false);
  });
});

describe('timezoneOffsetMinutes', () => {
  it('Europe/Moscow = +180 круглый год (без DST)', () => {
    expect(timezoneOffsetMinutes('Europe/Moscow', Date.UTC(2026, 0, 15, 12))).toBe(180);
    expect(timezoneOffsetMinutes('Europe/Moscow', Date.UTC(2026, 6, 15, 12))).toBe(180);
  });

  it('неизвестная зона -> 0 (UTC)', () => {
    expect(timezoneOffsetMinutes('Mars/Olympus', Date.UTC(2026, 0, 15, 12))).toBe(0);
  });
});

describe('nextFireAfter / nextRunFor / isScheduleDue', () => {
  it('daily 10:00 Europe/Moscow: следующее срабатывание — 07:00 UTC', () => {
    const row = { cron_expr: '0 10 * * *', timezone: 'Europe/Moscow' };
    // 30.09.2026 06:00 UTC = 09:00 MSK -> сегодня в 07:00 UTC (10:00 MSK)
    const from = Date.UTC(2026, 8, 30, 6, 0);
    expect(nextFireAfter(row, from)).toBe(Date.UTC(2026, 8, 30, 7, 0));
    // 30.09.2026 08:00 UTC = 11:00 MSK -> завтра 07:00 UTC
    expect(nextFireAfter(row, Date.UTC(2026, 8, 30, 8, 0))).toBe(Date.UTC(2026, 9, 1, 7, 0));
  });

  it('weekly пн 09:30 MSK не срабатывает во вторник', () => {
    const row = { cron_expr: '30 9 * * 1', timezone: 'Europe/Moscow' };
    // 29.09.2026 — вторник; ближайший понедельник — 05.10.2026
    const from = Date.UTC(2026, 8, 29, 12, 0);
    const next = nextFireAfter(row, from);
    expect(next).toBe(Date.UTC(2026, 9, 5, 6, 30));
    expect(new Date(next!).getUTCDay()).toBe(1);
  });

  it('*/5 * * * * в UTC', () => {
    const row = { cron_expr: '*/5 * * * *', timezone: 'UTC' };
    expect(nextFireAfter(row, Date.UTC(2026, 8, 30, 12, 3))).toBe(Date.UTC(2026, 8, 30, 12, 5));
    expect(nextFireAfter(row, Date.UTC(2026, 8, 30, 12, 5))).toBe(Date.UTC(2026, 8, 30, 12, 5));
  });

  it('every:7 — якорь last_run_at + 7 минут', () => {
    const last = Date.UTC(2026, 8, 30, 12, 0);
    const row = { cron_expr: 'every:7', last_run_at: last };
    expect(nextRunFor(row, last + MIN)).toBe(last + 7 * MIN);
    // до истечения интервала не пора
    expect(isScheduleDue(row, last + 6 * MIN)).toBe(false);
    expect(isScheduleDue(row, last + 7 * MIN)).toBe(true);
  });

  it('двойной тик в одну минуту не срабатывает дважды', () => {
    const tick = Date.UTC(2026, 8, 30, 7, 0); // 10:00 MSK
    const row = { cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', last_run_at: tick };
    expect(isScheduleDue(row, tick)).toBe(false);
    expect(isScheduleDue(row, tick + 30_000)).toBe(false);
  });

  it('новое расписание (нет last_run_at) не срабатывает задним числом', () => {
    const created = Date.UTC(2026, 8, 30, 8, 0); // 11:00 MSK — уже ПОСЛЕ 10:00
    const row = { cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', created_at: created, last_run_at: null };
    expect(isScheduleDue(row, created + MIN)).toBe(false);
    // На следующее утро — сработает.
    expect(isScheduleDue(row, Date.UTC(2026, 9, 1, 7, 0))).toBe(true);
  });

  it('30 февраля никогда -> null, не виснет', () => {
    const row = { cron_expr: '0 0 30 2 *', timezone: 'UTC' };
    expect(nextFireAfter(row, Date.UTC(2026, 0, 1))).toBeNull();
  });
});
