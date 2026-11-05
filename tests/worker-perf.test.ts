// Перф-пасс 29.09.2026: порядок фолбэк-ответа на callback, отложенные логи
// через waitUntil, referralContext одним round-trip'ом, окно чистки логов крона.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import { referralContext } from '../worker/src/db';
import type { Scenario } from '../shared/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BOT_ID = 'bot-perf-1';
const SECRET = 'whsec-perf';

// Сценарий как в worker-callback.test.ts: сессия ждёт на кнопках ('b'),
// нажатие 'ok' ведёт в блок сообщения — движок выпускает sendMessage,
// а фолбэк вебхука обязан снять часики ДО этой отправки.
function messageScenario(): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }] }, branches: { ok: 'm' } },
      m: { id: 'm', type: 'message', params: { text: 'дальше' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

// Записываем ПОРЯДОК обращений к Telegram: методы в последовательности вызовов.
const tgOrder: string[] = [];
// Записываем порядок записи логов в D1 относительно обращений к Telegram.
const dbOrder: string[] = [];

function makeEnv(scenario: Scenario) {
  const flow = JSON.stringify(scenario);
  const store = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async first<T>() {
          if (sql.includes('FROM bots')) {
            return {
              id: BOT_ID, owner_id: 'u1', name: 'Perf Bot',
              token_enc: await encryptToken('123:TESTTOKEN', KEY),
              webhook_secret: SECRET, active: 1, created_at: 1,
              bot_username: 'perfbot', has_referral: 0, published_version: 1,
            } as T;
          }
          if (sql.includes('FROM sessions')) return { current_block: 'b', vars_json: '{}' } as T;
          if (sql.includes('flow_json')) return { flow_json: flow, version: 1, has_referral: 0 } as T;
          return null;
        },
        async all<T>() { return [] as T[]; },
        async run() {
          if (sql.includes('INSERT INTO logs')) dbOrder.push(`log:${String(stmt.args[2])}`);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    // batch — СОСЕД prepare и исполняет statement'ы (уроки §18/§19).
    // Первый yield — как у настоящей D1: запись не должна успевать раньше,
    // чем обработчик синхронно дойдёт до waitUntil.
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      await null;
      for (const s of stmts) await s?.run?.();
      return [];
    },
  };
  const kv = {
    async get(key: string) {
      if (key === BOT_ID) return SECRET;
      if (key.startsWith('sc:')) return store.get(key) ?? null;
      return null;
    },
    async put(key: string, value: string) { store.set(key, value); },
  };
  return { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ENVIRONMENT: 'dev' } as any;
}

beforeEach(() => {
  tgOrder.length = 0;
  dbOrder.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      tgOrder.push(u.split('/').pop()!);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function sendCallback(env: any, ctx: any) {
  const update = {
    callback_query: {
      id: 'cbq-perf',
      from: { id: 2 },
      data: 'ok',
      message: { chat: { id: 2 }, message_id: 9 },
    },
  };
  const req = new Request(`https://test.example/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify(update),
  });
  const res = await (worker as any).fetch(req, env, ctx);
  expect(res.status).toBe(200);
}

describe('webhook: фолбэк answerCallbackQuery до отправки сообщений', () => {
  it('часики снимаются раньше sendMessage (порядок вызовов Telegram)', async () => {
    const env = makeEnv(messageScenario());
    await sendCallback(env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    const answerIdx = tgOrder.indexOf('answerCallbackQuery');
    const sendIdx = tgOrder.indexOf('sendMessage');
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(answerIdx).toBeLessThan(sendIdx);
    // ровно один ответ на callback
    expect(tgOrder.filter((m) => m === 'answerCallbackQuery')).toHaveLength(1);
  });
});

describe('webhook: не-критичные логи уходят в waitUntil', () => {
  it('step-лог пишется через waitUntil, а не блокирует ответ', async () => {
    const env = makeEnv(messageScenario());
    const deferred: Promise<unknown>[] = [];
    let responseDone = false;
    const res = await (worker as any).fetch(
      new Request(`https://test.example/${BOT_ID}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
        body: JSON.stringify({ callback_query: { id: 'cbq-2', from: { id: 2 }, data: 'ok', message: { chat: { id: 2 } } } }),
      }),
      env,
      {
        waitUntil(p: Promise<unknown>) {
          // Ключевая проверка: на момент ответа step-лог ещё НЕ записан —
          // persist и отложенные логи исполняются после него.
          expect(responseDone).toBe(false);
          expect(dbOrder.filter((e) => e.startsWith('log:step.'))).toHaveLength(0);
          deferred.push(p);
        },
      }
    );
    expect(res.status).toBe(200);
    responseDone = true;
    await Promise.all(deferred);
    // После waitUntil логи на месте (персист сессии + шаг).
    expect(dbOrder.some((e) => e.startsWith('log:step.'))).toBe(true);
  });

  it('без executionCtx поведение прежнее: к концу запроса всё записано', async () => {
    const env = makeEnv(messageScenario());
    // ctx без waitUntil — как в части тестовых путей.
    await sendCallback(env, {});
    expect(dbOrder.some((e) => e.startsWith('log:step.'))).toBe(true);
  });
});

describe('referralContext — inviter и count одним запросом', () => {
  function makeRefDb(rows: Array<{ inviter_user_id: string; invited_user_id: string }>) {
    const recorded: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first<T>() {
                recorded.push(sql);
                const me = rows.find((r) => r.invited_user_id === '7');
                const count = rows.filter((r) => r.inviter_user_id === '7').length;
                return { inviter: me?.inviter_user_id ?? null, c: count } as T;
              },
            };
          },
        };
      },
    };
    return { db: db as any, recorded };
  }

  it('один SELECT на оба значения', async () => {
    const { db, recorded } = makeRefDb([
      { inviter_user_id: '5', invited_user_id: '7' },
      { inviter_user_id: '7', invited_user_id: '8' },
      { inviter_user_id: '7', invited_user_id: '9' },
    ]);
    const ctx = await referralContext(db, 'b1', '7');
    expect(ctx).toEqual({ inviter: '5', invitedCount: 2 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toContain('inviter_user_id');
    expect(recorded[0]).toContain('COUNT');
  });

  it('нет записей — inviter null, count 0', async () => {
    const { db } = makeRefDb([]);
    const ctx = await referralContext(db, 'b1', '7');
    expect(ctx).toEqual({ inviter: null, invitedCount: 0 });
  });
});
