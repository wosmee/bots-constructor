// S5-07: yookassa-ветка публичного вебхука POST /p/:token + yookassaReverify.
//
// Тело вебхука ЮKassa НЕ подписано: verifyWebhook делает только структурный
// разбор и replay-окно, а доверие устанавливает yookassaReverify (index.ts) —
// GET https://api.yookassa.ru/v3/payments/<id> с Basic shopId:secretKey.
// Функция не экспортирована, поэтому покрываем её через роут: клон harness
// tests/payment-webhook.test.ts (фейковый D1 по подстрокам SQL) + перехват
// fetch на api.yookassa.ru.
//
// Покрытие: успешная оплата (данные из ОТВЕТА API, не из тела), отказ reverify
// → 400 unverified без записей, externalId берётся из metadata ответа API
// (подделка в теле не проходит), сверка суммы, Basic-авторизация, отсутствие
// секретов в ответах/логах.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef'); // ровно 32 байта
const BOT_ID = 'bot-yk-1';
const CONN_ID = 'conn-yk-1';
const WEBHOOK_TOKEN = 'YK23CD45AB';
const SHOP_ID = '410012345678';
const SECRET_KEY = 'sk_live_yk_test_9f3a1c7e2b';
const PAYMENT_ID = '21d5c3e1-0000-5000-9000-150000000001'; // id платежа ЮKassa (object.id)
const ORDER_EXT = 'order-yk-1'; // наш заказ (metadata.order_id в ответе API)
const USER_ID = 4242;
const ORDER_AMOUNT = 150000; // 1500.00 RUB

type Recorded = { sql: string; args: unknown[] };

function makeFakeDb(state: { orderStatus: string; orderAmount: number }) {
  const recorded: Recorded[] = [];
  const runCount = { markPaid: 0, anyWrite: 0 };
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              recorded.push({ sql, args });
              if (sql.includes('FROM payment_connections WHERE webhook_token = ?')) {
                if (args[0] !== WEBHOOK_TOKEN) return null;
                return {
                  id: CONN_ID,
                  bot_id: BOT_ID,
                  provider: 'yookassa',
                  title: 'ЮKassa',
                  config_json: JSON.stringify({ shopId: SHOP_ID, linkTemplate: 'https://pay.example/{{order}}' }),
                  secrets_enc: await encryptToken(JSON.stringify({ secretKey: SECRET_KEY }), ENC_KEY),
                  webhook_path: 'legacy-unused',
                  webhook_token: WEBHOOK_TOKEN,
                  enabled: 1,
                  created_at: Date.now(),
                  updated_at: Date.now(),
                } as T;
              }
              if (sql.includes('FROM payment_orders WHERE bot_id = ? AND external_id = ?')) {
                if (args[1] !== ORDER_EXT) return null;
                return {
                  id: 'order-int-yk',
                  bot_id: BOT_ID,
                  connection_id: CONN_ID,
                  user_id: USER_ID,
                  external_id: ORDER_EXT,
                  amount: state.orderAmount,
                  currency: 'RUB',
                  status: state.orderStatus,
                  payload_json: '{}',
                } as T;
              }
              if (sql.includes('current_block, vars_json FROM sessions')) {
                return { current_block: null, vars_json: '{}' } as T;
              }
              if (sql.includes('first_name, username FROM sessions')) return null;
              if (sql.includes('FROM bots WHERE id = ?')) {
                return {
                  id: BOT_ID,
                  name: 'YkBot',
                  owner_id: 'owner-1',
                  active: 1,
                  created_at: Date.now(),
                  token_enc: await encryptToken('123456:TEST-TOKEN', ENC_KEY),
                } as T;
              }
              if (sql.includes('flow_json, version FROM scenarios')) return null;
              if (sql.includes('inviter_user_id FROM referrals')) return null;
              return null;
            },
            async run() {
              recorded.push({ sql, args });
              runCount.anyWrite++;
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
            async all() {
              recorded.push({ sql, args });
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { db, recorded, runCount };
}

function makeEnv(state: { orderStatus: string; orderAmount: number }) {
  const { db, recorded, runCount } = makeFakeDb(state);
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'production' } as any;
  return { env, recorded, runCount, state };
}

// Тело события ЮKassa: object.id — id платежа, metadata.order_id — наш заказ.
// created_at свежий: verifyWebhook отсекает события старше 5 минут.
function eventBody(overrides: { metadata?: Record<string, string>; id?: string } = {}): string {
  return JSON.stringify({
    event: 'payment.succeeded',
    object: {
      id: overrides.id ?? PAYMENT_ID,
      created_at: new Date().toISOString(),
      amount: { value: '1500.00', currency: 'RUB' },
      ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
    },
  });
}

