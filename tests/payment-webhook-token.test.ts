// B1: короткий публичный адрес вебхука /p/<token> (миграция 0022).
//
// Покрытие:
//  - генерация токена: разрешённый алфавит (без 0/O/1/l/I), длина 8–12,
//    повтор при смоделированной коллизии уникального индекса;
//  - getPaymentConnectionByToken: ищет только enabled = 1;
//  - POST /p/<token>: валидная HMAC-подпись → 200 и заказ оплачен,
//    битая подпись → 400 и ни одной записи;
//  - POST /pay/:botId/:webhookPath (легаси) → 410 и НИ ОДНОГО обращения к D1/KV;
//  - ленивый бэкфилл: строка с webhook_token IS NULL получает ровно один токен,
//    повторное чтение не ротирует его;
//  - ротация: regenerate-webhook выдаёт новый токен, старый перестаёт находиться.
//
// Паттерн фейкового D1 — из tests/payment-webhook.test.ts (маршрутизация по
// подстрокам SQL) и tests/worker-safety.test.ts.
import { describe, expect, it } from 'vitest';
import worker, { _testOnly } from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import { hmacHex } from '../worker/src/blocks/payments/providers';
import { getPaymentConnectionByToken } from '../worker/src/db';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef'); // ровно 32 байта
const BOT_ID = 'bot-tok-1';
const CONN_ID = 'conn-tok-1';
const TOKEN = 'AB23CD45EF';
const SECRET = 'rotating-webhook-secret';
const ORDER_EXT = 'order-tok-1';
const ADMIN_KEY = 'test-admin-key';

type Recorded = { sql: string; args: unknown[] };

// Состояние «базы»: одна строка подключения, токен может быть null (легаси).
interface TokenDbState {
  webhookToken: string | null;
  orderStatus: string;
}

function makeFakeDb(state: TokenDbState) {
  const recorded: Recorded[] = [];
  const runCount = { markPaid: 0, anyWrite: 0 };

  const connRow = async () => ({
    id: CONN_ID,
    bot_id: BOT_ID,
    provider: 'custom',
    title: 'Тестовый провайдер',
    config_json: '{}',
    secrets_enc: await encryptToken(JSON.stringify({ webhookSecret: SECRET }), ENC_KEY),
    webhook_path: 'legacy-path-unused',
    webhook_token: state.webhookToken,
    enabled: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              recorded.push({ sql, args });
              // Поиск подключения по короткому коду (роут /p/:token) — только enabled = 1.
              if (sql.includes('FROM payment_connections WHERE webhook_token = ? AND enabled = 1')) {
                if (state.webhookToken == null || args[0] !== state.webhookToken) return null;
                return (await connRow()) as T;
              }
              // Проверка занятости токена при генерации: любой существующий токен «занят».
              if (sql.includes('SELECT id FROM payment_connections WHERE webhook_token = ?')) {
                return state.webhookToken != null && args[0] === state.webhookToken ? ({ id: CONN_ID } as T) : null;
              }
              // Перечитывание строки после ленивого бэкфилла (guard-ветка).
              if (sql.includes('SELECT * FROM payment_connections WHERE id = ?')) {
                return args[0] === CONN_ID ? ((await connRow()) as T) : null;
              }
              // getPaymentConnection(botId, cid) — проверка существования.
              if (sql.includes('FROM payment_connections WHERE bot_id = ? AND id = ?')) {
                return args[0] === BOT_ID && args[1] === CONN_ID ? ((await connRow()) as T) : null;
              }
              // getBot (владелец-загрузка для /api/bots/:id/payments/*).
              if (sql.includes('FROM bots WHERE id = ?')) {
                if (args[0] !== BOT_ID) return null;
                return {
                  id: BOT_ID,
                  name: 'TokBot',
                  owner_id: 'admin',
                  active: 1,
                  created_at: Date.now(),
                  token_enc: await encryptToken('123456:TEST-TOKEN', ENC_KEY),
                } as T;
              }
              if (sql.includes('FROM payment_orders WHERE bot_id = ? AND external_id = ?')) {
                if (args[1] !== ORDER_EXT) return null;
                return {
                  id: 'order-int-tok',
                  bot_id: BOT_ID,
                  connection_id: CONN_ID,
                  user_id: 4242,
                  external_id: ORDER_EXT,
                  amount: 10000,
                  currency: 'RUB',
                  status: state.orderStatus,
                  payload_json: '{}',
                } as T;
              }
              if (sql.includes('current_block, vars_json FROM sessions')) {
                return { current_block: null, vars_json: '{}' } as T;
              }
              if (sql.includes('first_name, username FROM sessions')) return null;
              if (sql.includes('flow_json, version FROM scenarios')) return null;
              if (sql.includes('inviter_user_id FROM referrals')) return null;
              return null;
            },
            async run() {
              recorded.push({ sql, args });
              runCount.anyWrite++;
              // Ленивый бэкфилл: guard IS NULL — токен запишется только если его ещё нет.
              if (sql.includes('SET webhook_token = ?') && sql.includes('webhook_token IS NULL')) {
                if (state.webhookToken == null) {
                  state.webhookToken = String(args[0]);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              // Ротация:无条件ная перезапись токена строки.
              if (sql.includes('SET webhook_token = ?')) {
                state.webhookToken = String(args[0]);
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE payment_orders') && sql.includes("status = 'paid'")) {
                runCount.markPaid++;
                if (state.orderStatus !== 'paid') {
                  state.orderStatus = 'paid';
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 1 } };
            },
            async all<T>() {
              recorded.push({ sql, args });
              // Список подключений бота (ленивый бэкфилл).
              if (sql.includes('FROM payment_connections WHERE bot_id = ?')) {
                return { results: [await connRow()] } as { results: T[] };
              }
              return { results: [] } as { results: T[] };
            },
          };
        },
        // S5-04: batch — сосед prepare и РЕАЛЬНО исполняет statement'ы (§18/19).
        async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) {
          for (const s of stmts) await s?.run?.();
          return [];
        },
      };
    },
  };
  return { db, recorded, runCount };
}

