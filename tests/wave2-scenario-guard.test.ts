// Волна 2 аудита 2026-10-18, интеграция worker:
//  - F-015: PUT /api/bots/:id/scenario читает body.version — устаревшая версия
//    → 409 { code: 'version-conflict', current }; актуальная и отсутствующая — 200;
//  - F-011: минутные лимиты на дорогие пути — simulate 30/мин на автора,
//    publish 10/мин на бота; 429 с Retry-After и русским сообщением;
//  - WS-08: onError логирует path БЕЗ query (в query живут токены/подписи).
// Harness — паттерн tests/subflow-worker.test.ts: фейковый D1 маршрутизируется
// по подстрокам SQL, prepare и batch — СОСЕДНИЕ методы db (§18/19).
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import type { Scenario } from '../shared/types';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');
const TOKEN_ENC = await encryptToken('123456:TEST-TOKEN', ENC_KEY);
const BOT_ID = 'bot-w2';
const OWNER = 'u1';
const ADMIN_KEY = 'test-admin-key';

function simpleScenario(text = 'привет'): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

interface State {
  scenarioVersion: number;
  scenarioJson: string;
  throwOn?: string; // подстрока SQL, на которой фейк бросает (для onError)
}

function makeEnv(state: Partial<State> = {}) {
  const st: State = {
    scenarioVersion: 4,
    scenarioJson: JSON.stringify(simpleScenario()),
    ...state,
  };
  const written: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (st.throwOn && s.includes(st.throwOn)) throw new Error('boom-db');
              if (s.includes('FROM bots WHERE id = ?')) {
                return { id: BOT_ID, name: 'W2', owner_id: OWNER, token_enc: TOKEN_ENC, webhook_secret: 'ws', active: 1, created_at: 1, has_referral: 0, published_version: null } as T;
              }
              if (s.includes('FROM scenarios WHERE bot_id = ?')) {
                return { flow_json: st.scenarioJson, version: st.scenarioVersion } as T;
              }
              if (s.includes('FROM scenario_drafts')) return null as T;
              if (s.includes('FROM subflows')) return null as T;
              return null;
            },
            async all<T>() {
              if (s.includes('FROM subflows WHERE owner_id = ?')) return { results: [] as T[] };
              return { results: [] as T[] };
            },
            async run() {
              written.push({ sql: s, args });
              if (s.startsWith('INSERT INTO scenarios')) {
                st.scenarioVersion = Number(args[4]);
                st.scenarioJson = String(args[3]);
              }
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
  kvStore.set('sess:tok-user', JSON.stringify({ id: OWNER, login: 'ivan', exp: Date.now() + 60_000 }));
  const kvPuts: Array<{ key: string; opts?: any }> = [];
  const kv = {
    async get(k: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string, opts?: any) { kvStore.set(k, v); kvPuts.push({ key: k, opts }); },
    async delete(k: string) { kvStore.delete(k); },
  };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production' } as any;
  return { env, st, written, kvStore, kvPuts };
}

