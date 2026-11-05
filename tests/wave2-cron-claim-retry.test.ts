// Волна 2 аудита 2026-10-18, крон-очередь:
//  - F-013: processDue захватывает задачу атомарно (claimScheduledSend) —
//    двойной вызов за один «тик» исполняет задачу ровно один раз;
//  - F-028: 429 от Telegram с parameters.retry_after — задача переносится на
//    now+retry_after БЕЗ роста attempts, захват освобождается;
//    429 на часть получателей рассылки — в очередь возвращается только остаток.
// Harness — клон tests/cron-scheduled.test.ts (фейковый D1 с честным
// хранилищем scheduled_sends, batch СОСЕДНИЙ prepare, §18/19).
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');

interface SendRow {
  id: number;
  bot_id: string;
  user_id: number;
  method: string;
  payload_json: string;
  send_at: number;
  attempts: number;
  created_at: number;
  claimed_at?: number | null;
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function makeCronDb(seed: { sends?: SendRow[]; bots?: any[] } = {}) {
  const sends: SendRow[] = [...(seed.sends ?? [])];
  const bots: any[] = [...(seed.bots ?? [])];
  const logs: Array<{ bot_id: string; user_id: number | null; event: string }> = [];
  let nextLogId = 1;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const s = norm(sql);
          return {
            async first<T>() {
              if (s === 'SELECT attempts FROM scheduled_sends WHERE id = ?') {
                const row = sends.find((r) => r.id === Number(args[0]));
                return (row ? { attempts: row.attempts } : null) as T;
              }
              if (s === 'SELECT * FROM bots WHERE id = ?') {
                return (bots.find((b) => b.id === args[0]) ?? null) as T;
              }
              return null as T;
            },
            async all<T>() {
              if (s.startsWith('SELECT id, bot_id, user_id, method, payload_json FROM scheduled_sends WHERE send_at <= ?')) {
                const now = Number(args[0]);
                const staleBefore = Number(args[1]);
                const due = sends
                  .filter((r) => r.send_at <= now && (r.claimed_at == null || r.claimed_at < staleBefore))
                  .sort((a, b) => a.send_at - b.send_at)
                  .slice(0, 50)
                  .map(({ id, bot_id, user_id, method, payload_json }) => ({ id, bot_id, user_id, method, payload_json }));
                return { results: due } as { results: T[] };
              }
              return { results: [] } as { results: T[] };
            },
            async run() {
              if (s === 'DELETE FROM scheduled_sends WHERE id = ?') {
                const i = sends.findIndex((r) => r.id === Number(args[0]));
                if (i >= 0) sends.splice(i, 1);
                return { meta: { changes: i >= 0 ? 1 : 0 } };
              }
              if (s === 'UPDATE scheduled_sends SET attempts = ? WHERE id = ?') {
                const row = sends.find((r) => r.id === Number(args[1]));
                if (row) row.attempts = Number(args[0]);
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (s === 'UPDATE scheduled_sends SET claimed_at = ? WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)') {
                const row = sends.find((r) => r.id === Number(args[1]));
                if (row && (row.claimed_at == null || row.claimed_at < Number(args[2]))) {
                  row.claimed_at = Number(args[0]);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (s === 'UPDATE scheduled_sends SET send_at = ?, claimed_at = NULL WHERE id = ?') {
                const row = sends.find((r) => r.id === Number(args[1]));
                if (row) { row.send_at = Number(args[0]); row.claimed_at = null; }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (s === 'UPDATE scheduled_sends SET send_at = ?, payload_json = ?, claimed_at = NULL WHERE id = ?') {
                const row = sends.find((r) => r.id === Number(args[2]));
                if (row) { row.send_at = Number(args[0]); row.payload_json = String(args[1]); row.claimed_at = null; }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (s === 'UPDATE scheduled_sends SET send_at = ? WHERE id = ?') {
                const row = sends.find((r) => r.id === Number(args[1]));
                if (row) row.send_at = Number(args[0]);
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (s === 'INSERT INTO logs (bot_id, user_id, event, ts) VALUES (?,?,?,?)') {
                logs.push({ bot_id: String(args[0]), user_id: args[1] == null ? null : Number(args[1]), event: String(args[2]) });
                return { meta: { changes: 1, last_row_id: nextLogId++ } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    __sends: sends,
    __logs: logs,
  };
  return db;
}

function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

function sendRow(id: number, overrides: Partial<SendRow> = {}): SendRow {
  return {
    id,
    bot_id: 'bot1',
    user_id: 100,
    method: 'broadcast',
    payload_json: JSON.stringify({ text: 'привет', users: [100] }),
    send_at: Date.now() - 1000,
    attempts: 0,
    created_at: Date.now() - 60_000,
    ...overrides,
  };
}

async function makeEnv(sends: SendRow[]) {
  const enc = await encryptToken('123456:TEST-TOKEN', ENC_KEY);
  const db = makeCronDb({ sends, bots: [{ id: 'bot1', token_enc: enc, active: 1 }] });
  const env = { DB: db, KV: makeKV(), ENCRYPTION_KEY: ENC_KEY, ENVIRONMENT: 'production' } as any;
  return { db, env };
}

afterEach(() => vi.unstubAllGlobals());

describe('F-013: claim в processDue', () => {
  it('двойной тик на одной выборке — задача исполняется один раз', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { db, env } = await makeEnv([sendRow(1, { payload_json: JSON.stringify({ text: 'ок', users: [100, 200] }) })]);
    // Первый тик обрабатывает и удаляет задачу.
    const r1 = await (worker as any).scheduled({}, env);
    expect(await r1.text()).toContain('processed 1');
    // Второй тик (дублирующий, «другой изолят») — очереди уже нет.
    const r2 = await (worker as any).scheduled({}, env);
    expect(await r2.text()).toContain('processed 0');
    expect(db.__logs.filter((l: any) => l.event.startsWith('broadcast.chunk.'))).toHaveLength(1);
  });

  it('захваченная другим изолятом строка пропускается (claim → false)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const row = sendRow(1);
    const { db, env } = await makeEnv([row]);
    // «Другой изолят» уже держит свежий захват: dueScheduled её не вернёт.
    row.claimed_at = Date.now();
    const res = await (worker as any).scheduled({}, env);
    expect(await res.text()).toContain('processed 0');
    expect(db.__sends).toHaveLength(1); // задача жива, не обработана нами
  });
});

describe('F-028: 429 retry_after', () => {
  it('429 на всю пачку: задача перенесена на now+retry_after, attempts не вырос, захват сброшен', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 5 } }), { status: 429 })
    ));
    const { db, env } = await makeEnv([sendRow(1, { payload_json: JSON.stringify({ text: 'ок', users: [100] }) })]);
    const res = await (worker as any).scheduled({}, env);
    expect(await res.text()).toContain('processed 1');
    const row = db.__sends.find((r: SendRow) => r.id === 1);
    expect(row).toBeTruthy();
    expect(row.attempts).toBe(0); // 429 — не попытка
    expect(row.claimed_at).toBeNull(); // захват освобождён
    expect(row.send_at).toBeGreaterThan(Date.now() + 3000); // ~now+5s
    expect(db.__logs.some((l: any) => l.event.startsWith('broadcast.rate_limited.1.5s'))).toBe(true);
  });

  it('429 части получателей: в очередь возвращается только остаток', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 3 } }), { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const { db, env } = await makeEnv([sendRow(1, { payload_json: JSON.stringify({ text: 'ок', users: [100, 200] }) })]);
    await (worker as any).scheduled({}, env);
    const row = db.__sends.find((r: SendRow) => r.id === 1);
    expect(row).toBeTruthy();
    const payload = JSON.parse(row.payload_json);
    // Оба в одной параллельной пачке (BROADCAST_PARALLEL=8): 429 получил
    // первый запрос, второй ушёл — в остатке только неполучивший 100.
    expect(payload.users).toEqual([100]);
    expect(row.attempts).toBe(0);
    expect(row.claimed_at).toBeNull();
  });

  it('следующий тик после retry_after доводит остаток', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 1 } }), { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const { db, env } = await makeEnv([sendRow(1, { send_at: Date.now() - 5000, payload_json: JSON.stringify({ text: 'ок', users: [100, 200] }) })]);
    await (worker as any).scheduled({}, env);
    expect(db.__sends).toHaveLength(1);
    // «Прошло» больше секунды: второй тик забирает остаток.
    db.__sends[0].send_at = Date.now() - 1;
    const r2 = await (worker as any).scheduled({}, env);
    expect(await r2.text()).toContain('processed 1');
    expect(db.__sends).toHaveLength(0);
    expect(db.__logs.some((l: any) => l.event === 'broadcast.chunk.1')).toBe(true);
  });
});
