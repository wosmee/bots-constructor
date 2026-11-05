// DH-02: cron/scheduled — очередь отложенных отправок (scheduled_sends).
//
// Соответствие имён из задачи и реального кода:
//  - listDueScheduledSends      → dueScheduled (db.ts): send_at <= now, ASC, LIMIT 50;
//  - markScheduledSendSent      → deleteScheduled (db.ts): выполненная задача
//    УДАЛЯЕТСЯ из очереди — статуса 'sent' в схеме нет (миграция 0002);
//  - incrementScheduledSendAttempt → bumpScheduledAttempt (db.ts): читает attempts,
//    пишет +1, возвращает новое значение.
//
// Поведение MAX_ATTEMPTS живёт в processDue (worker/src/index.ts, не
// экспортируется), поэтому «задача с исчерпанными попытками больше не
// возвращается» проверяется сквозным вызовом worker.scheduled на фейковом D1:
//  - успех → задача удалена, лог broadcast.chunk.N;
//  - сбой при attempts < MAX → attempts+1, send_at отодвинут в будущее
//    (следующий тик dueScheduled её не вернёт), лог scheduled.retry.N;
//  - сбой при attempts = MAX-1 → задача удалена (не останется в очереди),
//    лог scheduled.gaveup.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import {
  dueScheduled,
  deleteScheduled,
  bumpScheduledAttempt,
  rescheduleScheduled,
} from '../worker/src/db';
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
  claimed_at?: number | null; // F-013: метка атомарного захвата (миграция 0029)
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

