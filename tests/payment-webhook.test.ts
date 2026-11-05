// Публичный платёжный вебхук POST /p/:token (миграция 0022: короткий код
// вместо /pay/:botId/:webhookPath, старый роут отвечает 410 — см.
// tests/payment-webhook-token.test.ts). Гоняем реальный app.fetch (default
// export воркера) с фейковым D1, маршрутизируемым по подстрокам SQL (паттерн
// из tests/worker-safety.test.ts), фейковым KV и настоящим ENCRYPTION_KEY
// (32 байта base64) — crypto.ts расшифровывает secrets_enc и token_enc через
// WebCrypto.
//
// Покрытие: 404 на неизвестный код, успешная доставка custom-провайдера
// (HMAC X-Signature), идемпотентность повторной доставки, подделанная подпись,
// расхождение суммы, битое тело (400, не 500), replay со старым X-Timestamp,
// возобновление сценария с successNext, отсутствие секретов в ответах/логах.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import { hmacHex } from '../worker/src/blocks/payments/providers';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef'); // ровно 32 байта
const BOT_ID = 'bot-pay-1';
const CONN_ID = 'conn-pay-1';
const WEBHOOK_TOKEN = 'AB23CD45EF';
const WEBHOOK_SECRET = 'super-secret-webhook-key';
const ORDER_EXT = 'order-ext-1';
const USER_ID = 4242;

type Recorded = { sql: string; args: unknown[] };

interface PayDbState {
  orderStatus: string;
  orderAmount: number;
  payloadJson: string;
  sessionVarsJson: string;
  scenarioFlowJson: string | null;
  /** F3-403: платформа бота — VK-бот после оплаты шлёт в VK API. */
  botPlatform?: 'telegram' | 'vk';
}