function makeEnv(state: TokenDbState) {
  const { db, recorded, runCount } = makeFakeDb(state);
  const kv = {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production' } as any;
  return { env, recorded, runCount };
}

async function signedPost(env: any, url: string, rawBody: string, secret = SECRET) {
  const sig = await hmacHex(secret, rawBody);
  const req = new Request(url, {
    method: 'POST',
    // WS-06: X-Timestamp обязателен для custom-провайдера — без него 400.
    headers: {
      'content-type': 'application/json',
      'x-signature': sig,
      'x-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: rawBody,
  });
  return (worker as any).fetch(req, env, {});
}

function paidBody(): string {
  return JSON.stringify({ orderId: ORDER_EXT, status: 'paid', amount: 10000, currency: 'RUB' });
}

describe('генерация короткого токена вебхука', () => {
  it('алфавит без неоднозначных символов, длина 8–12', () => {
    for (let i = 0; i < 200; i++) {
      const tok = _testOnly.randomWebhookToken();
      expect(tok).toMatch(/^[2-9A-HJ-NP-Z]{8,12}$/);
      expect(tok).not.toMatch(/[01OIl]/);
    }
  });

  it('повторяет попытку при коллизии уникального индекса', async () => {
    // Первые два кандидата «заняты» (first() возвращает строку), третий свободен.
    let calls = 0;
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            calls++;
            return calls <= 2 ? { id: 'someone' } : null;
          },
        }),
      }),
    } as any;
    const token = await _testOnly.generateUniqueWebhookToken(db);
    expect(token).toMatch(/^[2-9A-HJ-NP-Z]{8,12}$/);
    expect(calls).toBe(3); // две коллизии + успешная третья попытка
  });

  it('после исчерпания попыток — понятная ошибка, а не дубликат', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ id: 'always-taken' }),
        }),
      }),
    } as any;
    await expect(_testOnly.generateUniqueWebhookToken(db, 3)).rejects.toThrow(/уникальный адрес/i);
  });
});

describe('getPaymentConnectionByToken', () => {
  it('ищет только enabled = 1 и параметризован по токену', async () => {
    const seen: Recorded[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            seen.push({ sql, args });
            return {
              first: async () => (args[0] === TOKEN ? { id: CONN_ID, enabled: 1 } : null),
            };
          },
        };
      },
    } as any;
    const row = await getPaymentConnectionByToken(db, TOKEN);
    expect(row?.id).toBe(CONN_ID);
    expect(seen[0].sql).toContain('WHERE webhook_token = ? AND enabled = 1');
    // Отключённое подключение не находится: тот же SQL, enabled в условии.
    expect(seen[0].sql).not.toContain('OR enabled = 0');
    const none = await getPaymentConnectionByToken(db, '');
    expect(none).toBeNull();
  });
});

describe('POST /p/:token', () => {
  it('валидная HMAC-подпись → 200, заказ отмечен оплаченным', async () => {
    const state: TokenDbState = { webhookToken: TOKEN, orderStatus: 'created' };
    const { env, runCount } = makeEnv(state);
    const res = await signedPost(env, `https://bots.example/p/${TOKEN}`, paidBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'paid' });
    expect(runCount.markPaid).toBe(1);
    expect(state.orderStatus).toBe('paid');
  });

  it('битая подпись → 400 и ни одной записи в бизнес-таблицы', async () => {
    const state: TokenDbState = { webhookToken: TOKEN, orderStatus: 'created' };
    const { env, recorded, runCount } = makeEnv(state);
    const res = await signedPost(env, `https://bots.example/p/${TOKEN}`, paidBody(), 'wrong-secret');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid signature' });
    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');
    // Никаких записей кроме журнала отказов.
    expect(recorded.filter((r) => r.sql.includes('UPDATE payment_orders'))).toHaveLength(0);
    expect(recorded.filter((r) => r.sql.includes('INSERT INTO sessions'))).toHaveLength(0);
  });
});

