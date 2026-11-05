// Волна 2 аудита 2026-10-18, /m/api action:
//  - F-039: AI-лимит на ПОЛЬЗОВАТЕЛЯ (user_id в bind счётчика), prompt ≤ 2000
//    символов (400 с русским текстом), kind 'ai' только при ai_gen-элементе
//    или действии ai в опубликованной схеме (иначе 400);
//  - F-045: mini_favs — itemId ≤ 512, не более 200 избранных на юзера (400);
//  - F-041: kind 'pay' создаёт строку mini_payments ДО sendInvoice (payload
//    'mini:<uuid>'); сбой отправки — строка удалена, ответ 502.
// Harness — клон tests/miniapp-server-auth.test.ts (подписанный initData,
// фейковый D1 по подстрокам SQL, batch СОСЕДНИЙ prepare).
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { encryptToken } from '../worker/src/crypto';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');
const BOT_TOKEN = '123456789:AAF-test-token-miniapp';
const BOT_ID = 'bot-w2m';
const USER_ID = 424242;
const enc = new TextEncoder();

async function hmacHex(secretBytes: Uint8Array | string, data: string): Promise<string> {
  const raw = typeof secretBytes === 'string' ? enc.encode(secretBytes) : secretBytes;
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeInitData(fields: Record<string, string>, token = BOT_TOKEN): Promise<string> {
  const entries = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const k = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(token)));
  const hash = await hmacHex(secret, dataCheckString);
  const qs = entries.map(([k2, v]) => `${k2}=${encodeURIComponent(v)}`).join('&');
  return `${qs}&hash=${hash}`;
}

