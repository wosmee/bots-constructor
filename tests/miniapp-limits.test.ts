// Лимиты мини-аппов (фаза C): квоты схемы при публикации, медиа-квота,
// счётчики usage в D1 (миграция 0026) и минутный rate limit /m/api в KV.
//
// Фейковый D1 — паттерн tests/miniapps-db.test.ts: prepare И batch СОСЕДНИЕ
// методы, batch реально прогоняет stmt.run(); мок исполняет ровно те запросы,
// которые шлёт db.ts, включая эмуляцию MAX(0, ...) и CASE WHEN upsert-веток
// addMiniAppMediaBytes/bumpMiniAppAiCount. Фейковый KV — паттерн
// tests/auth.test.ts (Map + запись opts в puts).
import { describe, expect, it } from 'vitest';
import {
  addMiniAppMediaBytes,
  bumpMiniAppAiCount,
  getMiniAppAiCount,
  getMiniAppUsage,
} from '../worker/src/db';
import {
  checkMediaQuota,
  checkPublishLimits,
  rateLimitMiniApi,
} from '../worker/src/miniapp/limits';
import { MINI_LIMITS, emptyMiniApp, miniElement, validateMiniAppShape } from '../shared/miniapp';
import type { MiniApp } from '../shared/miniapp';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

type Row = Record<string, unknown>;

// Схема после миграции 0029: PK (bot_id, user_id, date). Медиа-байты —
// служебная строка user_id=0, date=''; AI-счётчик — строка (бот, юзер, сутки).
function makeUsageDb(tables: { mini_app_usage: Row[] } = { mini_app_usage: [] }) {
  const recorded: Array<{ sql: string; args: unknown[]; kind: string }> = [];

  function findRow(botId: unknown, userId: unknown, date: unknown): Row | undefined {
    return tables.mini_app_usage.find(
      (r) => r.bot_id === botId && Number(r.user_id) === Number(userId) && String(r.date) === String(date)
    );
  }

  function first(s: string, args: unknown[]): Row | null {
    // getMiniAppUsage: COUNT + SUM по боту; null только когда строк нет вовсе.
    if (s === 'SELECT COUNT(*) AS n, COALESCE(SUM(media_bytes), 0) AS media_bytes FROM mini_app_usage WHERE bot_id = ?') {
      const rows = tables.mini_app_usage.filter((r) => r.bot_id === args[0]);
      if (!rows.length) return null;
      return { n: rows.length, media_bytes: rows.reduce((sum, r) => sum + Number(r.media_bytes ?? 0), 0) };
    }
    if (s === 'SELECT COALESCE(SUM(media_bytes), 0) AS media_bytes FROM mini_app_usage WHERE bot_id = ?') {
      const rows = tables.mini_app_usage.filter((r) => r.bot_id === args[0]);
      return { media_bytes: rows.reduce((sum, r) => sum + Number(r.media_bytes ?? 0), 0) };
    }
    if (s === 'SELECT ai_count FROM mini_app_usage WHERE bot_id = ? AND user_id = ? AND date = ?') {
      const row = findRow(args[0], args[1], args[2]);
      return row ? { ai_count: row.ai_count } : null;
    }
    return null;
  }

  function run(s: string, args: unknown[]): Row {
    // addMiniAppMediaBytes: VALUES (?,?,?,MAX(0, ?),0,?) ON CONFLICT(bot_id, user_id, date)
    // DO UPDATE SET media_bytes = MAX(0, media_bytes + ?). Insert-ветка жмёт
    // delta к нулю (MAX(0, ?) = args[3]), update-ветка получает сырую args[5]
    // (отрицательный delta — освобождение квоты) и жмёт сумму.
    if (s.startsWith('INSERT INTO mini_app_usage ') && s.includes('MAX(0, media_bytes + ?)')) {
      const row = findRow(args[0], args[1], args[2]);
      if (row) {
        row.media_bytes = Math.max(0, Number(row.media_bytes) + Number(args[5]));
        row.updated_at = args[4];
      } else {
        tables.mini_app_usage.push({
          bot_id: String(args[0]),
          user_id: Number(args[1]),
          date: String(args[2]),
          media_bytes: Math.max(0, Number(args[3])),
          ai_count: 0,
          updated_at: args[4],
        });
      }
      return { meta: { changes: 1 } };
    }
    // bumpMiniAppAiCount: VALUES (?,?,?,0,1,?) ON CONFLICT(bot_id, user_id, date)
    // DO UPDATE SET ai_count = ai_count + 1. Сутки в PK — новая дата = новая строка.
    if (s.startsWith('INSERT INTO mini_app_usage ') && s.includes('DO UPDATE SET ai_count = ai_count + 1')) {
      const row = findRow(args[0], args[1], args[2]);
      if (row) {
        row.ai_count = Number(row.ai_count) + 1;
        row.updated_at = args[3];
      } else {
        tables.mini_app_usage.push({
          bot_id: String(args[0]),
          user_id: Number(args[1]),
          date: String(args[2]),
          media_bytes: 0,
          ai_count: 1,
          updated_at: args[3],
        });
      }
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const s = norm(sql);
          return {
            async first<T>() {
              recorded.push({ sql: s, args, kind: 'first' });
              return first(s, args) as T;
            },
            async run() {
              recorded.push({ sql: s, args, kind: 'run' });
              return run(s, args);
            },
          };
        },
      };
    },
    // batch — СОСЕД prepare; исполняет statement'ы по очереди (урок разделов 18/19).
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    __recorded: recorded,
    __tables: tables,
  };
  return db;
}