describe('легаси-роут /pay/:botId/:webhookPath', () => {
  it('всегда 410 Gone и ни одного обращения к D1/KV', async () => {
    const state: TokenDbState = { webhookToken: TOKEN, orderStatus: 'created' };
    const { env, recorded } = makeEnv(state);
    let kvTouched = 0;
    (env.KV as any).get = async () => {
      kvTouched++;
      return null;
    };
    const res = await signedPost(
      env,
      `https://bots.example/pay/${BOT_ID}/someoldpath123`,
      paidBody()
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('устарел');
    // Спай доказывает: роут не сделал ни одного запроса.
    expect(recorded).toHaveLength(0);
    expect(kvTouched).toBe(0);
  });
});

describe('ленивый бэкфилл и ротация токена', () => {
  it('строка без токена получает ровно один токен; повторное чтение не ротирует', async () => {
    const state: TokenDbState = { webhookToken: null, orderStatus: 'created' };
    const { env, recorded } = makeEnv(state);

    const get1 = await (worker as any).fetch(
      new Request(`https://bots.example/api/bots/${BOT_ID}/payments/connections`, {
        headers: { 'x-admin-key': ADMIN_KEY },
      }),
      env,
      {}
    );
    expect(get1.status).toBe(200);
    const body1 = (await get1.json()) as { connections: any[] };
    const token1 = body1.connections[0].webhook_token;
    expect(token1).toMatch(/^[2-9A-HJ-NP-Z]{8,12}$/);
    // Секреты — по-прежнему только маска.
    expect(body1.connections[0].secrets).toEqual({ has: true, keys: ['webhookSecret'] });
    expect(JSON.stringify(body1)).not.toContain(SECRET);

    const get2 = await (worker as any).fetch(
      new Request(`https://bots.example/api/bots/${BOT_ID}/payments/connections`, {
        headers: { 'x-admin-key': ADMIN_KEY },
      }),
      env,
      {}
    );
    const body2 = (await get2.json()) as { connections: any[] };
    expect(body2.connections[0].webhook_token).toBe(token1);

    // Ровно один UPDATE с guard'ом IS NULL за оба чтения.
    const backfills = recorded.filter((r) => r.sql.includes('SET webhook_token = ?') && r.sql.includes('IS NULL'));
    expect(backfills).toHaveLength(1);
  });

  it('regenerate-webhook выдаёт новый токен; старый перестаёт работать', async () => {
    const state: TokenDbState = { webhookToken: TOKEN, orderStatus: 'created' };
    const { env, recorded } = makeEnv(state);

    const res = await (worker as any).fetch(
      new Request(
        `https://bots.example/api/bots/${BOT_ID}/payments/connections/${CONN_ID}/regenerate-webhook`,
        { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY } }
      ),
      env,
      {}
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; webhook_token: string; connection: any };
    expect(body.webhook_token).toMatch(/^[2-9A-HJ-NP-Z]{8,12}$/);
    expect(body.webhook_token).not.toBe(TOKEN);
    // Журнал: событие ротации без значения токена.
    const logInserts = recorded.filter((r) => r.sql.includes('INSERT INTO logs'));
    expect(logInserts.some((r) => String(r.args[2]) === 'payments.connection.webhook.rotated')).toBe(true);
    for (const l of logInserts) expect(String(l.args[2])).not.toContain(body.webhook_token);

    // Старый код больше не находится: /p/<старый> → 404 без записей.
    const old = await signedPost(env, `https://bots.example/p/${TOKEN}`, paidBody());
    expect(old.status).toBe(404);
  });

  it('regenerate-webhook чужого бота недоступен обычной сессии (404)', async () => {
    const state: TokenDbState = { webhookToken: TOKEN, orderStatus: 'created' };
    const { env } = makeEnv(state);
    // Без x-admin-key и без Bearer — 401; с admin-ключом, но чужой botId — 404.
    const anon = await (worker as any).fetch(
      new Request(
        `https://bots.example/api/bots/other-bot/payments/connections/${CONN_ID}/regenerate-webhook`,
        { method: 'POST' }
      ),
      env,
      {}
    );
    expect(anon.status).toBe(401);
    const foreign = await (worker as any).fetch(
      new Request(
        `https://bots.example/api/bots/other-bot/payments/connections/${CONN_ID}/regenerate-webhook`,
        { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY } }
      ),
      env,
      {}
    );
    expect(foreign.status).toBe(404);
  });
});