// Перехват fetch: все запросы к api.yookassa.ru пишутся в calls и получают
// apiResponse; остальное (Telegram) не должно вызываться в этих тестах.
function stubYkApi(apiResponse: { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(apiResponse.body), {
        status: apiResponse.status,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  return calls;
}

function postEvent(env: any, rawBody: string) {
  const req = new Request(`https://bots.example/p/${WEBHOOK_TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
  return (worker as any).fetch(req, env, {});
}

const logEventsOf = (recorded: Recorded[]) =>
  recorded.filter((r) => r.sql.includes('INSERT INTO logs')).map((r) => String(r.args[2] ?? ''));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /p/:token — yookassa: reverify через API провайдера', () => {
  it('API подтвердил succeeded → 200, заказ оплачен, сумма/externalId из ОТВЕТА API', async () => {
    const { env, recorded, runCount, state } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    const calls = stubYkApi({
      status: 200,
      body: {
        status: 'succeeded',
        amount: { value: '1500.00', currency: 'RUB' },
        metadata: { order_id: ORDER_EXT },
      },
    });

    const res = await postEvent(env, eventBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'paid' });
    expect(runCount.markPaid).toBe(1);
    expect(state.orderStatus).toBe('paid');

    // Ровно один запрос к API: GET /v3/payments/<object.id из тела>, Basic shopId:secretKey.
    const api = calls.filter((c) => c.url.includes('api.yookassa.ru'));
    expect(api).toHaveLength(1);
    expect(api[0].url).toBe(`https://api.yookassa.ru/v3/payments/${PAYMENT_ID}`);
    expect(api[0].init.method).toBe('GET');
    expect((api[0].init.headers as Record<string, string>)['authorization']).toBe(`Basic ${btoa(`${SHOP_ID}:${SECRET_KEY}`)}`);
    expect(logEventsOf(recorded)).toContain(`payments.webhook.paid.${ORDER_AMOUNT}`);
  });

  it('API отклонил ключи (401) → 400 unverified, заказ НЕ оплачен', async () => {
    const { env, recorded, runCount, state } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    stubYkApi({ status: 401, body: { description: 'unauthorized' } });

    const res = await postEvent(env, eventBody());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unverified' });
    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');
    expect(logEventsOf(recorded)).toContain('payments.webhook.reverify_fail');
  });

  it('API недоступен (сетевой сбой) → 400 unverified, никогда не 200', async () => {
    const { env, runCount } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))));

    const res = await postEvent(env, eventBody());
    expect(res.status).toBe(400);
    expect(runCount.markPaid).toBe(0);
  });

  it('externalId берётся из metadata ОТВЕТА API: подделка в теле вебхука не подтверждает чужой заказ', async () => {
    // Тело заявляет metadata.order_id чужого заказа; verifyWebhook передаст его
    // как paymentId в API — провайдер такого платежа не знает (404) → unverified.
    const { env, runCount, state } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    stubYkApi({ status: 404, body: { description: 'not found' } });

    const res = await postEvent(env, eventBody({ metadata: { order_id: 'foreign-order' } }));
    expect(res.status).toBe(400);
    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');
  });

  it('сумма из ответа API не совпадает с заказом → 400 amount mismatch', async () => {
    const { env, recorded, runCount, state } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    stubYkApi({
      status: 200,
      body: { status: 'succeeded', amount: { value: '1.00', currency: 'RUB' }, metadata: { order_id: ORDER_EXT } },
    });

    const res = await postEvent(env, eventBody());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'amount mismatch' });
    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');
    expect(logEventsOf(recorded)).toContain('payments.webhook.amount_mismatch');
  });

  it('API вернул canceled → 200, статус заказа cancelled, сценарий не возобновляется', async () => {
    const { env, recorded } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    stubYkApi({
      status: 200,
      body: { status: 'canceled', amount: { value: '1500.00', currency: 'RUB' }, metadata: { order_id: ORDER_EXT } },
    });

    const res = await postEvent(env, eventBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'cancelled' });
    // updatePaymentOrderStatus: 'UPDATE payment_orders SET status = ? ...', статус — первый bind-аргумент.
    const upd = recorded.find((r) => r.sql.includes('UPDATE payment_orders SET status = ?'));
    expect(upd).toBeTruthy();
    expect(upd!.args[0]).toBe('cancelled');
    expect(logEventsOf(recorded)).toContain('payments.webhook.status.cancelled');
  });

  it('устаревшее событие (created_at старше 5 минут) → 400 ещё до reverify', async () => {
    const { env } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    const calls = stubYkApi({ status: 200, body: { status: 'succeeded' } });
    const old = JSON.stringify({
      event: 'payment.succeeded',
      object: { id: PAYMENT_ID, created_at: new Date(Date.now() - 6 * 60_000).toISOString() },
    });

    const res = await postEvent(env, old);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid signature' }); // роут не раскрывает причину
    expect(calls.filter((c) => c.url.includes('api.yookassa.ru'))).toHaveLength(0);
  });

  it('секретный ключ не появляется ни в ответах, ни в логах', async () => {
    const { env, recorded } = makeEnv({ orderStatus: 'created', orderAmount: ORDER_AMOUNT });
    stubYkApi({
      status: 200,
      body: { status: 'succeeded', amount: { value: '1500.00', currency: 'RUB' }, metadata: { order_id: ORDER_EXT } },
    });

    const res = await postEvent(env, eventBody());
    const body = await res.text();
    expect(body).not.toContain(SECRET_KEY);
    expect(body).not.toContain(ENC_KEY);
    for (const ev of logEventsOf(recorded)) {
      expect(ev).not.toContain(SECRET_KEY);
    }
  });
});
