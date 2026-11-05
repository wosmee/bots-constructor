// Волна 2 (ES-10): атомарный дневной лимит рассылки. enqueue сегментной
// рассылки списывает бюджет ОДНИМ tryBumpBroadcastCounter ДО постановки в
// очередь: два параллельных enqueue по 6 при cap=10 — только один проходит
// (прежний read-then-bump пропускал оба). База — РЕАЛЬНЫЙ SQLite (node:sqlite),
// паттерн tests/db-wave2.test.ts: SQL с ON CONFLICT/WHERE исполняется честно.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { _testOnly } from '../worker/src/index';

const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');
const MIG_DIR = join(__dirname, '..', 'worker', 'migrations');

function makeDb(): any {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
  }
  return {
    __raw: raw,
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async run() {
          const r = raw.prepare(sql).run(...(args as any));
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
        async all() {
          return { results: raw.prepare(sql).all(...(args as any)), success: true };
        },
        async first() {
          return raw.prepare(sql).get(...(args as any)) ?? null;
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function seedSubscribers(db: any, botId: string, users: number[]) {
  for (const u of users) {
    db.__raw
      .prepare('INSERT INTO subscribers (bot_id, user_id, created_at) VALUES (?,?,?)')
      .run(botId, u, Date.now());
  }
}

function makeEnv(db: any) {
  return { DB: db, KV: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;
}

describe('ES-10: дневной лимит рассылки атомарен', () => {
  it('cap=10, два параллельных enqueue по 6 — проходит только один', async () => {
    const db = makeDb();
    seedSubscribers(db, 'bot1', [1, 2, 3, 4, 5, 6]);
    const env = makeEnv(db);
    const ops = _testOnly.makeBroadcastOps(env, 'bot1', 'tok', 7);
    const payload = { text: 'рассылка', dailyCap: 10 };
    const [a, b] = await Promise.all([
      ops.enqueue({}, payload),
      ops.enqueue({}, payload),
    ]);
    // Ровно один прошёл (6), второй — отказ (0); суммарно cap не превышен.
    expect([a, b].sort((x, y) => x - y)).toEqual([0, 6]);
    const counter = db.__raw
      .prepare("SELECT sent FROM broadcast_counters WHERE bot_id='bot1'")
      .get() as any;
    expect(counter.sent).toBe(6);
    // Лог отказа записан.
    const logs = db.__raw.prepare("SELECT event FROM logs").all() as any[];
    expect(logs.some((l) => l.event === 'segment.daily_cap')).toBe(true);
    expect(logs.some((l) => String(l.event).startsWith('segment.queued.6'))).toBe(true);
  });

  it('без капа очередь ставится как раньше', async () => {
    const db = makeDb();
    seedSubscribers(db, 'bot1', [1, 2, 3]);
    const env = makeEnv(db);
    const ops = _testOnly.makeBroadcastOps(env, 'bot1', 'tok', 7);
    const n = await ops.enqueue({}, { text: 'привет' });
    expect(n).toBe(3);
    const rows = db.__raw.prepare("SELECT COUNT(*) AS n FROM scheduled_sends WHERE method='broadcast'").get() as any;
    expect(Number(rows.n)).toBe(1);
    // Без капа счётчик не двигается.
    const counter = db.__raw.prepare("SELECT sent FROM broadcast_counters WHERE bot_id='bot1'").get();
    expect(counter).toBeUndefined();
  });

  it('последовательные enqueue в пределах капа проходят, сверх — отказ', async () => {
    const db = makeDb();
    seedSubscribers(db, 'bot1', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const env = makeEnv(db);
    const ops = _testOnly.makeBroadcastOps(env, 'bot1', 'tok', 7);
    // Первый: 10 получателей при cap=10 — проходит целиком.
    expect(await ops.enqueue({}, { text: 'a', dailyCap: 10 })).toBe(10);
    // Второй: бюджет исчерпан — отказ.
    expect(await ops.enqueue({}, { text: 'b', dailyCap: 10 })).toBe(0);
    const counter = db.__raw
      .prepare("SELECT sent FROM broadcast_counters WHERE bot_id='bot1'")
      .get() as any;
    expect(counter.sent).toBe(10);
  });

  it('отказ при исчерпанном капе не ставит строк в очередь', async () => {
    const db = makeDb();
    seedSubscribers(db, 'bot1', [1, 2]);
    const env = makeEnv(db);
    const ops = _testOnly.makeBroadcastOps(env, 'bot1', 'tok', 7);
    db.__raw
      .prepare("INSERT INTO broadcast_counters (bot_id, day, sent, updated_at) VALUES (?,?,?,?)")
      .run('bot1', new Date().toISOString().slice(0, 10), 10, Date.now());
    expect(await ops.enqueue({}, { text: 'a', dailyCap: 10 })).toBe(0);
    const rows = db.__raw.prepare('SELECT COUNT(*) AS n FROM scheduled_sends').get() as any;
    expect(Number(rows.n)).toBe(0);
  });
});
