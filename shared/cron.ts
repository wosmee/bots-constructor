// Чистый расчёт расписаний блока schedule (§4). Модуль не знает ни про D1,
// ни про движок: валидатор использует parseCronExpr для проверки выражения,
// воркер — scheduleDueAt/scheduleKindLabel для вычисления срабатываний.
//
// Модель: расписание хранится в bot_schedules (миграция 0027) как cron_expr
// в 5-полевом формате (минуты часы день месяц день_недели) + часовой пояс.
// Храним UTC, применяем зону автора при вычислении ближайшего срабатывания.
// Гранулярность — минута; крон воркера тикает раз в минуту.

import { DEFAULT_SCHEDULE_TIMEZONE, MIN_SCHEDULE_INTERVAL_MIN } from './limits';

export type ScheduleKind = 'daily' | 'weekly' | 'interval' | 'cron';
export type ScheduleAudience = 'all' | 'tag' | 'single';

// 5-полевой cron: minute hour dom month dow. Поддерживаем '*', списки '1,3,5',
// диапазоны '2-6', шаги '*/5' и '1-10/2'. День недели: 0 и 7 = воскресенье.
const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 и 7 — воскресенье)
];

export interface CronExpr {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[]; // нормализовано: 7 -> 0
}

export function parseCronExpr(raw: string): CronExpr | null {
  const parts = String(raw ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const parsed = parseCronField(parts[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1]);
    if (!parsed || !parsed.length) return null;
    fields.push(parsed);
  }
  // dow: 7 -> 0 (оба означают воскресенье)
  const dow = Array.from(new Set(fields[4].map((d) => (d === 7 ? 0 : d)))).sort((a, b) => a - b);
  return {
    minutes: fields[0],
    hours: fields[1],
    daysOfMonth: fields[2],
    months: fields[3],
    daysOfWeek: dow,
  };
}

function parseCronField(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (!part) return null;
    let range = part;
    let step = 1;
    const slash = part.split('/');
    if (slash.length > 2) return null;
    if (slash.length === 2) {
      range = slash[0];
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step < 1) return null;
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(range)) {
      lo = hi = Number(range);
      if (lo < min || lo > max) return null;
    } else {
      const m = range.match(/^(\d+)-(\d+)$/);
      if (!m) return null;
      lo = Number(m[1]);
      hi = Number(m[2]);
      if (lo < min || hi > max || lo > hi) return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return Array.from(out).sort((a, b) => a - b);
}

// Выражение cron -> читаемый текст для UI (только виды, которые генерирует сам
// конструктор: daily/weekly/interval/cron).
export function scheduleToCron(params: {
  scheduleKind?: ScheduleKind;
  atTime?: string;
  weekdays?: number[];
  everyMinutes?: number;
  cronExpr?: string;
}): { cronExpr: string; ok: boolean } {
  const kind = params.scheduleKind ?? 'daily';
  if (kind === 'cron') {
    const expr = String(params.cronExpr ?? '').trim();
    return { cronExpr: expr, ok: !!parseCronExpr(expr) };
  }
  const tm = parseHHMM(params.atTime);
  if (kind === 'daily') {
    if (!tm) return { cronExpr: '', ok: false };
    return { cronExpr: `${tm[1]} ${tm[0]} * * *`, ok: true };
  }
  if (kind === 'weekly') {
    if (!tm) return { cronExpr: '', ok: false };
    const days = (params.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (!days.length) return { cronExpr: '', ok: false };
    // UI хранит дни недели 1–7 (1 = понедельник), cron — 0–6 (0 = воскресенье).
    const dow = Array.from(new Set(days.map((d) => (d === 7 ? 0 : d)))).sort((a, b) => a - b);
    return { cronExpr: `${tm[1]} ${tm[0]} * * ${dow.join(',')}`, ok: true };
  }
  // interval
  const every = Math.floor(Number(params.everyMinutes) || 0);
  if (every < MIN_SCHEDULE_INTERVAL_MIN) return { cronExpr: '', ok: false };
  if (every >= 60 && every % 60 === 0) return { cronExpr: `0 */${every / 60} * * *`, ok: every / 60 <= 23 };
  if (every < 60 && 60 % every === 0) return { cronExpr: `*/${every} * * * *`, ok: true };
  // Произвольный интервал в минутах: расписание вычисляется по last_run_at,
  // cron-выражение — маркер вида (минута срабатывания не фиксирована сеткой).
  return { cronExpr: `every:${every}`, ok: true };
}

export function parseHHMM(raw: unknown): [number, number] | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return [h, mi];
}

