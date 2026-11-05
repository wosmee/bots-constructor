// TASK 2 (worker-часть): ровно ОДИН answerCallbackQuery на апдейт.
// Движок отвечает сам (cbToast/cbAlert) — безусловный фолбэк в persist-шаге
// вебхука обязан пропуститься; если движок не ответил — фолбэк срабатывает.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import type { Scenario } from '../shared/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BOT_ID = 'bot-cb-1';
const SECRET = 'whsec-cb';

function buttonsScenario(extra: Record<string, unknown>): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }], ...extra }, branches: { ok: 'm' } },
      m: { id: 'm', type: 'message', params: { text: 'дальше' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

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
              id: BOT_ID, owner_id: 'u1', name: 'CB Bot',
              token_enc: await encryptToken('123:TESTTOKEN', KEY),
              webhook_secret: SECRET, active: 1, created_at: 1,
              bot_username: 'cbbot', has_referral: 0, published_version: 1,
            } as T;
          }
          if (sql.includes('FROM sessions')) {
            // Ждём на кнопках — как после первого /start.
            return { current_block: 'b', vars_json: '{}' } as T;
          }
          if (sql.includes('flow_json')) {
            return { flow_json: flow, version: 1, has_referral: 0 } as T;
          }
          return null;
        },
        async all<T>() { return [] as T[]; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
    // S5-04: batch — сосед prepare и РЕАЛЬНО исполняет statement'ы: persist
    // сессии идёт через db.batch, немой batch делал проверку фиктивной (§18/19).
    async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const s of stmts) await s?.run?.(); return []; },
  };
  const kv = {
    async get(key: string) {
      if (key === BOT_ID) return SECRET;
      if (key.startsWith('sc:')) return store.get(key) ?? null;
      return null;
    },
    async put(key: string, value: string) { store.set(key, value); },
  };
  // ADMIN_KEY задан, но ENVIRONMENT остаётся 'dev' — доказываем, что
  // fail-open для dev убран: без заголовка x-admin-key админ-доступа нет.
  return { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'dev' } as any;
}

const tgMethods: string[] = [];
beforeEach(() => {
  tgMethods.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any, _init: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      tgMethods.push(u.split('/').pop()!);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function sendCallback(env: any) {
  const update = {
    callback_query: {
      id: 'cbq-1',
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
  // waitUntil исполняем сразу: без этого persist (и фолбэк) не дождётся.
  const res = await (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
  expect(res.status).toBe(200);
}

describe('webhook: answerCallbackQuery ровно один раз', () => {
  it('движок ответил (cbToast) — фолбэк пропущен, ровно один ответ с id', async () => {
    const env = makeEnv(buttonsScenario({ cbToast: 'готово' }));
    await sendCallback(env);
    const answers = tgMethods.filter((m) => m === 'answerCallbackQuery');
    expect(answers).toHaveLength(1);
  });

  it('движок молчал (нет cbToast/cbAlert) — фолбэк снимает часики, ответ один', async () => {
    const env = makeEnv(buttonsScenario({}));
    await sendCallback(env);
    const answers = tgMethods.filter((m) => m === 'answerCallbackQuery');
    expect(answers).toHaveLength(1);
  });

  it('cbAlert тоже считается ответом движка — фолбэк не дублирует', async () => {
    const env = makeEnv(buttonsScenario({ cbAlert: 'важно' }));
    await sendCallback(env);
    const answers = tgMethods.filter((m) => m === 'answerCallbackQuery');
    expect(answers).toHaveLength(1);
  });
});

describe('админ-доступ в dev: fail-open убран', () => {
  it('анонимный GET /api/bots при ENVIRONMENT=dev и заданном ADMIN_KEY → 401', async () => {
    const env = makeEnv(buttonsScenario({}));
    const res = await (worker as any).fetch(new Request('https://bots.example/api/bots'), env, {});
    expect(res.status).toBe(401);
  });
});