function mockKV() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; opts?: any }> = [];
  return {
    store,
    puts,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: any) => {
      store.set(key, value);
      puts.push({ key, value, opts });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

// Валидная схема на n страниц (каждая с elsCount элементами), проходит
// validateMiniAppShape — checkPublishLimits считает квоты поверх формы.
function makeApp(pageCount: number, elsCount = 0): MiniApp {
  const app = emptyMiniApp('p0');
  for (let i = 0; i < pageCount; i++) {
    const els = [];
    for (let j = 0; j < elsCount; j++) els.push(miniElement('text', `e${i}_${j}`));
    app.pages.push({ id: `p${i}`, name: `Стр ${i}`, bg: '#fff', els });
  }
  app.startPageId = 'p0';
  return app;
}

describe('checkPublishLimits', () => {
  it('валидная схема в лимитах → null', () => {
    const app = makeApp(3, 10);
    expect(validateMiniAppShape(app)).toBe(true);
    expect(checkPublishLimits(app)).toBeNull();
  });

  it('ровно на границе (20 страниц по 80 элементов) → null', () => {
    expect(checkPublishLimits(makeApp(MINI_LIMITS.pages, MINI_LIMITS.elsPerPage))).toBeNull();
  });

  it('21 страница → нарушение с числом страниц и лимитом', () => {
    const err = checkPublishLimits(makeApp(MINI_LIMITS.pages + 1));
    expect(err).not.toBeNull();
    expect(err).toContain('21');
    expect(err).toContain(String(MINI_LIMITS.pages));
  });

  it('81 элемент на одной странице → нарушение с именем страницы', () => {
    const app = makeApp(3, 5);
    app.pages[1].els = Array.from({ length: MINI_LIMITS.elsPerPage + 1 }, (_, j) => miniElement('text', `x${j}`));
    const err = checkPublishLimits(app);
    expect(err).not.toBeNull();
    expect(err).toContain('Стр 1');
    expect(err).toContain('81');
  });

  it('80 элементов на странице → ок', () => {
    expect(checkPublishLimits(makeApp(2, MINI_LIMITS.elsPerPage))).toBeNull();
  });
});

describe('checkMediaQuota', () => {
  it('добавление в пределах квоты → true', () => {
    expect(checkMediaQuota(0, 1024)).toBe(true);
    expect(checkMediaQuota(MINI_LIMITS.mediaBytesPerBot - 10, 10)).toBe(true);
  });

  it('ровно на границе квоты → true (не больше N)', () => {
    expect(checkMediaQuota(MINI_LIMITS.mediaBytesPerBot, 0)).toBe(true);
  });

  it('за пределами квоты → false', () => {
    expect(checkMediaQuota(MINI_LIMITS.mediaBytesPerBot, 1)).toBe(false);
    expect(checkMediaQuota(MINI_LIMITS.mediaBytesPerBot - 5, 6)).toBe(false);
  });
});

describe('addMiniAppMediaBytes', () => {
  it('первый вызов создаёт строку (upsert) и возвращает накопленное', async () => {
    const db = makeUsageDb();
    await expect(getMiniAppUsage(db as any, 'bot1')).resolves.toBeNull();
    const total = await addMiniAppMediaBytes(db as any, 'bot1', 5000);
    expect(total).toBe(5000);
    const row = await getMiniAppUsage(db as any, 'bot1');
    expect(row).toEqual({ media_bytes: 5000 });
    expect(db.__tables.mini_app_usage).toHaveLength(1);
    // служебная строка бота: user_id=0, date=''
    expect(db.__tables.mini_app_usage[0]).toMatchObject({ user_id: 0, date: '' });
  });

  it('второй вызов суммирует, возвращает накопленное', async () => {
    const db = makeUsageDb();
    expect(await addMiniAppMediaBytes(db as any, 'bot1', 5000)).toBe(5000);
    expect(await addMiniAppMediaBytes(db as any, 'bot1', 3000)).toBe(8000);
    expect((await getMiniAppUsage(db as any, 'bot1'))!.media_bytes).toBe(8000);
  });

  it('боты считаются независимо', async () => {
    const db = makeUsageDb();
    await addMiniAppMediaBytes(db as any, 'bot1', 100);
    expect(await addMiniAppMediaBytes(db as any, 'bot2', 200)).toBe(200);
    expect((await getMiniAppUsage(db as any, 'bot1'))!.media_bytes).toBe(100);
  });

  it('удаление (отрицательный delta) не уходит ниже нуля', async () => {
    const db = makeUsageDb();
    await addMiniAppMediaBytes(db as any, 'bot1', 500);
    expect(await addMiniAppMediaBytes(db as any, 'bot1', -200)).toBe(300);
    expect(await addMiniAppMediaBytes(db as any, 'bot1', -1000)).toBe(0);
    expect((await getMiniAppUsage(db as any, 'bot1'))!.media_bytes).toBe(0);
  });
});

// F-039: AI-счётчик живёт на пару (пользователь, сутки) — PK (bot_id, user_id, date).
// Сигнатура после F-039: (db, botId, today, userId?) — userId опционален,
// дефолт 0 = агрегатная бот-строка (совместимость с текущим вызовом index.ts).
describe('bumpMiniAppAiCount', () => {
  it('первый вызов дня создаёт строку со счётчиком 1', async () => {
    const db = makeUsageDb();
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(1);
    expect(await getMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(1);
  });

  it('тот же день инкрементит', async () => {
    const db = makeUsageDb();
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(1);
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(2);
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(3);
    expect(await getMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(3);
  });

  it('новый день — новый счётчик (строка с новой датой в PK)', async () => {
    const db = makeUsageDb();
    await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-28', 7);
    await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-28', 7);
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(1);
    // вчерашний счётчик не тронут
    expect(await getMiniAppAiCount(db as any, 'bot1', '2026-09-28', 7)).toBe(2);
  });

  it('F-039: пользователи одного бота не съедают лимит друг друга', async () => {
    const db = makeUsageDb();
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(1);
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 8)).toBe(1);
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7)).toBe(2);
    expect(await getMiniAppAiCount(db as any, 'bot1', '2026-09-29', 8)).toBe(1);
  });

  it('без userId — бот-строка user_id=0 (старое поведение до переключения index.ts)', async () => {
    const db = makeUsageDb();
    expect(await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29')).toBe(1);
    expect(db.__tables.mini_app_usage[0]).toMatchObject({ user_id: 0, date: '2026-09-29' });
  });

  it('AI-строки юзеров не влияют на медиа-квоту бота', async () => {
    const db = makeUsageDb();
    await addMiniAppMediaBytes(db as any, 'bot1', 700);
    await bumpMiniAppAiCount(db as any, 'bot1', '2026-09-29', 7);
    const row = await getMiniAppUsage(db as any, 'bot1');
    expect(row).toEqual({ media_bytes: 700 });
  });
});