// Фейковый D1 с честным хранилищем строк scheduled_sends: WHERE send_at <= ?,
// ORDER BY send_at ASC и LIMIT 50 исполняются как в настоящей базе.
function makeCronDb(seed: { sends?: SendRow[]; bots?: any[] } = {}) {
  const sends: SendRow[] = [...(seed.sends ?? [])];
  const bots: any[] = [...(seed.bots ?? [])];
  const logs: Array<{ bot_id: string; user_id: number | null; event: string; ts: number }> = [];
  const recorded: Array<{ sql: string; args: unknown[] }> = [];
  let nextLogId = 1;

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const s = norm(sql);
          return {
            async first<T>() {
              recorded.push({ sql: s, args });
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
              recorded.push({ sql: s, args });
              if (s.startsWith('SELECT id, bot_id, user_id, method, payload_json FROM scheduled_sends WHERE send_at <= ?')) {
                const now = Number(args[0]);
                const staleBefore = Number(args[1]); // F-013: claimed_at < now - stale
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
              recorded.push({ sql: s, args });
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
              // F-013: атомарный захват — changes=1 только у победителя.
              if (s === 'UPDATE scheduled_sends SET claimed_at = ? WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)') {
                const row = sends.find((r) => r.id === Number(args[1]));
                if (row && (row.claimed_at == null || row.claimed_at < Number(args[2]))) {
                  row.claimed_at = Number(args[0]);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (s === 'UPDATE scheduled_sends SET send_at = ? WHERE id = ?') {
                const row = sends.find((r) => r.id === Number(args[1]));
                if (row) row.send_at = Number(args[0]);
                return { meta: { changes: row ? 1 : 0 } };
              }
              // F-028/F-013: перенос с освобождением захвата.
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
              if (s === 'INSERT INTO logs (bot_id, user_id, event, ts) VALUES (?,?,?,?)') {
                logs.push({ bot_id: String(args[0]), user_id: args[1] == null ? null : Number(args[1]), event: String(args[2]), ts: Number(args[3]) });
                return { meta: { changes: 1, last_row_id: nextLogId++ } };
              }
              if (s === 'DELETE FROM logs WHERE ts < ?') {
                const before = logs.length;
                for (let i = logs.length - 1; i >= 0; i--) if (logs[i].ts < Number(args[0])) logs.splice(i, 1);
                return { meta: { changes: before - logs.length } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    // batch — СОСЕД prepare (см. урок раздела 18/19): исполняем statement'ы по очереди.
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    __sends: sends,
    __logs: logs,
    __recorded: recorded,
  };
  return db;
}

function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dueScheduled (listDueScheduledSends)', () => {
  it('возвращает только задачи с send_at <= now, по возрастанию send_at', async () => {
    const now = Date.now();
    const db = makeCronDb({
      sends: [
        sendRow(1, { send_at: now - 5000 }),
        sendRow(2, { send_at: now + 60_000 }), // ещё не пора
        sendRow(3, { send_at: now - 10_000 }),
        sendRow(4, { send_at: now }), // граница включительно
      ],
    });
    const due = await dueScheduled(db as any, now);
    expect(due.map((r) => r.id)).toEqual([3, 1, 4]);
  });

  it('LIMIT 50: больше 50 готовых задач — вернутся первые 50', async () => {
    const now = Date.now();
    const sends = Array.from({ length: 60 }, (_, i) => sendRow(i + 1, { send_at: now - (60 - i) * 1000 }));
    const db = makeCronDb({ sends });
    const due = await dueScheduled(db as any, now);
    expect(due).toHaveLength(50);
    // Первые 50 = самые ранние по send_at (id 1..50).
    expect(due.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('пустая очередь → пустой список', async () => {
    const db = makeCronDb();
    await expect(dueScheduled(db as any, Date.now())).resolves.toEqual([]);
  });
});

describe('bumpScheduledAttempt (incrementScheduledSendAttempt)', () => {
  it('инкрементирует attempts и возвращает новое значение', async () => {
    const db = makeCronDb({ sends: [sendRow(7, { attempts: 2 })] });
    await expect(bumpScheduledAttempt(db as any, 7)).resolves.toBe(3);
    expect(db.__sends[0].attempts).toBe(3);
    await expect(bumpScheduledAttempt(db as any, 7)).resolves.toBe(4);
    expect(db.__sends[0].attempts).toBe(4);
  });

  it('attempts = NULL (легаси-строка) считается нулём', async () => {
    const db = makeCronDb({ sends: [sendRow(8, { attempts: null as any })] });
    await expect(bumpScheduledAttempt(db as any, 8)).resolves.toBe(1);
  });

  it('несуществующий id → 1, очереди не вредит', async () => {
    const db = makeCronDb();
    await expect(bumpScheduledAttempt(db as any, 999)).resolves.toBe(1);
  });
});

describe('deleteScheduled / rescheduleScheduled', () => {
  it('deleteScheduled (markScheduledSendSent) убирает задачу из очереди', async () => {
    const db = makeCronDb({ sends: [sendRow(1), sendRow(2)] });
    await deleteScheduled(db as any, 1);
    expect(db.__sends.map((r) => r.id)).toEqual([2]);
    await expect(dueScheduled(db as any, Date.now() + 10_000)).resolves.toHaveLength(1);
  });

  it('rescheduleScheduled отодвигает send_at — задача не возвращается до nowego срока', async () => {
    const db = makeCronDb({ sends: [sendRow(1)] });
    const future = Date.now() + 60_000;
    await rescheduleScheduled(db as any, 1, future);
    expect(db.__sends[0].send_at).toBe(future);
    await expect(dueScheduled(db as any, Date.now())).resolves.toEqual([]);
    await expect(dueScheduled(db as any, future)).resolves.toHaveLength(1);
  });
});

// ---------------- сквозной крон: worker.scheduled + processDue ----------------

// tokenEnc: валидный шифртокена бота. 'corrupt' — мусорный blob: decryptToken
// бросает обычную Error (не FatalJobError) → processDue уходит в ветку ретрая.
// Это единственный лёгкий способ получить НЕфатальный сбой: ошибки отправки в
// broadcast-ветке глотаются per-uid catch'ем, а отсутствующий сценарий — фатален.
async function makeEnv(sends: SendRow[], tokenEnc?: string) {
  const enc = tokenEnc ?? (await encryptToken('123456:TEST-TOKEN', ENC_KEY));
  const db = makeCronDb({ sends, bots: [{ id: 'bot1', token_enc: enc, active: 1 }] });
  const kv = makeKV();
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ENVIRONMENT: 'production' } as any;
  return { db, kv, env };
}

function stubFetch(impl: (url: any, init?: any) => Promise<any>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('worker.scheduled (processDue) — ретраи и потолок попыток', () => {
  it('успешная рассылка: задача удалена, лог broadcast.chunk.N', async () => {
    const sends = [
      sendRow(1, { payload_json: JSON.stringify({ text: 'ок', users: [100, 200] }) }),
    ];
    const { db, env } = await makeEnv(sends);
    stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await (worker as any).scheduled({}, env);
    const body = await res.text();
    expect(body).toContain('processed 1');
    expect(db.__sends).toHaveLength(0);
    expect(db.__logs.some((l) => l.event === 'broadcast.chunk.2')).toBe(true);
  });

  it('сбой при attempts=0: attempts+1, send_at в будущем, следующий тик задачу не вернёт', async () => {
    // НЕфатальный сбой: token_enc повреждён → decryptToken бросает обычную Error.
    // (Ошибка fetch в broadcast-ветке не считается: её глотает per-uid catch.)
    const { db, env } = await makeEnv([sendRow(1)], 'corrupt');

    const res = await (worker as any).scheduled({}, env);
    expect(await res.text()).toContain('retried 1');

    const row = db.__sends.find((r: SendRow) => r.id === 1);
    expect(row).toBeTruthy();
    expect(row.attempts).toBe(1);
    expect(row.send_at).toBeGreaterThan(Date.now());
    expect(db.__logs.some((l: any) => l.event === 'scheduled.retry.1')).toBe(true);
    // Ключевая гарантия: после ретрая dueScheduled на текущий момент пуста.
    await expect(dueScheduled(db as any, Date.now())).resolves.toEqual([]);
  });

  it('сбой при attempts=MAX-1: задача выброшена из очереди, лог scheduled.gaveup', async () => {
    // MAX_ATTEMPTS = 5 (worker/src/index.ts): attempts=4 → после сбоя станет 5.
    const { db, env } = await makeEnv([sendRow(1, { attempts: 4 })], 'corrupt');

    const res = await (worker as any).scheduled({}, env);
    expect(await res.text()).toContain('dropped 1');
    expect(db.__sends).toHaveLength(0);
    expect(db.__logs.some((l: any) => l.event === 'scheduled.gaveup')).toBe(true);
    // Задача с исчерпанными попытками в очереди не остаётся — следующий тик её не вернёт.
    await expect(dueScheduled(db as any, Date.now() + 3600_000)).resolves.toEqual([]);
  });

  it('фатальная ошибка (бот удалён): задача дропается сразу, без ретраев', async () => {
    const tokenEnc = await encryptToken('123456:TEST-TOKEN', ENC_KEY);
    const db = makeCronDb({ sends: [sendRow(1, { bot_id: 'bot-ghost' })], bots: [{ id: 'bot1', token_enc: tokenEnc }] });
    const env = { DB: db, KV: makeKV(), ENCRYPTION_KEY: ENC_KEY, ENVIRONMENT: 'production' } as any;
    stubFetch(async () => new Response('{}', { status: 200 }));

    const res = await (worker as any).scheduled({}, env);
    expect(await res.text()).toContain('dropped 1');
    expect(db.__sends).toHaveLength(0);
    expect(db.__logs.some((l: any) => l.event === 'scheduled.dropped')).toBe(true);
  });

  it('задача с будущим send_at не трогается кроном', async () => {
    const future = Date.now() + 3600_000;
    const { db, env } = await makeEnv([sendRow(1, { send_at: future })]);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await (worker as any).scheduled({}, env);
    expect(await res.text()).toContain('processed 0');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.__sends).toHaveLength(1);
  });
});