async function freshInitData(userId = USER_ID): Promise<string> {
  return makeInitData({
    user: JSON.stringify({ id: userId, first_name: 'Тест', username: 'w2m' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  });
}

const TOKEN_ENC = await encryptToken(BOT_TOKEN, ENC_KEY);

// Схема с ai_gen-элементом и pay-кнопкой (валидна для validateMiniAppShape).
function appWith(el: Record<string, unknown>) {
  return {
    version: 1,
    tabbar: { enabled: false, tabs: [] },
    pages: [
      { id: 'p1', name: 'Стр', bg: '#fff', els: [{ id: 'e1', x: 0, y: 0, w: 100, h: 100, style: {}, props: {}, action: { id: 'none' }, ...el }] },
    ],
    startPageId: 'p1',
  };
}

const APP_AI = appWith({ type: 'ai_gen', props: { prompt: 'кот' } });
const APP_NO_AI = appWith({ type: 'text', props: { text: 'привет' } });

type Row = Record<string, any>;

function makeEnv(app: unknown, opts: { sessionVars?: Record<string, unknown>; tgSendInvoice?: 'ok' | 'fail' } = {}) {
  const state = {
    payments: [] as Row[],
    usage: [] as Row[],
    logs: [] as string[],
    recorded: [] as Array<{ sql: string; args: unknown[] }>,
  };
  const sessionVars = opts.sessionVars ?? {};
  const miniApps: Row[] = [{
    id: 'mini-1', bot_id: BOT_ID, owner_id: 'ilya', name: 'W2', slug: 'shop',
    access_rule_json: JSON.stringify({ kind: 'all' }),
    draft_json: JSON.stringify(app),
    published_json: JSON.stringify(app),
    created_at: 1, updated_at: 1,
  }];
  const bots: Row[] = [{ id: BOT_ID, owner_id: 'ilya', name: 'test', token_enc: TOKEN_ENC, webhook_secret: 'ws', bot_username: 'testbot', has_referral: 0 }];
  const sessions: Row[] = [{
    bot_id: BOT_ID, user_id: USER_ID, current_block: null,
    vars_json: JSON.stringify(sessionVars), updated_at: 1, first_name: null, username: null,
  }];

  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      const stmt = {
        _args: [] as unknown[],
        bind(...args: unknown[]) { this._args = args; return stmt; },
        async first() {
          state.recorded.push({ sql: s, args: stmt._args });
          if (s.includes('FROM mini_apps') && s.includes('slug = ?')) return miniApps.find((r) => r.bot_id === stmt._args[0] && r.slug === stmt._args[1]) ?? null;
          if (s.includes('FROM mini_apps')) return miniApps.find((r) => r.id === stmt._args[0]) ?? null;
          if (s.includes('FROM bots')) return bots.find((r) => r.id === stmt._args[0]) ?? null;
          if (s.includes('FROM mini_payments WHERE payload = ?')) return state.payments.find((p) => p.payload === stmt._args[0]) ?? null;
          if (s.includes('FROM sessions')) return sessions.find((r) => r.bot_id === stmt._args[0] && r.user_id === stmt._args[1]) ?? null;
          if (s.includes('FROM user_tags')) return null;
          return null;
        },
        async all() {
          state.recorded.push({ sql: s, args: stmt._args });
          if (s.includes('FROM user_tags')) return { results: [], success: true };
          return { results: [], success: true };
        },
        async run() {
          state.recorded.push({ sql: s, args: stmt._args });
          if (s.startsWith('INSERT INTO logs')) { state.logs.push(String(stmt._args[2])); return { meta: { changes: 1 } }; }
          if (s.startsWith('INSERT INTO mini_payments')) {
            const [id, bot_id, app_id, user_id, amount, payload] = stmt._args as unknown[];
            if (state.payments.some((p) => p.payload === payload)) throw new Error('UNIQUE constraint failed: mini_payments.payload');
            state.payments.push({ id, bot_id, app_id, user_id, amount, payload, charge_id: null, status: 'pending', created_at: stmt._args[6], paid_at: null });
            return { meta: { changes: 1 } };
          }
          if (s.startsWith('DELETE FROM mini_payments')) {
            state.payments = state.payments.filter((p) => p.id !== stmt._args[0]);
            return { meta: { changes: 1 } };
          }
          if (s.startsWith('INSERT INTO mini_app_usage') && s.includes('ai_count = ai_count + 1')) {
            const [bot_id, user_id, date] = stmt._args as unknown[];
            const row = state.usage.find((r) => r.bot_id === bot_id && r.user_id === user_id && r.date === date);
            if (row) row.ai_count++;
            else state.usage.push({ bot_id, user_id, date, media_bytes: 0, ai_count: 1, updated_at: stmt._args[3] });
            return { meta: { changes: 1 } };
          }
          if (s.startsWith('SELECT ai_count FROM mini_app_usage')) {
            // first() уже отдал null — здесь эмулируем счётчик для onCount.
            return { meta: { changes: 0 } };
          }
          if (s.startsWith('UPDATE sessions')) {
            const row = sessions.find((r) => r.bot_id === stmt._args[stmt._args.length - 2] && r.user_id === stmt._args[stmt._args.length - 1]);
            if (row && s.includes('vars_json')) row.vars_json = String(stmt._args[1]);
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) { for (const st of stmts) await (st as any).run?.(); return []; },
  };

  const kvStore = new Map<string, string>();
  const kv = {
    async get(k: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string) { kvStore.set(k, v); },
    async delete(k: string) { kvStore.delete(k); },
  };
  const env = {
    DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'production',
    TOOKEN_IMAGE_API_KEY: 'k', TOOKEN_IMAGE_BASE_URL: 'https://img.example/v1', TOOKEN_IMAGE_MODEL: 'm',
  } as any;
  return { env, state, sessions, miniApps };
}

async function call(env: any, path: string, body: unknown, initData: string) {
  const req = new Request(`https://bots.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
    body: JSON.stringify(body),
  });
  const res = await (await import('../worker/src/index')).default.fetch(req, env, {});
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const action = (env: any, body: unknown, init: string) => call(env, `/m/api/${BOT_ID}/shop/action`, body, init);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/images/generations')) return new Response('{}', { status: 500 }); // не даём генерации уйти дальше счётчика
    if (u.includes('sendInvoice')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('F-039: AI-лимит на юзера и привязка к схеме', () => {
  it('промпт длиннее 2000 символов → 400 с русским сообщением', async () => {
    const { env } = makeEnv(APP_AI);
    const r = await action(env, { kind: 'ai', prompt: 'ы'.repeat(2001) }, await freshInitData());
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toMatch(/2000/);
  });

  it('в схеме нет AI-элемента → 400 «В этом приложении нет AI-блока»', async () => {
    const { env } = makeEnv(APP_NO_AI);
    const r = await action(env, { kind: 'ai', prompt: 'кот' }, await freshInitData());
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toBe('В этом приложении нет AI-блока');
  });

  it('счётчик пишется на пользователя (user_id в bind), не на бота', async () => {
    const { env, state } = makeEnv(APP_AI);
    const r = await action(env, { kind: 'ai', prompt: 'кот' }, await freshInitData());
    // Генерация упадёт на апстриме (502), но счётчик обязан быть записан ДО сети.
    expect(r.status).toBe(502);
    expect(state.usage).toHaveLength(1);
    expect(state.usage[0].user_id).toBe(USER_ID);
  });

  it('действие ai на элементе (action.id = ai) тоже разрешает kind ai', async () => {
    const app = appWith({ type: 'button', props: {}, action: { id: 'ai', prompt: 'кот' } });
    const { env, state } = makeEnv(app);
    await action(env, { kind: 'ai', prompt: 'кот' }, await freshInitData());
    expect(state.usage).toHaveLength(1);
  });
});

describe('F-045: ограничения mini_favs', () => {
  it('itemId длиннее 512 → 400', async () => {
    const { env } = makeEnv(APP_NO_AI);
    const r = await action(env, { kind: 'favorite', itemId: 'x'.repeat(513) }, await freshInitData());
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toMatch(/длинный/i);
  });

  it('больше 200 избранных → 400 с русским сообщением', async () => {
    const list = Array.from({ length: 200 }, (_, i) => `id${i}`).join(',');
    const { env } = makeEnv(APP_NO_AI, { sessionVars: { mini_favs: list } });
    const r = await action(env, { kind: 'favorite', itemId: 'new' }, await freshInitData());
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toMatch(/200/);
  });

  it('снятие существующего избранного при 200 элементах работает', async () => {
    const list = Array.from({ length: 200 }, (_, i) => `id${i}`).join(',');
    const { env } = makeEnv(APP_NO_AI, { sessionVars: { mini_favs: list } });
    const r = await action(env, { kind: 'favorite', itemId: 'id5' }, await freshInitData());
    expect(r.status).toBe(200);
    expect(r.data.favorite).toBe(false);
  });
});

describe('F-041: kind pay создаёт mini_payments до sendInvoice', () => {
  it('успех: строка pending с payload mini:<uuid>, счёт отправлен', async () => {
    const { env, state } = makeEnv(APP_NO_AI);
    const r = await action(env, { kind: 'pay', product: 'Маникюр', stars: 50 }, await freshInitData());
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true });
    expect(state.payments).toHaveLength(1);
    const p = state.payments[0];
    expect(p.status).toBe('pending');
    expect(p.amount).toBe(50);
    expect(p.bot_id).toBe(BOT_ID);
    expect(p.app_id).toBe('mini-1');
    expect(p.user_id).toBe(USER_ID);
    expect(p.payload).toBe(`mini:${p.id}`);
    expect(p.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(state.logs).toContain('mini.pay');
  });

  it('сбой sendInvoice: строка удалена, 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('sendInvoice')) return new Response(JSON.stringify({ ok: false, description: 'payments not enabled' }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const { env, state } = makeEnv(APP_NO_AI);
    const r = await action(env, { kind: 'pay', product: 'Маникюр', stars: 50 }, await freshInitData());
    expect(r.status).toBe(502);
    expect(state.payments).toHaveLength(0);
  });

  it('битые параметры (stars вне 1..10000) → 400 и строка НЕ создаётся', async () => {
    const { env, state } = makeEnv(APP_NO_AI);
    const r = await action(env, { kind: 'pay', product: 'Маникюр', stars: 0 }, await freshInitData());
    expect(r.status).toBe(400);
    expect(state.payments).toHaveLength(0);
  });
});
