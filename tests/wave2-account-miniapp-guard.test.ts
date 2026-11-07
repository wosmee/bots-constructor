// Волна 2 аудита 2026-10-18:
//  - F-017/WS-10: DELETE /api/auth/me снимает вебхуки всех ботов аккаунта в
//    Telegram (deleteWebhook на каждый токен), чистит KV-ключи <botId>
//    (webhook-секрет) и sc:<botId> (кэш сценария), каскад выполняется даже
//    при сбое Telegram;
//  - F-043: PUT /api/miniapps/:id и POST /api/miniapps/:id/publish — схема
//    больше MAX_FLOW_BYTES (1 МБ) → 413 с русским сообщением.
// Harness: фейковый D1/KV по паттерну tests/auth-strict-messages.test.ts и
// tests/miniapps-api.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { hashPassword } from '../worker/src/auth';
import { encryptToken } from '../worker/src/crypto';

const ADMIN_KEY = 'test-admin-key';
const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');
const PASSWORD = 'correct-horse-99';
const PASS_HASH = await hashPassword(PASSWORD);
const TOKEN_ENC = await encryptToken('123:TESTTOKEN', ENC_KEY);

type Row = Record<string, any>;

// ---------------- F-017 ----------------

function makeAccountEnv(opts: { tgFails?: boolean; badToken?: boolean } = {}) {
  const accounts: Row[] = [{ id: 'u1', login: 'ivan', pass_hash: PASS_HASH, created_at: 1 }];
  const bots: Row[] = [
    { id: 'bot-a', owner_id: 'u1', name: 'A', token_enc: opts.badToken ? 'corrupt' : TOKEN_ENC, webhook_secret: 'sa', active: 1, created_at: 1 },
    { id: 'bot-b', owner_id: 'u1', name: 'B', token_enc: TOKEN_ENC, webhook_secret: 'sb', active: 1, created_at: 2 },
  ];
  const cascade: string[] = [];
  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (s.includes('FROM accounts WHERE login = ?')) return (accounts.find((a) => a.login === args[0]) ?? null) as T;
              return null;
            },
            async all<T>() {
              if (s === 'SELECT id, token_enc FROM bots WHERE owner_id = ?') {
                return { results: bots.filter((b) => b.owner_id === args[0]).map((b) => ({ id: b.id, token_enc: b.token_enc })) } as { results: T[] };
              }
              return { results: [] } as { results: T[] };
            },
            async run() {
              if (s.includes('DELETE FROM accounts WHERE id = ?')) cascade.push('accounts');
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) {
      for (const x of stmts) await x?.run?.();
      return [];
    },
  };
  const kvStore = new Map<string, string>();
  kvStore.set('sess:tok-user', JSON.stringify({ id: 'u1', login: 'ivan', exp: Date.now() + 60_000 }));
  kvStore.set('bot-a', 'sa');
  kvStore.set('bot-b', 'sb');
  kvStore.set('sc:bot-a', '{"flow_json":"{}"}');
  kvStore.set('sc:bot-b', '{"flow_json":"{}"}');
  const deletedKeys: string[] = [];
  const kv = {
    async get(k: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string) { kvStore.set(k, v); },
    async delete(k: string) { deletedKeys.push(k); kvStore.delete(k); },
  };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production' } as any;
  return { env, kvStore, deletedKeys, cascade, tgFails: !!opts.tgFails };
}