// Смещение часового пояса в минутах на момент timeMs. Используем Intl (есть в
// Workers runtime); неизвестная зона -> UTC.
export function timezoneOffsetMinutes(tz: string, timeMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || DEFAULT_SCHEDULE_TIMEZONE,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(timeMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((asUTC - Math.floor(timeMs / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

export interface ScheduleRowLike {
  cron_expr: string;
  timezone?: string | null;
  every_minutes?: number | null;
  last_run_at?: number | null;
}

// Ближайшее срабатывание в минуту >= fromMs. Возвращает timestamp ms или null,
// если в пределах горизонта (750 дней) срабатывания нет (например, 30 февраля).
// Для маркера every:<N> — fromMs округляется вверх до минуты (якорь last_run_at
// прибавляет вызывающий). Алгоритм: перебор КАЛЕНДАРНЫХ ДНЕЙ (не минут), внутри
// подходящего дня — перебор часов/минут из выражения; локальное время считается
// через offset зоны с двукратной коррекцией (устойчиво к DST).
export function nextFireAfter(row: ScheduleRowLike, fromMs: number): number | null {
  const tz = row.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const expr = parseCronExpr(row.cron_expr);
  if (!expr) return null;
  const startMinute = Math.ceil(fromMs / 60_000) * 60_000;
  const DAY_MS = 86_400_000;
  // Стартуем с UTC-дня, содержащего startMinute (в любой зоне локальный день
  // отличается от UTC максимум на сутки — горизонт это покрывает).
  for (let dayIdx = 0; dayIdx < 750; dayIdx++) {
    const dayUtc = Math.floor(startMinute / DAY_MS) * DAY_MS + dayIdx * DAY_MS;
    // Offset берём на полдень UTC этого дня: середина суток стабильна к DST.
    const noonOff = timezoneOffsetMinutes(tz, dayUtc + 12 * 3_600_000);
    const local = new Date(dayUtc + noonOff * 60_000);
    if (
      !expr.months.includes(local.getUTCMonth() + 1) ||
      !expr.daysOfMonth.includes(local.getUTCDate()) ||
      !expr.daysOfWeek.includes(local.getUTCDay())
    ) {
      continue;
    }
    for (const hour of expr.hours) {
      for (const minute of expr.minutes) {
        // Кандидат: локальные (день, час, минута) -> UTC. Первая оценка offset
        // на полдень; уточняем offset на самом кандидате (переход DST мог
        // случиться между полднем и кандидатом) и пересчитываем один раз.
        const wallBase = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute);
        const est1 = wallBase - noonOff * 60_000;
        const off2 = timezoneOffsetMinutes(tz, est1);
        const cand = wallBase - off2 * 60_000;
        // Проверка: кандидат действительно даёт нужную локальную минуту и не
        // раньше startMinute.
        if (cand < startMinute) continue;
        const back = new Date(cand + timezoneOffsetMinutes(tz, cand) * 60_000);
        if (
          back.getUTCHours() === hour &&
          back.getUTCMinutes() === minute &&
          back.getUTCDate() === local.getUTCDate()
        ) {
          return cand;
        }
      }
    }
  }
  return null;
}

// Следующее срабатывание для строки bot_schedules: якорь — last_run_at
// (или created_at для ни разу не сработавшего), для every:<N> — якорь + N минут.
export function nextRunFor(
  row: ScheduleRowLike & { created_at?: number | null },
  nowMs: number
): number | null {
  const everyMatch = String(row.cron_expr).match(/^every:(\d+)$/);
  const anchor = Math.max(Number(row.last_run_at) || 0, Number(row.created_at) || 0);
  if (everyMatch) {
    const every = Math.max(MIN_SCHEDULE_INTERVAL_MIN, Number(everyMatch[1]) || 0) * 60_000;
    return anchor > 0 ? anchor + every : Math.ceil(nowMs / 60_000) * 60_000 + every;
  }
  // Для cron/daily/weekly: первое срабатывание строго ПОСЛЕ якоря. Новое
  // расписание (якорь = created_at = сейчас) в прошлом не срабатывает —
  // backfill исключён.
  return nextFireAfter({ ...row }, anchor > 0 ? anchor + 1 : nowMs);
}

// Пора ли сработать на тике nowMs. Двойной тик в одну минуту не сработает
// дважды: после первого запуска last_run_at >= минуты, и nextRunFor уходит
// в будущее (плюс воркер обновляет last_run_at атомарным WHERE last_run_at < ?).
export function isScheduleDue(
  row: ScheduleRowLike & { created_at?: number | null },
  nowMs: number
): boolean {
  const next = nextRunFor(row, nowMs);
  return next != null && next <= nowMs;
}