describe('rateLimitMiniApi', () => {
  const NOW = 1_790_000_000_000; // фиксированное время, минута: NOW/60000
  const MINUTE = Math.floor(NOW / 60000);

  it('до порога включительно — true, на пороге+1 — false', async () => {
    const kv = mockKV();
    for (let i = 0; i < MINI_LIMITS.apiPerMin; i++) {
      expect(await rateLimitMiniApi(kv as any, 'bot1', 42, NOW)).toBe(true);
    }
    expect(await rateLimitMiniApi(kv as any, 'bot1', 42, NOW)).toBe(false);
    // Превышение не пишет ключ дальше — счётчик заморожен на пороге.
    expect(kv.store.get(`mini_rl:bot1:42:${MINUTE}`)).toBe(String(MINI_LIMITS.apiPerMin));
  });

  it('новая минута — снова true, старый ключ не мешает', async () => {
    const kv = mockKV();
    for (let i = 0; i < MINI_LIMITS.apiPerMin; i++) await rateLimitMiniApi(kv as any, 'bot1', 42, NOW);
    expect(await rateLimitMiniApi(kv as any, 'bot1', 42, NOW)).toBe(false);
    const nextMinute = NOW + 60_000;
    expect(await rateLimitMiniApi(kv as any, 'bot1', 42, nextMinute)).toBe(true);
    expect(kv.store.get(`mini_rl:bot1:42:${Math.floor(nextMinute / 60000)}`)).toBe('1');
  });

  it('ключ scoped на пару бот+юзер и пишет expirationTtl 120', async () => {
    const kv = mockKV();
    await rateLimitMiniApi(kv as any, 'bot1', 42, NOW);
    expect(kv.store.get(`mini_rl:bot1:42:${MINUTE}`)).toBe('1');
    // Чужой юзер и чужой бот — свои счётчики.
    await rateLimitMiniApi(kv as any, 'bot1', 43, NOW);
    await rateLimitMiniApi(kv as any, 'bot2', 42, NOW);
    expect(kv.store.size).toBe(3);
    expect(kv.puts[0].opts).toEqual({ expirationTtl: 120 });
  });

  it('мусор в значении KV трактуется как 0 (запрос проходит)', async () => {
    const kv = mockKV();
    await kv.put(`mini_rl:bot1:42:${MINUTE}`, 'не-число');
    expect(await rateLimitMiniApi(kv as any, 'bot1', 42, NOW)).toBe(true);
    expect(kv.store.get(`mini_rl:bot1:42:${MINUTE}`)).toBe('1');
  });
});