describe('F-017: DELETE /api/auth/me снимает вебхуки и чистит KV', () => {
  const tgMethods: Array<{ method: string }> = [];
  beforeEach(() => {
    tgMethods.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubTg(fails = false) {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('api.telegram.org')) {
        tgMethods.push({ method: u.split('/').pop()! });
        if (fails) throw new Error('network down');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
  }

  it('deleteWebhook вызван на каждого бота, KV-ключи удалены, каскад выполнен', async () => {
    stubTg(false);
    const { env, kvStore, deletedKeys, cascade } = makeAccountEnv();
    const res = await (worker as any).fetch(
      new Request('https://bots.example/api/auth/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok-user' },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      env, {}
    );
    expect(res.status).toBe(200);
    expect(tgMethods.filter((m) => m.method === 'deleteWebhook')).toHaveLength(2);
    for (const k of ['bot-a', 'bot-b', 'sc:bot-a', 'sc:bot-b']) {
      expect(deletedKeys).toContain(k);
      expect(kvStore.has(k)).toBe(false);
    }
    expect(cascade).toContain('accounts');
  });

  it('Telegram недоступен — удаление аккаунта всё равно проходит (каскад + KV)', async () => {
    stubTg(true);
    const { env, kvStore, cascade } = makeAccountEnv();
    const res = await (worker as any).fetch(
      new Request('https://bots.example/api/auth/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok-user' },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      env, {}
    );
    expect(res.status).toBe(200);
    expect(cascade).toContain('accounts');
    expect(kvStore.has('bot-a')).toBe(false);
  });

  it('битый token_enc одного бота не блокирует удаление', async () => {
    stubTg(false);
    const { env, cascade } = makeAccountEnv({ badToken: true });
    const res = await (worker as any).fetch(
      new Request('https://bots.example/api/auth/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok-user' },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      env, {}
    );
    expect(res.status).toBe(200);
    expect(cascade).toContain('accounts');
    // Живой токен второго бота всё равно снят.
    expect(tgMethods.filter((m) => m.method === 'deleteWebhook')).toHaveLength(1);
  });

  it('неверный пароль — 401, вебхуки не трогаются', async () => {
    stubTg(false);
    const { env, kvStore } = makeAccountEnv();
    const res = await (worker as any).fetch(
      new Request('https://bots.example/api/auth/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok-user' },
        body: JSON.stringify({ password: 'wrong' }),
      }),
      env, {}
    );
    expect(res.status).toBe(401);
    expect(tgMethods).toHaveLength(0);
    expect(kvStore.has('bot-a')).toBe(true);
  });
});

// ---------------- F-043 ----------------

function makeMiniEnv() {
  const miniApps: Row[] = [];
  const bots: Row[] = [{ id: 'bot-m', owner_id: 'ivan', name: 'test', token_enc: TOKEN_ENC, webhook_secret: 'ws', bot_username: 'testbot', has_referral: 0 }];
  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (s.includes('FROM mini_apps') && s.includes('WHERE id = ?')) return (miniApps.find((r) => r.id === args[0]) ?? null) as T;
              if (s.includes('FROM bots')) return (bots.find((r) => r.id === args[0]) ?? null) as T;
              return null;
            },
            async all<T>() {
              if (s.includes('FROM mini_apps') && s.includes('bot_id = ?')) return { results: miniApps.filter((r) => r.bot_id === args[0]) } as { results: T[] };
              return { results: [] } as { results: T[] };
            },
            async run() {
              if (s.startsWith('INSERT INTO mini_apps')) {
                const [id, bot_id, owner_id, name, slug, access_rule_json, draft_json, created_at, updated_at] = args as unknown[];
                miniApps.push({ id, bot_id, owner_id, name, slug, access_rule_json, draft_json, published_json: null, created_at, updated_at });
              }
              if (s.startsWith('UPDATE mini_apps SET') && s.includes('draft_json')) {
                const row = miniApps.find((r) => r.id === args[args.length - 1]);
                if (row) row.draft_json = args.length === 4 ? args[1] : args[0];
              }
              if (s.startsWith('UPDATE mini_apps SET') && s.includes('published_json')) {
                const row = miniApps.find((r) => r.id === args[args.length - 1]);
                if (row) row.published_json = args[0];
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const x of stmts) await x?.run?.(); return []; },
  };
  const kvStore = new Map<string, string>();
  kvStore.set('sess:tok-owner', JSON.stringify({ id: 'ivan', login: 'ivan', exp: Date.now() + 60_000 }));
  const env = { DB: db, KV: { get: async (k: string) => kvStore.get(k) ?? null, put: async () => {}, delete: async () => {} }, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production' } as any;
  return { env, miniApps };
}

