// Фиксы аудита 2026-10-18 на вебхуке /:botId и POST /api/templates:
// F-001 — идемпотентность по update_id (ретрай Telegram не исполняет сценарий дважды);
// F-006 — битый token_enc: 200 + лог bot.token_broken вместо вечных 500;
// F-007 — webhook-секрет сверяется constant-time (keysEqual), поведение то же;
// F-021 — poll_answer даёт userId: quiz/poll-ветки срабатывают для ответившего;
// F-004 — POST /api/templates: scenario_json > MAX_FLOW_BYTES → 413.
// Harness адаптирован из repro аудита (tmp/audit-2026-10-18/s1/repro/s1-webhook-repro.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import type { Scenario } from '../shared/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BOT_ID = 'bot-fix-audit';
const SECRET = 'whsec-fix';

function quizScenario(): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'q' },
      q: {
        id: 'q',
        type: 'quiz',
        params: {
          question: 'Сколько сохнет?',
          pollOptions: [{ id: 'a', text: '1' }, { id: 'b', text: '3' }],
          correctOptionId: 'b',
        },
        branches: { passed: 'p', failed: 'f' },
      },
      p: { id: 'p', type: 'message', params: { text: 'записываю' }, next: 'e' },
      f: { id: 'f', type: 'message', params: { text: 'пересдача' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

function counterScenario(): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'привет' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

function makeDb(scenario: Scenario, sessionRow: { current_block: string | null; vars_json: string } | null, opts: { tokenEnc?: string; sessionUserId?: number } = {}) {
  const flow = JSON.stringify(scenario);
  const sessionUserId = opts.sessionUserId ?? 42;
  const written: { sql: string; args: unknown[] }[] = [];
  const sessionQueries: unknown[][] = [];
  const db: any = {
    written,
    sessionQueries,
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async first<T>() {
          if (sql.includes('FROM bots')) {
            return {
              id: BOT_ID, owner_id: 'u1', name: 'Fix Bot',
              token_enc: opts.tokenEnc ?? (await encryptToken('123:TESTTOKEN', KEY)),
              webhook_secret: SECRET, active: 1, created_at: 1,
              bot_username: 'fixbot', has_referral: 0, published_version: 1,
            } as unknown as T;
          }
          if (sql.includes('FROM sessions')) {
            // Честная модель D1: сессия существует ТОЛЬКО для своего user_id.
            sessionQueries.push([...stmt.args]);
            if (stmt.args[1] !== sessionUserId) return null;
            return sessionRow as T;
          }
          if (sql.includes('flow_json')) return { flow_json: flow, version: 1, has_referral: 0 } as T;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() { written.push({ sql, args: stmt.args }); return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
    // batch — СОСЕДНИЙ метод db и он РЕАЛЬНО исполняет statement'ы (§19/§28).
    async batch(stmts: any[]) {
      for (const s of stmts ?? []) await s?.run?.();
      return [];
    },
  };
  return db;
}

function makeEnv(scenario: Scenario, sessionRow: { current_block: string | null; vars_json: string } | null, opts: { tokenEnc?: string } = {}) {
  const db = makeDb(scenario, sessionRow, opts);
  const kvStore = new Map<string, string>();
  const kv = {
    store: kvStore,
    async get(k: string, _t?: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string) { kvStore.set(k, v); },
    async delete(k: string) { kvStore.delete(k); },
  };
  return { env: { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ENVIRONMENT: 'dev' } as any, db, kv };
}

const tgCalls: { method: string; body: any }[] = [];
beforeEach(() => {
  tgCalls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      let body: any = {};
      try { body = JSON.parse(String(init?.body ?? '{}')); } catch { /* ignore */ }
      tgCalls.push({ method: u.split('/').pop()!, body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function postUpdate(env: any, update: unknown, secret = SECRET) {
  const req = new Request(`https://test.example/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  });
  return (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
}

describe('F-021: poll_answer даёт userId вебхуку', () => {
  it('сессия читается и пишется на user_id ответившего (42), не 0', async () => {
    const { env, db } = makeEnv(quizScenario(), { current_block: 'q', vars_json: '{}' });
    const update = { update_id: 111, poll_answer: { user: { id: 42 }, option_ids: [1], poll: { id: 'p1' } } };
    const res = await postUpdate(env, update);
    expect(res.status).toBe(200);
    // Чтение сессии — с user_id 42 (до фикса было 0 и сессия «не находилась»).
    expect(db.sessionQueries.some((q: unknown[]) => q[1] === 42)).toBe(true);
    expect(db.sessionQueries.some((q: unknown[]) => q[1] === 0)).toBe(false);
    const sessionWrites = db.written.filter((w: any) => w.sql.includes('INSERT INTO sessions') || w.sql.includes('UPDATE sessions') || w.sql.includes('sessions'));
    expect(sessionWrites.length).toBeGreaterThan(0);
    // Запись сессии (sessionAndLogStmts) — bind [bot_id, user_id, ...].
    const write = sessionWrites.find((w: any) => String(w.sql).includes('sessions'));
    expect(write!.args).toContain(42);
  });

  it('quiz-блок продвигается: верный ответ → ветка passed', async () => {
    const { env } = makeEnv(quizScenario(), { current_block: 'q', vars_json: '{}' });
    const update = { update_id: 112, poll_answer: { user: { id: 42 }, option_ids: [1], poll: { id: 'p1' } } };
    const res = await postUpdate(env, update);
    expect(res.status).toBe(200);
    expect(tgCalls.some((c) => c.method === 'sendMessage' && c.body.text === 'записываю')).toBe(true);
  });
});

describe('F-001: идемпотентность вебхука по update_id', () => {
  it('повтор того же update_id → 200 duplicate, сценарий НЕ исполняется дважды', async () => {
    const { env, kv } = makeEnv(counterScenario(), null);
    const update = {
      update_id: 777,
      message: { message_id: 5, date: 1, chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: false }, text: '/start' },
    };
    const r1 = await postUpdate(env, update);
    expect(r1.status).toBe(200);
    const sent1 = tgCalls.filter((c) => c.method === 'sendMessage').length;
    expect(sent1).toBe(1);
    expect(kv.store.has(`upd:${BOT_ID}:777`)).toBe(true); // ключ дедупа записан

    const r2 = await postUpdate(env, update); // ретрай Telegram
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.duplicate).toBe(true);
    const sent2 = tgCalls.filter((c) => c.method === 'sendMessage').length;
    expect(sent2).toBe(sent1); // никакого второго исполнения
  });

  it('разные update_id исполняются независимо', async () => {
    const { env } = makeEnv(counterScenario(), null);
    const mk = (id: number) => ({
      update_id: id,
      message: { message_id: id, date: 1, chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: false }, text: '/start' },
    });
    await postUpdate(env, mk(801));
    await postUpdate(env, mk(802));
    expect(tgCalls.filter((c) => c.method === 'sendMessage').length).toBe(2);
  });

  it('апдейт без update_id (не бывает от Telegram, но robustness) — исполняется', async () => {
    const { env } = makeEnv(counterScenario(), null);
    const res = await postUpdate(env, { message: { message_id: 1, date: 1, chat: { id: 9 }, from: { id: 9 }, text: '/start' } });
    expect(res.status).toBe(200);
    expect(tgCalls.filter((c) => c.method === 'sendMessage').length).toBe(1);
  });
});

describe('F-006: битый token_enc не роняет вебхук в вечные 500', () => {
  it('garbage в token_enc → 200 + лог bot.token_broken, Telegram-вызовов нет', async () => {
    const { env, db } = makeEnv(counterScenario(), null, { tokenEnc: 'garbage-not-a-token' });
    const update = {
      update_id: 900,
      message: { message_id: 1, date: 1, chat: { id: 9 }, from: { id: 9 }, text: '/start' },
    };
    const res = await postUpdate(env, update);
    expect(res.status).toBe(200);
    expect(tgCalls).toHaveLength(0);
    const logged = db.written.some((w: any) => w.args.some((a) => String(a) === 'bot.token_broken'));
    expect(logged).toBe(true);
  });
});

describe('F-007: webhook-секрет — constant-time сравнение', () => {
  it('неверный секрет → 403, верный → 200', async () => {
    const { env } = makeEnv(counterScenario(), null);
    const update = {
      update_id: 950,
      message: { message_id: 1, date: 1, chat: { id: 9 }, from: { id: 9 }, text: '/start' },
    };
    const bad = await postUpdate(env, update, 'wrong-secret');
    expect(bad.status).toBe(403);
    const good = await postUpdate(env, update, SECRET);
    expect(good.status).toBe(200);
  });
});

describe('F-004: POST /api/templates — лимит размера scenario_json', () => {
  function makeTplEnv() {
    const written: { sql: string; args: unknown[] }[] = [];
    const kvStore = new Map<string, string>();
    kvStore.set('sess:tok-tpl', JSON.stringify({ id: 'u-tpl', login: 'tpluser', exp: Date.now() + 60_000 }));
    const db: any = {
      prepare(sql: string) {
        const stmt = {
          args: [] as unknown[],
          bind(...args: unknown[]) { stmt.args = args; return stmt; },
          async first<T>() { return null as T; },
          async all<T>() { return { results: [] as T[] }; },
          async run() { written.push({ sql, args: stmt.args }); return { meta: { changes: 1 } }; },
        };
        return stmt;
      },
      async batch(stmts: any[]) { for (const s of stmts ?? []) await s?.run?.(); return []; },
    };
    const kv = {
      async get(k: string) { return kvStore.get(k) ?? null; },
      async put(k: string, v: string) { kvStore.set(k, v); },
      async delete(k: string) { kvStore.delete(k); },
    };
    return { env: { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ENVIRONMENT: 'dev' } as any, written };
  }

  async function postTemplate(env: any, scenarioJson: string) {
    const req = new Request('https://test.example/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-tpl' },
      body: JSON.stringify({ title: 'big', description: 'd', scenario_json: scenarioJson }),
    });
    return (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
  }

  it('scenario_json > 1 МБ → 413, запись не создаётся', async () => {
    const { env, written } = makeTplEnv();
    const big = JSON.stringify({ start: 's', blocks: { s: { id: 's', type: 'start', params: {}, next: null } }, pad: 'x'.repeat(1024 * 1024 + 10) });
    const res = await postTemplate(env, big);
    expect(res.status).toBe(413);
    expect(written.some((w) => w.sql.includes('INSERT INTO templates'))).toBe(false);
  });

  it('нормальный scenario_json проходит лимит (не 413)', async () => {
    const { env } = makeTplEnv();
    const small = JSON.stringify({ start: 's', blocks: { s: { id: 's', type: 'start', params: {}, next: null } } });
    const res = await postTemplate(env, small);
    // 201 — запись прошла; если форма сценария не устроит валидатор — 400, но НЕ 413.
    expect(res.status).not.toBe(413);
  });
});
