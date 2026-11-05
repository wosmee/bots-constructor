import type { TKey } from './i18n';

export function logLabel(event: string, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  const patterns: Array<[RegExp, TKey]> = [
    [/^bot\.created$/, 'log.ev.botCreated'],
    [/^scenario\.saved\.v(\d+)$/, 'log.ev.scenarioSaved'],
    [/^scenario\.rollback\.v(\d+)$/, 'log.ev.rollback'],
    [/^publish\.(ok|version\.v\d+)$/, 'log.ev.publishOk'],
    [/^publish\.blocked\.(\d+)$/, 'log.ev.publishBlocked'],
    [/^publish\.webhook\.(fail|mismatch)$/, 'log.ev.webhook'],
    [/^step\./, 'log.ev.step'],
    [/^delay\.([^.]+)/, 'log.ev.delay'],
    [/^subscription\.([^.]+)/, 'log.ev.subscription'],
    [/^http\.([^.]+)/, 'log.ev.http'],
    [/^send\.([^.]+)/, 'log.ev.send'],
    [/^invoice\.([^.]+)/, 'log.ev.invoice'],
    [/^broadcast\.([^.]+)/, 'log.ev.broadcast'],
    [/^scheduled\.([^.]+)/, 'log.ev.scheduled'],
    // --- набор 2026-09-30: бюджет движка, расписания, память ИИ ---
    // Порядок важен: schedule.* специфичнее scheduled.* и идёт ПОСЛЕ него —
    // '^scheduled\.' не ловит 'schedule.fired', а вот обратный порядок
    // («^schedule») перехватил бы «scheduled». Более специфичные паттерны
    // стоят ДО общего [/\.(error|fail)$/].
    [/^engine\.budget\.resume\./, 'log.ev.engineResume'],
    [/^engine\.budget\.gaveup$/, 'log.ev.engineGaveup'],
    [/^engine\.loop\.break\./, 'log.ev.loopBreak'],
    [/^async\.chain\.deferred\./, 'log.ev.chainDeferred'],
    [/^ai\.history\.truncated\./, 'log.ev.aiTruncated'],
    [/^data\.scan\.capped\./, 'log.ev.scanCapped'],
    [/^schedule\.registered\./, 'log.ev.scheduleReg'],
    [/^schedule\.fired\./, 'log.ev.scheduleFired'],
    [/^schedule\.disabled\./, 'log.ev.scheduleDisabled'],
    [/^schedule\.limit/, 'log.ev.scheduleLimit'],
    [/\.(error|fail)$/, 'log.ev.error'],
  ];
  for (const [pattern, key] of patterns) {
    const match = event.match(pattern);
    if (match) return `${t(key, { value: match[1] ?? '' })} · ${event}`;
  }
  return event;
}