async function callMini(env: any, method: string, path: string, body: unknown) {
  const res = await (worker as any).fetch(
    new Request(`https://bots.example${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-owner' },
      body: JSON.stringify(body),
    }),
    env, {}
  );
  return { status: res.status, data: await res.json().catch(() => null) };
}

function validApp() {
  return {
    version: 1,
    tabbar: { enabled: false, tabs: [] },
    pages: [{ id: 'p1', name: 'P', bg: '#fff', els: [{ id: 'e1', type: 'text', x: 0, y: 0, w: 10, h: 10, style: {}, props: {}, action: { id: 'none' } }] }],
    startPageId: 'p1',
  };
}

function hugeApp() {
  const app = validApp();
  // Одна строка текста больше 1 МБ: форма валидна, байтовый лимит пробит.
  (app.pages[0].els[0] as any).props.text = 'ы'.repeat(1_200_000);
  return app;
}

describe('F-043: байтовый лимит схемы мини-аппа', () => {
  // F3-200: фича мини-аппов скрыта серверным флагом MINI_APPS_ENABLED —
  // обычная сессия получает 403. Тесты гейтов запускаются с флагом включённым
  // (как админ/включённая фича), плюс отдельная проверка закрытия.
  function makeMiniEnvOn() {
    const { env, miniApps } = makeMiniEnv();
    (env as any).MINI_APPS_ENABLED = '1';
    return { env, miniApps };
  }

  it('F3-200: без MINI_APPS_ENABLED создание мини-аппа → 403 feature disabled', async () => {
    const { env } = makeMiniEnv();
    const created = await callMini(env, 'POST', '/api/bots/bot-m/miniapps', { name: 'M', slug: 'shop' });
    expect(created.status).toBe(403);
    expect(created.data.error).toBe('feature disabled');
  });

  it('PUT draft > 1 МБ → 413 с русским сообщением, черновик не записан', async () => {
    const { env, miniApps } = makeMiniEnvOn();
    const created = await callMini(env, 'POST', '/api/bots/bot-m/miniapps', { name: 'M', slug: 'shop' });
    expect(created.status).toBe(201);
    const id = created.data.id;
    const draftBefore = miniApps[0].draft_json;
    const r = await callMini(env, 'PUT', `/api/miniapps/${id}`, { draft: hugeApp() });
    expect(r.status).toBe(413);
    expect(String(r.data.error)).toMatch(/КБ — сохранить нельзя/);
    // Черновик не перезаписан.
    expect(miniApps[0].draft_json).toBe(draftBefore);
  });

  it('publish app > 1 МБ → 413, публикация не записана', async () => {
    const { env, miniApps } = makeMiniEnvOn();
    const created = await callMini(env, 'POST', '/api/bots/bot-m/miniapps', { name: 'M', slug: 'shop' });
    const id = created.data.id;
    const r = await callMini(env, 'POST', `/api/miniapps/${id}/publish`, { app: hugeApp() });
    expect(r.status).toBe(413);
    expect(String(r.data.error)).toMatch(/КБ — публиковать нельзя/);
    expect(miniApps[0].published_json).toBeNull();
  });

  it('нормальная схема проходит оба роута', async () => {
    const { env } = makeMiniEnvOn();
    const created = await callMini(env, 'POST', '/api/bots/bot-m/miniapps', { name: 'M', slug: 'shop' });
    const id = created.data.id;
    const put = await callMini(env, 'PUT', `/api/miniapps/${id}`, { draft: validApp() });
    expect(put.status).toBe(200);
    const pub = await callMini(env, 'POST', `/api/miniapps/${id}/publish`, { app: validApp() });
    expect(pub.status).toBe(200);
    expect(pub.data.revision).toBeGreaterThan(0);
  });
});
