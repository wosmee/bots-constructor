// Роут /wh/:token (набор 2026-10): входящий вебхук стартует сценарий с блока
// webhook_in, поля тела лежат в wh.*, повтор event_id идемпотентен, чужой
// токен — 404 без раскрытия существования.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import type { Scenario } from '../shared/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BOT_ID = 'bot-wh-1';
const HOOK_TOKEN = 'ABCD234567';

const scenario: Scenario = {
  version: 1,
  start: 's',
  blocks: {
    s: { id: 's', type: 'start', params: {}, next: 'w' },
    w: { id: 'w', type: 'webhook_in', params: { webhookFields: ['stage'] }, next: 'm' },
    m: { id: 'm', type: 'message', params: { text: 'статус: {{wh.stage}}' }, next: 'e' },
    e: { id: 'e', type: 'end', params: {} },
  },
} as Scenario;

function makeEnv() {
  const flow = JSON.stringify(scenario);
  const inserted: string[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async first<T>() {
          if (sql.includes('FROM bot_webhooks')) {
            const token = String(stmt.args[0]);
            if (token !== HOOK_TOKEN) return null;
            return { id: `${BOT_ID}:w`, bot_id: BOT_ID, token, scenario_block_id: 'w', fields: '["stage"]', created_at: 1 } as T;
          }
          if (sql.includes('FROM bots')) {
            return {
              id: BOT_ID, owner_id: 'u1', name: 'WH Bot',
              token_enc: await encryptToken('123:TESTTOKEN', KEY),
              webhook_secret: 'sec', active: 1, created_at: 1,
              bot_username: 'whbot', has_referral: 0, published_version: 1,
            } as unknown as T;
          }
          if (sql.includes('flow_json')) return { flow_json: flow, version: 1, has_referral: 0 } as T;
          if (sql.includes('FROM sessions')) return null;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() { inserted.push(sql.slice(0, 40)); return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
    // S5-04: batch — сосед prepare и РЕАЛЬНО исполняет statement'ы: persist
    // вебхука идёт через db.batch, немой batch делал проверку фиктивной (§18/19).
    async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const s of stmts) await s?.run?.(); return []; },
  };
  const kvStore = new Map<string, string>();
  const kv = {
    async get(k: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string) { kvStore.set(k, v); },
    // resetFail/bumpFail гоняют счётчики через delete: без него роут падал в
    // catch-all 400 на полностью здоровом событии.
    async delete(k: string) { kvStore.delete(k); },
  };
  return { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ENVIRONMENT: 'dev', inserted } as any;
}

const tgTexts: string[] = [];
beforeEach(() => {
  tgTexts.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      const body = init?.body ? String(init.body) : '';
      try { tgTexts.push(JSON.parse(body).text ?? ''); } catch { tgTexts.push(''); }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function post(body: unknown) {
  return new Request(`https://test.example/wh/${HOOK_TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /wh/:token', () => {
  it('событие стартует сценарий с блока webhook_in, поля в wh.*', async () => {
    const env = makeEnv();
    const res = await (worker as any).fetch(post({ stage: 'won', user_id: 7, event_id: 'e1' }), env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(tgTexts).toContain('статус: won');
  });

  it('повтор того же event_id — 200 duplicate без второго прохода', async () => {
    const env = makeEnv();
    await (worker as any).fetch(post({ stage: 'won', user_id: 7, event_id: 'e2' }), env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    tgTexts.length = 0;
    const res = await (worker as any).fetch(post({ stage: 'lost', user_id: 7, event_id: 'e2' }), env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.duplicate).toBe(true);
    expect(tgTexts).toHaveLength(0);
  });

  it('без user_id — 400, сценарий не запускается', async () => {
    const env = makeEnv();
    const res = await (worker as any).fetch(post({ stage: 'won' }), env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    expect(res.status).toBe(400);
    expect(tgTexts).toHaveLength(0);
  });

  it('неизвестный токен — 404', async () => {
    const env = makeEnv();
    const req = new Request('https://test.example/wh/ZZZZZZZZZZ', { method: 'POST', body: JSON.stringify({ user_id: 7 }) });
    const res = await (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    expect(res.status).toBe(404);
  });

  it('битый JSON тела — 400, не 500', async () => {
    const env = makeEnv();
    const req = new Request(`https://test.example/wh/${HOOK_TOKEN}`, { method: 'POST', body: '{битый' });
    const res = await (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    expect(res.status).toBe(400);
  });
});
