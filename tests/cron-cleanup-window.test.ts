// Фаза 3 перф-пасса 29.09.2026: окно чистки логов крона (03:00 UTC) и отказ
// от ежеминутного чтения KV-ключа cron:logsCleanup.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { _testOnly } from '../worker/src/index';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

describe('isLogsCleanupTick — окно чистки логов', () => {
  it('ровно 03:00 UTC — чистка', () => {
    expect(_testOnly.isLogsCleanupTick(new Date('2026-09-29T03:00:00Z'))).toBe(true);
  });
  it('соседние минуты и часы — нет', () => {
    expect(_testOnly.isLogsCleanupTick(new Date('2026-09-29T02:59:00Z'))).toBe(false);
    expect(_testOnly.isLogsCleanupTick(new Date('2026-09-29T03:01:00Z'))).toBe(false);
    expect(_testOnly.isLogsCleanupTick(new Date('2026-09-29T04:00:00Z'))).toBe(false);
    expect(_testOnly.isLogsCleanupTick(new Date('2026-09-29T15:00:00Z'))).toBe(false);
  });
  it('локальный часовой пояс не сбивает окно (03:00 по UTC+3 = 00:00 UTC)', () => {
    // 00:00 UTC — не окно, даже если локально это «3 часа ночи».
    expect(_testOnly.isLogsCleanupTick(new Date('2026-09-29T00:00:00Z'))).toBe(false);
  });
});

describe('scheduled: KV больше не читается на каждом тике', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('обычный тик — ни одного обращения к KV-ключу cron:logsCleanup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const kvGets: string[] = [];
    const env = {
      DB: {
        prepare: () => ({ bind: () => ({ async first() { return null; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 0 } }; } }) }),
        // S5-04: batch — сосед prepare и РЕАЛЬНО исполняет statement'ы,
        // иначе проверки записи фиктивны (урок §18/19 AGENTS.md).
        async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const s of stmts) await s?.run?.(); return []; },
      },
      KV: { get: async (k: string) => { kvGets.push(k); return null; }, put: async () => {}, delete: async () => {} },
      ENCRYPTION_KEY: KEY,
      ENVIRONMENT: 'production',
    } as any;
    const res = await (worker as any).scheduled({ scheduledTime: '2026-09-29T12:34:00Z' }, env);
    expect(res.status).toBe(200);
    expect(kvGets.filter((k) => k === 'cron:logsCleanup')).toHaveLength(0);
  });

  it('тик 03:00 UTC запускает чистку логов (DELETE FROM logs WHERE ts < ?)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const sqlSeen: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            async first() { return null; },
            async all() { return { results: [] }; },
            async run() { sqlSeen.push(sql); return { meta: { changes: 0 } }; },
          }),
        }),
        // S5-04: batch исполняет statement'ы (иначе чистка логов не проверяется).
        async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const s of stmts) await s?.run?.(); return []; },
      },
      KV: { get: async () => null, put: async () => {}, delete: async () => {} },
      ENCRYPTION_KEY: KEY,
      ENVIRONMENT: 'production',
    } as any;
    await (worker as any).scheduled({ scheduledTime: '2026-09-29T03:00:00Z' }, env);
    expect(sqlSeen.some((s) => s.includes('DELETE FROM logs WHERE ts < ?'))).toBe(true);
  });
});