async function call(env: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`https://bots.example${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await (worker as any).fetch(req, env, {});
  return { res, status: res.status, data: await res.json().catch(() => null) };
}

const OWNER_H = { authorization: 'Bearer tok-user' };
const ADMIN_H = { 'x-admin-key': ADMIN_KEY };

afterEach(() => vi.unstubAllGlobals());

describe('F-015: оптимистичная блокировка версии сценария', () => {
  it('устаревший version → 409 { code: version-conflict, current } и записи нет', async () => {
    const { env, st, written } = makeEnv();
    const r = await call(env, 'PUT', `/api/bots/${BOT_ID}/scenario`, {
      flow_json: JSON.stringify(simpleScenario('новый')), version: 1,
    }, OWNER_H);
    expect(r.status).toBe(409);
    expect(r.data.code).toBe('version-conflict');
    expect(r.data.current).toBe(4);
    expect(String(r.data.error)).toMatch(/изменился/i);
    // Отказ ДО сохранения: сценарий не перезаписан.
    expect(written.some((w) => w.sql.includes('INSERT INTO scenarios'))).toBe(false);
    expect(st.scenarioVersion).toBe(4);
  });

  it('актуальный version → 200, сохранение проходит', async () => {
    const { env, st } = makeEnv();
    const r = await call(env, 'PUT', `/api/bots/${BOT_ID}/scenario`, {
      flow_json: JSON.stringify(simpleScenario('новый')), version: 4,
    }, OWNER_H);
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(st.scenarioVersion).toBe(5);
    expect(JSON.parse(st.scenarioJson).blocks.m.params.text).toBe('новый');
  });

  it('без version в теле → 200 (обратная совместимость)', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'PUT', `/api/bots/${BOT_ID}/scenario`, {
      flow_json: JSON.stringify(simpleScenario('старый клиент')),
    }, OWNER_H);
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });

  it('мусорный version (не число) игнорируется → 200', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'PUT', `/api/bots/${BOT_ID}/scenario`, {
      flow_json: JSON.stringify(simpleScenario()), version: 'abc',
    }, OWNER_H);
    expect(r.status).toBe(200);
  });

  it('сценария ещё нет (prev = null) → version не блокирует', async () => {
    const db = {
      prepare(sql: string) {
        const s = sql.replace(/\s+/g, ' ');
        return {
          bind(..._args: unknown[]) {
            return {
              async first<T>() {
                if (s.includes('FROM bots WHERE id = ?')) {
                  return { id: BOT_ID, name: 'W2', owner_id: OWNER, token_enc: TOKEN_ENC, webhook_secret: 'ws', active: 0, created_at: 1 } as T;
                }
                return null;
              },
              async all<T>() { return { results: [] as T[] }; },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
      async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const x of stmts) await x?.run?.(); return []; },
    };
    const kvStore = new Map<string, string>();
    kvStore.set('sess:tok-user', JSON.stringify({ id: OWNER, login: 'ivan', exp: Date.now() + 60_000 }));
    const env = {
      DB: db,
      KV: { get: async (k: string) => kvStore.get(k) ?? null, put: async () => {}, delete: async () => {} },
      ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production',
    } as any;
    const r = await call(env, 'PUT', `/api/bots/${BOT_ID}/scenario`, {
      flow_json: JSON.stringify(simpleScenario()), version: 99,
    }, OWNER_H);
    expect(r.status).toBe(200);
    expect(r.data.version).toBe(1);
  });
});

describe('F-011: минутные лимиты simulate/publish', () => {
  it('simulate: 31-й запрос за минуту → 429 с Retry-After и русским текстом', async () => {
    const { env, kvStore } = makeEnv();
    const body = { flow_json: JSON.stringify(simpleScenario()), inputs: ['/start'] };
    let last: any = null;
    for (let i = 0; i < 31; i++) {
      last = await call(env, 'POST', `/api/bots/${BOT_ID}/simulate`, body, OWNER_H);
    }
    expect(last.status).toBe(429);
    expect(last.res.headers.get('retry-after')).toBe('60');
    expect(String(last.data.error)).toMatch(/Слишком частые запросы/);
    // Первые 30 прошли (200), ключ счётчика — sim:<userId>:<минута>.
    const keys = [...kvStore.keys()].filter((k) => k.startsWith('rl:sim:'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^rl:sim:u1:\d+$/);
  });

  it('publish: 11-й запрос за минуту → 429, ключ pub:<botId>', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })));
    const { env, kvStore } = makeEnv();
    const body = { flow_json: JSON.stringify(simpleScenario()) };
    let last: any = null;
    for (let i = 0; i < 11; i++) {
      last = await call(env, 'POST', `/api/bots/${BOT_ID}/publish`, body, ADMIN_H);
    }
    expect(last.status).toBe(429);
    expect(last.res.headers.get('retry-after')).toBe('60');
    expect([...kvStore.keys()].some((k) => k.startsWith(`rl:pub:${BOT_ID}:`))).toBe(true);
  });

  it('simulate под админ-ключом считается отдельно от аккаунта', async () => {
    const { env, kvStore } = makeEnv();
    const body = { flow_json: JSON.stringify(simpleScenario()), inputs: [] };
    for (let i = 0; i < 31; i++) await call(env, 'POST', `/api/bots/${BOT_ID}/simulate`, body, ADMIN_H);
    const r = await call(env, 'POST', `/api/bots/${BOT_ID}/simulate`, body, OWNER_H);
    expect(r.status).toBe(200);
    expect([...kvStore.keys()].filter((k) => k.startsWith('rl:sim:')).length).toBe(2);
  });
});

describe('WS-08: onError логирует путь без query', () => {
  it('в console.error нет query-параметров, путь присутствует', async () => {
    const { env } = makeEnv({ throwOn: 'FROM scenarios WHERE bot_id' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(env, 'PUT', `/api/bots/${BOT_ID}/scenario?token=SECRET&flow=x`, {
      flow_json: JSON.stringify(simpleScenario()),
    }, OWNER_H);
    expect(r.status).toBe(500);
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(`/api/bots/${BOT_ID}/scenario`);
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('token=');
    errSpy.mockRestore();
  });
});