function makeFakeDb(state: PayDbState) {
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
                  provider: 'custom',
                  title: 'Тестовый провайдер',
                  config_json: '{}',
                  secrets_enc: await encryptToken(JSON.stringify({ webhookSecret: WEBHOOK_SECRET }), ENC_KEY),
                  webhook_path: 'legacy-path-unused',
                  webhook_token: WEBHOOK_TOKEN,
                  enabled: 1,
                  created_at: Date.now(),
                  updated_at: Date.now(),
                } as T;
              }
              if (sql.includes('FROM payment_orders WHERE bot_id = ? AND external_id = ?')) {
                if (args[1] !== ORDER_EXT) return null;
                return {
                  id: 'order-int-1',
                  bot_id: BOT_ID,
                  connection_id: CONN_ID,
                  user_id: USER_ID,
                  external_id: ORDER_EXT,
                  amount: state.orderAmount,
                  currency: 'RUB',
                  status: state.orderStatus,
                  payload_json: state.payloadJson,
                } as T;
              }
              if (sql.includes('current_block, vars_json FROM sessions')) {
                return { current_block: 'pl_block', vars_json: state.sessionVarsJson } as T;
              }
              if (sql.includes('first_name, username FROM sessions')) return null;
              if (sql.includes('FROM bots WHERE id = ?')) {
                return {
                  id: BOT_ID,
                  name: 'PayBot',
                  owner_id: 'owner-1',
                  active: 1,
                  created_at: Date.now(),
                  token_enc: await encryptToken('123456:TEST-TOKEN', ENC_KEY),
                  platform: state.botPlatform ?? 'telegram',
                  vk_group_id: 12345,
                } as T;
              }
              if (sql.includes('flow_json, version FROM scenarios')) {
                return state.scenarioFlowJson ? ({ flow_json: state.scenarioFlowJson, version: 1 } as T) : null;
              }
              if (sql.includes('inviter_user_id FROM referrals')) return null;
              return null;
            },
            async run() {
              recorded.push({ sql, args });
              runCount.anyWrite++;
              if (sql.includes('UPDATE payment_orders') && sql.includes("status = 'paid'")) {
                runCount.markPaid++;
                // Честная атомарность как в D1: WHERE status <> 'paid'
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

function makeEnv(state: PayDbState) {
  const { db, recorded, runCount } = makeFakeDb(state);
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
  // ADMIN_KEY задан явно: админ-доступ только по заголовку x-admin-key (fail-open убран).
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'production' } as any;
  return { env, recorded, runCount };
}

function defaultState(overrides: Partial<PayDbState> = {}): PayDbState {
  return {
    orderStatus: 'created',
    orderAmount: 150000,
    payloadJson: '{}',
    sessionVarsJson: '{"who":"Илья"}',
    scenarioFlowJson: null,
    botPlatform: 'telegram',
    ...overrides,
  };
}

function payUrl(token = WEBHOOK_TOKEN): string {
  return `https://bots.example/p/${token}`;
}

async function signedPost(
  env: any,
  rawBody: string,
  opts: { secret?: string; timestampSec?: number; url?: string } = {}
) {
  const sig = await hmacHex(opts.secret ?? WEBHOOK_SECRET, rawBody);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-signature': sig };
  // WS-06: X-Timestamp обязателен — по умолчанию свежий, тесты replay задают свой.
  headers['x-timestamp'] = String(opts.timestampSec ?? Math.floor(Date.now() / 1000));
  const req = new Request(opts.url ?? payUrl(), { method: 'POST', headers, body: rawBody });
  return (worker as any).fetch(req, env, {});
}

function paidBody(amount = 150000): string {
  return JSON.stringify({ orderId: ORDER_EXT, status: 'paid', amount, currency: 'RUB' });
}

const logEventsOf = (recorded: Recorded[]) =>
  recorded.filter((r) => r.sql.includes('INSERT INTO logs')).map((r) => String(r.args[2] ?? ''));

const sessionWritesOf = (recorded: Recorded[]) => recorded.filter((r) => r.sql.includes('INSERT INTO sessions'));
const referralPaymentWritesOf = (recorded: Recorded[]) => recorded.filter((r) => r.sql.includes('INSERT INTO referral_payments'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /p/:token', () => {
  it('(1) неизвестный код → 404 и ни одной записи', async () => {
    const { env, recorded, runCount } = makeEnv(defaultState());
    const res = await signedPost(env, paidBody(), { url: payUrl('NOSUCHCODE') });
    expect(res.status).toBe(404);
    expect(runCount.anyWrite).toBe(0);
    expect(recorded.every((r) => !r.sql.includes('payment_orders'))).toBe(true);
  });

  it('(2) валидная HMAC-подпись → 200, заказ оплачен, в сессии pay.order и payment', async () => {
    const state = defaultState();
    const { env, recorded, runCount } = makeEnv(state);
    const res = await signedPost(env, paidBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'paid' });

    // UPDATE payment_orders SET status='paid' реально выполнен
    expect(runCount.markPaid).toBe(1);
    expect(state.orderStatus).toBe('paid');
    // реферальная система увидела оплату
    expect(referralPaymentWritesOf(recorded)).toHaveLength(1);

    // сессия перезаписана: vars содержат pay.order и объект payment
    const writes = sessionWritesOf(recorded);
    expect(writes).toHaveLength(1);
    const varsArg = JSON.parse(String(writes[0].args[3]));
    expect(varsArg['pay.order']).toBe(ORDER_EXT);
    expect(varsArg['payment']).toEqual({ status: 'paid', amount: 150000, currency: 'RUB', order: ORDER_EXT });
    expect(varsArg['who']).toBe('Илья'); // прежние переменные не потеряны
    // залогировано событие оплаты
    expect(logEventsOf(recorded)).toContain(`payments.webhook.paid.150000`);
  });

  it('(3) повторная доставка того же события → 200 без записей (идемпотентность)', async () => {
    const state = defaultState();
    const { env, recorded, runCount } = makeEnv(state);

    const first = await signedPost(env, paidBody());
    expect(first.status).toBe(200);
    expect(runCount.markPaid).toBe(1);

    const second = await signedPost(env, paidBody());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, status: 'paid' });
    // заказ уже 'paid' → ранний выход: ни UPDATE, ни recordPayment, ни сессии
    expect(runCount.markPaid).toBe(1);
    expect(referralPaymentWritesOf(recorded)).toHaveLength(1);
    expect(sessionWritesOf(recorded)).toHaveLength(1);
  });

  it('(4) подделанная подпись → 400 и ни одной записи в бизнес-таблицы', async () => {
    const state = defaultState();
    const { env, recorded, runCount } = makeEnv(state);
    const res = await signedPost(env, paidBody(), { secret: 'wrong-secret' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid signature' });

    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');
    expect(referralPaymentWritesOf(recorded)).toHaveLength(0);
    expect(sessionWritesOf(recorded)).toHaveLength(0);
    // единственная запись — журнал отказов (имя события, без содержимого тела)
    expect(logEventsOf(recorded)).toEqual(['payments.webhook.rejected.custom']);
  });

  it('(5) сумма не совпадает с заказом → 400, заказ не оплачен', async () => {
    const state = defaultState({ orderAmount: 150000 });
    const { env, recorded, runCount } = makeEnv(state);
    const res = await signedPost(env, paidBody(1)); // 1 копейка вместо 1500 ₽
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'amount mismatch' });
    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');
    expect(referralPaymentWritesOf(recorded)).toHaveLength(0);
    expect(logEventsOf(recorded)).toContain('payments.webhook.amount_mismatch');
  });

  it('(6) битое тело с валидной подписью → 400, никогда не 500', async () => {
    const { env } = makeEnv(defaultState());
    const broken = '{"orderId": "order-ext-1", status: pai';
    const res = await signedPost(env, broken);
    expect(res.status).toBe(400);
    expect(res.status).not.toBeGreaterThanOrEqual(500);
  });

  it('(7) replay: X-Timestamp старше окна повторов → 400 при валидной подписи', async () => {
    const state = defaultState();
    const { env, runCount } = makeEnv(state);
    const oldTs = Math.floor(Date.now() / 1000) - 6 * 60; // 6 минут назад, окно — 5
    const res = await signedPost(env, paidBody(), { timestampSec: oldTs });
    expect(res.status).toBe(400);
    expect(runCount.markPaid).toBe(0);
    expect(state.orderStatus).toBe('created');

    // свежий timestamp с той же подписью проходит — значит дело именно в возрасте
    const fresh = await signedPost(env, paidBody(), { timestampSec: Math.floor(Date.now() / 1000) });
    expect(fresh.status).toBe(200);
  });

  it('(8) successNext: после оплаты сценарий возобновляется и шлёт сообщение', async () => {
    const scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'pl' },
        pl: {
          id: 'pl',
          type: 'payment_link',
          params: { connectionId: CONN_ID, amount: 150000, currency: 'RUB', successNext: 'after_pay' },
          branches: { created: 'wait_pay' },
        },
        wait_pay: { id: 'wait_pay', type: 'message', params: { text: 'Ждём оплату' } },
        after_pay: { id: 'after_pay', type: 'message', params: { text: 'Оплата получена, спасибо!' } },
      },
    };
    const state = defaultState({
      payloadJson: JSON.stringify({ link: 'https://pay.example/x', successNext: 'after_pay' }),
      scenarioFlowJson: JSON.stringify(scenario),
    });
    const { env, recorded } = makeEnv(state);

    const tgCalls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        tgCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    const res = await signedPost(env, paidBody());
    expect(res.status).toBe(200);

    // Telegram получил sendMessage с текстом из блока after_pay
    const sent = tgCalls.find((c) => c.url.includes('/sendMessage'));
    expect(sent).toBeTruthy();
    expect(sent!.body.text).toBe('Оплата получена, спасибо!');
    expect(sent!.url).toContain('bot123456:TEST-TOKEN/sendMessage'); // токен расшифрован настоящим crypto

    // сессия сохранена с pay.order
    const writes = sessionWritesOf(recorded);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].args[3]))['pay.order']).toBe(ORDER_EXT);
  });

  it('(8а) F3-403: successNext на VK-боте — сообщение уходит в VK messages.send, не в Telegram', async () => {
    const scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'pl' },
        pl: {
          id: 'pl',
          type: 'payment_link',
          params: { connectionId: CONN_ID, amount: 150000, currency: 'RUB', successNext: 'after_pay' },
          branches: { created: 'wait_pay' },
        },
        wait_pay: { id: 'wait_pay', type: 'message', params: { text: 'Ждём оплату' } },
        after_pay: { id: 'after_pay', type: 'message', params: { text: 'Оплата получена, спасибо!' } },
      },
    };
    const state = defaultState({
      payloadJson: JSON.stringify({ link: 'https://pay.example/x', successNext: 'after_pay' }),
      scenarioFlowJson: JSON.stringify(scenario),
      botPlatform: 'vk',
    });
    const { env, recorded } = makeEnv(state);

    const fetches: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        fetches.push(String(url));
        if (String(url).startsWith('https://api.vk.com/method/')) {
          return new Response(JSON.stringify({ response: 555 }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      })
    );

    const res = await signedPost(env, paidBody());
    expect(res.status).toBe(200);

    // VK-вызов был, Telegram — нет
    const vkSend = fetches.filter((u) => u.includes('api.vk.com/method/messages.send'));
    expect(vkSend).toHaveLength(1);
    expect(fetches.some((u) => u.includes('api.telegram.org'))).toBe(false);

    // сессия сохранена с pay.order
    const writes = sessionWritesOf(recorded);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].args[3]))['pay.order']).toBe(ORDER_EXT);
  });

  it('(9) секрет не появляется ни в ответах, ни в именах залогированных событий', async () => {
    const state = defaultState();
    const { env, recorded } = makeEnv(state);

    const bodies: string[] = [];
    const push = (r: Response) => r.clone().text().then((t) => bodies.push(t));

    await push(await signedPost(env, paidBody(), { secret: 'wrong-secret' }));
    await push(await signedPost(env, paidBody())); // успешная доставка
    await push(await signedPost(env, paidBody())); // идемпотентный повтор
    await push(await signedPost(env, paidBody(), { url: payUrl('unknown') }));

    for (const b of bodies) {
      expect(b).not.toContain(WEBHOOK_SECRET);
      expect(b).not.toContain('123456:TEST-TOKEN');
      expect(b).not.toContain(ENC_KEY);
    }
    for (const ev of logEventsOf(recorded)) {
      expect(ev).not.toContain(WEBHOOK_SECRET);
      expect(ev).not.toContain('123456:TEST-TOKEN');
    }
  });
});

describe('админ-доступ: без заголовков нет (dev fail-open убран)', () => {
  it('анонимный GET /api/bots → 401', async () => {
    const { env } = makeEnv(defaultState());
    const res = await (worker as any).fetch(new Request('https://bots.example/api/bots'), env, {});
    expect(res.status).toBe(401);
  });
});
