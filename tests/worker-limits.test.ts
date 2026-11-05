// Сквозная приёмка снятия жёстких потолков (§1, §4, §5, §6) на уровне воркера:
// вебхук + крон на фейковом D1 (паттерн — tests/cron-scheduled.test.ts,
// tests/worker-callback.test.ts).
//
// §1: цепочка 250 блоков — полный вывод за ОДИН вебхук-запрос, без resume-строки;
//     цепочка 1500 блоков — resume-строка в scheduled_sends + лог engine.budget.resume.*;
//     крон доводит остаток до конца.
// §4: регистрация schedule-блока через вебхук; processSchedules fire'ит по минуте,
//     двойной тик не дублирует (markScheduleRun атомарна), all-аудитория — пачки
//     schedule_run, single — resume; исчезнувший блок → enabled=0 + schedule.disabled.*;
//     сквозной worker.scheduled: расписание → поток → sendMessage каждому подписчику.
// §5: три последовательных ai-блока с historyVar — messages 1, 3, 5; пустой ответ
//     не добавляет assistant-ход; история >8 КБ режется oldest-first, вызов жив;
//     persistHistoryTo пишет в коллекцию.
// §6: 12 последовательных http-блоков завершаются в одном запросе (все outVar в сессии);
//     30 блоков — отложение async.chain.deferred.* + resume-строка, крон доводит.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { _testOnly } from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import { assembleAiMessages, normalizeHistory, appendTurns, clampTurns } from '../worker/src/aiHistory';
import type { Scenario } from '../shared/types';

const ENC_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const SECRET = 'whsec-limits';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

interface SchedRow {
  id: string;
  bot_id: string;
  block_id: string;
  cron_expr: string;
  timezone: string;
  audience: string;
  audience_tag: string;
  audience_user: number | null;
  enabled: number;
  last_run_at: number | null;
  created_at: number;
}

interface SendRow {
  id: number;
  bot_id: string;
  user_id: number;
  send_at: number;
  method: string;
  payload_json: string;
  attempts: number;
  created_at: number;
  claimed_at?: number | null; // F-013 (миграция 0029)
}

interface FakeSeed {
  botId?: string;
  scenario?: Scenario;
  subscribers?: number[];
  tags?: Array<{ user_id: number; tag: string }>;
  schedules?: Partial<SchedRow>[];
  session?: { current_block: string | null; vars_json: string };
  collections?: boolean;
}

// Фейковый D1 с честными хранилищами: bots, sessions, scenarios, logs,
// scheduled_sends, bot_schedules, subscribers, user_tags, collection_items.
// Роутер — по нормализованному SQL (startsWith/includes), как в живых тестах.
function makeDb(seed: FakeSeed = {}) {
  const botId = seed.botId ?? 'bot1';
  // TOKEN_ENC готовится в beforeEach (encryptToken асинхронный) — к моменту
  // вызова makeDb внутри теста он всегда есть.
  const bots: any[] = [{ id: botId, owner_id: 'u1', name: 'T', token_enc: TOKEN_ENC, webhook_secret: SECRET, active: 1, created_at: 1, published_version: 1 }];
  const sessions = new Map<string, { current_block: string | null; vars_json: string; updated_at?: number }>(
    seed.session ? [[`${botId}:1`, { ...seed.session, updated_at: 1 }]] : []
  );
  const logs: Array<{ bot_id: string; user_id: number | null; event: string }> = [];
  let nextSendId = 1;
  const sends: SendRow[] = [];
  const schedules: SchedRow[] = (seed.schedules ?? []).map((s, i) => ({
    id: s.id ?? `sch${i + 1}`,
    bot_id: s.bot_id ?? botId,
    block_id: s.block_id ?? 'sch',
    cron_expr: s.cron_expr ?? '0 10 * * *',
    timezone: s.timezone ?? 'Europe/Moscow',
    audience: s.audience ?? 'all',
    audience_tag: s.audience_tag ?? '',
    audience_user: s.audience_user ?? null,
    enabled: s.enabled ?? 1,
    last_run_at: s.last_run_at ?? null,
    created_at: s.created_at ?? Date.now() - 3600_000,
  }));
  const subscribers = seed.subscribers ?? [];
  const userTags = seed.tags ?? [];
  const items: Array<{ id: string; collection_id: string; data_json: string }> = [];
  const recorded: Array<{ sql: string; args: unknown[] }> = [];
  const flowJson = seed.scenario ? JSON.stringify(seed.scenario) : null;

  function applyRun(s: string, args: unknown[]): { meta: { changes: number; last_row_id?: number } } {
    recorded.push({ sql: s, args });
    if (s === 'INSERT INTO logs (bot_id, user_id, event, ts) VALUES (?,?,?,?)') {
      logs.push({ bot_id: String(args[0]), user_id: args[1] == null ? null : Number(args[1]), event: String(args[2]) });
      return { meta: { changes: 1 } };
    }
    if (s === 'INSERT INTO scheduled_sends (bot_id, user_id, send_at, method, payload_json, created_at) VALUES (?,?,?,?,?,?)') {
      sends.push({ id: nextSendId++, bot_id: String(args[0]), user_id: Number(args[1]), send_at: Number(args[2]), method: String(args[3]), payload_json: String(args[4]), attempts: 0, created_at: Number(args[5]) });
      return { meta: { changes: 1 } };
    }
    if (s === 'DELETE FROM scheduled_sends WHERE id = ?') {
      const i = sends.findIndex((r) => r.id === Number(args[0]));
      if (i >= 0) sends.splice(i, 1);
      return { meta: { changes: i >= 0 ? 1 : 0 } };
    }
    if (s === 'UPDATE scheduled_sends SET attempts = ? WHERE id = ?') {
      const row = sends.find((r) => r.id === Number(args[1]));
      if (row) row.attempts = Number(args[0]);
      return { meta: { changes: row ? 1 : 0 } };
    }
    // F-013: атомарный захват claimed_at.
    if (s === 'UPDATE scheduled_sends SET claimed_at = ? WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)') {
      const row = sends.find((r) => r.id === Number(args[1]));
      if (row && (row.claimed_at == null || row.claimed_at < Number(args[2]))) {
        row.claimed_at = Number(args[0]);
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (s === 'UPDATE scheduled_sends SET send_at = ? WHERE id = ?') {
      const row = sends.find((r) => r.id === Number(args[1]));
      if (row) row.send_at = Number(args[0]);
      return { meta: { changes: row ? 1 : 0 } };
    }
    // F-028/F-013: перенос с освобождением захвата.
    if (s === 'UPDATE scheduled_sends SET send_at = ?, claimed_at = NULL WHERE id = ?') {
      const row = sends.find((r) => r.id === Number(args[1]));
      if (row) { row.send_at = Number(args[0]); row.claimed_at = null; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (s === 'UPDATE scheduled_sends SET send_at = ?, payload_json = ?, claimed_at = NULL WHERE id = ?') {
      const row = sends.find((r) => r.id === Number(args[2]));
      if (row) { row.send_at = Number(args[0]); row.payload_json = String(args[1]); row.claimed_at = null; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (s.startsWith('INSERT INTO sessions')) {
      const key = `${args[0]}:${args[1]}`;
      sessions.set(key, { current_block: args[2] == null ? null : String(args[2]), vars_json: String(args[3]), updated_at: Number(args[4]) });
      return { meta: { changes: 1 } };
    }
    // F-002: CAS-ветка upsertSessionCas — UPDATE ... WHERE updated_at = base.
    if (s === 'UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ? WHERE bot_id = ? AND user_id = ? AND updated_at = ?') {
      const key = `${args[4]}:${args[5]}`;
      const row = sessions.get(key);
      if (!row || Number(row.updated_at) !== Number(args[6])) return { meta: { changes: 0 } };
      sessions.set(key, { current_block: args[0] == null ? null : String(args[0]), vars_json: String(args[1]), updated_at: Number(args[2]) });
      return { meta: { changes: 1 } };
    }
    // merged-ветка: тот же UPDATE без условия на updated_at.
    if (s === 'UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ? WHERE bot_id = ? AND user_id = ?') {
      const key = `${args[4]}:${args[5]}`;
      sessions.set(key, { current_block: args[0] == null ? null : String(args[0]), vars_json: String(args[1]), updated_at: Number(args[2]) });
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO bot_schedules')) {
      // (id, bot_id, block_id, cron_expr, timezone, audience, audience_tag, audience_user, enabled=1, last_run_at=NULL, created_at)
      const existing = schedules.find((r) => r.bot_id === args[1] && r.block_id === args[2]);
      if (existing) {
        existing.cron_expr = String(args[3]);
        existing.timezone = String(args[4]);
        existing.audience = String(args[5]);
        existing.audience_tag = String(args[6]);
        existing.audience_user = args[7] == null ? null : Number(args[7]);
        existing.enabled = 1;
      } else {
        schedules.push({
          id: String(args[0]),
          bot_id: String(args[1]),
          block_id: String(args[2]),
          cron_expr: String(args[3]),
          timezone: String(args[4]),
          audience: String(args[5]),
          audience_tag: String(args[6]),
          audience_user: args[7] == null ? null : Number(args[7]),
          enabled: 1,
          last_run_at: null,
          created_at: Number(args[8]),
        });
      }
      return { meta: { changes: 1 } };
    }
    if (s === 'UPDATE bot_schedules SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at < ?)') {
      const row = schedules.find((r) => r.id === args[1]);
      if (row && (row.last_run_at == null || row.last_run_at < Number(args[2]))) {
        row.last_run_at = Number(args[0]);
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (s === 'UPDATE bot_schedules SET enabled = 0 WHERE id = ?') {
      const row = schedules.find((r) => r.id === args[0]);
      if (row) row.enabled = 0;
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (s.startsWith('INSERT INTO collection_items')) {
      items.push({ id: String(args[0]), collection_id: String(args[1]), data_json: String(args[4]) });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }

  async function firstOf(s: string, args: unknown[]): Promise<any> {
    recorded.push({ sql: s, args });
    if (s === 'SELECT * FROM bots WHERE id = ?') return bots.find((b) => b.id === args[0]) ?? null;
    if (s === 'SELECT current_block, vars_json FROM sessions WHERE bot_id = ? AND user_id = ?')
      return sessions.get(`${args[0]}:${args[1]}`) ?? null;
    // F-002: CAS-чтение вебхука (с updated_at) и перечитывание upsertSessionCas.
    if (s === 'SELECT current_block, vars_json, updated_at FROM sessions WHERE bot_id = ? AND user_id = ?')
      return sessions.get(`${args[0]}:${args[1]}`) ?? null;
    if (s === 'SELECT vars_json, updated_at FROM sessions WHERE bot_id = ? AND user_id = ?')
      return sessions.get(`${args[0]}:${args[1]}`) ?? null;
    if (s === 'SELECT first_name, username FROM sessions WHERE bot_id = ? AND user_id = ?') return null;
    if (s.startsWith('SELECT sb.flow_json')) return null; // билдов подсценариев нет
    if (s.startsWith('SELECT s.flow_json, s.version FROM scenarios s JOIN bots'))
      return flowJson ? { flow_json: flowJson, version: 1 } : null;
    // loadScenario (крон: resume / schedule_run / wait_timeout).
    if (s.startsWith('SELECT flow_json, version FROM scenarios WHERE bot_id = ?'))
      return flowJson ? { flow_json: flowJson, version: 1 } : null;
    if (s === 'SELECT active, published_version FROM bots WHERE id = ?')
      return bots.find((b) => b.id === args[0]) ?? null;
    if (s === 'SELECT COUNT(*) AS n FROM bot_schedules WHERE bot_id = ?')
      return { n: schedules.filter((r) => r.bot_id === args[0]).length };
    if (s === 'SELECT * FROM bot_schedules WHERE bot_id = ? AND block_id = ?')
      return schedules.find((r) => r.bot_id === args[0] && r.block_id === args[1]) ?? null;
    if (s === 'SELECT attempts FROM scheduled_sends WHERE id = ?') {
      const row = sends.find((r) => r.id === Number(args[0]));
      return row ? { attempts: row.attempts } : null;
    }
    return null;
  }

  async function allOf(s: string, args: unknown[]): Promise<any[]> {
    recorded.push({ sql: s, args });
    if (s.startsWith('SELECT id, bot_id, user_id, method, payload_json FROM scheduled_sends WHERE send_at <= ?')) {
      const now = Number(args[0]);
      const staleBefore = Number(args[1]); // F-013: claimed_at IS NULL OR < now-stale
      return sends
        .filter((r) => r.send_at <= now && (r.claimed_at == null || r.claimed_at < staleBefore))
        .sort((a, b) => a.send_at - b.send_at)
        .slice(0, 50)
        .map(({ id, bot_id, user_id, method, payload_json }) => ({ id, bot_id, user_id, method, payload_json }));
    }
    if (s.startsWith('SELECT * FROM bot_schedules WHERE enabled = 1'))
      return schedules.filter((r) => r.enabled === 1);
    if (s === 'SELECT user_id FROM subscribers WHERE bot_id = ?')
      return subscribers.filter(() => true).map((u) => ({ user_id: u }));
    if (s.startsWith('SELECT user_id FROM user_tags WHERE bot_id = ? AND tag = ?'))
      return userTags.filter((t) => t.tag === args[1]).map((t) => ({ user_id: t.user_id }));
    if (s === 'SELECT 1 AS hit FROM subscribers WHERE bot_id = ? AND user_id = ?')
      return subscribers.includes(Number(args[1])) ? [{ hit: 1 }] : [];
    return [];
  }

  const db = {
    prepare(sql: string) {
      const s = norm(sql);
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          return stmt;
        },
        first: () => firstOf(s, stmt.args),
        all: async () => ({ results: await allOf(s, stmt.args) }),
        run: async () => applyRun(s, stmt.args),
      };
      return stmt;
    },
    // batch — СОСЕД prepare (уроки §18/§19): исполняем statement'ы по очереди.
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    __logs: logs,
    __sends: sends,
    __schedules: schedules,
    __sessions: sessions,
    __items: items,
    __recorded: recorded,
  };
  return db;
}

function makeKV(botId: string) {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      if (key === botId) return SECRET;
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

// Сценарий для вебхука грузится через loadScenarioCached → KV-кэш sc:<botId>.
// Кладём сценарий сразу в кэш: роутер ботов не участвует, меньше SQL-эмуляции.
function primeKv(kv: ReturnType<typeof makeKV>, botId: string, scenario: Scenario) {
  kv.store.set(`sc:${botId}`, JSON.stringify({ version: 1, flow_json: JSON.stringify(scenario), has_referral: false }));
}

function makeEnv(db: any, kv: any, extra: Record<string, unknown> = {}) {
  return { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ENVIRONMENT: 'production', HTTP_ALLOWED_HOSTS: '', ...extra } as any;
}

// Все боты seed'ятся одним валидным token_enc.
let TOKEN_ENC = '';
beforeEach(async () => {
  TOKEN_ENC = await encryptToken('123:TESTTOKEN', ENC_KEY);
});

const tgCalls: Array<{ method: string; payload: any }> = [];
const aiRequests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
const httpHits: string[] = [];

beforeEach(() => {
  tgCalls.length = 0;
  aiRequests.length = 0;
  httpHits.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop()!;
      let payload: any = {};
      try {
        payload = JSON.parse(String(init?.body ?? '{}'));
      } catch {
        /* ignore */
      }
      tgCalls.push({ method, payload });
      return new Response(JSON.stringify({ ok: true, result: { message_id: tgCalls.length } }), { status: 200 });
    }
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      aiRequests.push({ messages: body.messages });
      const n = aiRequests.length;
      const content = (globalThis as any).__aiEmpty ? '' : `answer${n}`;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    if (u.includes('api.example.com')) {
      httpHits.push(u);
      const idx = httpHits.length;
      return new Response(JSON.stringify({ ok: true, n: idx }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).__aiEmpty;
});

async function sendWebhook(env: any, botId: string, update: any) {
  const req = new Request(`https://test.example/${botId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify(update),
  });
  // waitUntil исполняем сразу: persist (запись сессии) должен завершиться.
  const res = await (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
  expect(res.status).toBe(200);
}

const startMsg = { message: { message_id: 1, chat: { id: 1 }, from: { id: 1 }, text: '/start' } };

// ---------------------------------------------------------------- §1 бюджет

function chainScenario(n: number): Scenario {
  const blocks: any = { s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm0' } };
  for (let i = 0; i < n; i++) {
    blocks[`m${i}`] = { id: `m${i}`, type: 'message', params: { text: `шаг ${i}` }, next: i + 1 < n ? `m${i + 1}` : 'fin' };
  }
  blocks.fin = { id: 'fin', type: 'end', params: {} };
  return { version: 1, start: 's', blocks } as Scenario;
}

describe('§1 бюджет шагов: вебхук не паркует сессию', () => {
  it('250 блоков — полный вывод за один запрос, без resume-строки и без guardCutoff-лога', async () => {
    const db = makeDb({ scenario: chainScenario(250) });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', chainScenario(250));
    const env = makeEnv(db, kv);
    // token_enc: бот в фейке создаётся без него — подставим напрямую.
    await sendWebhook(env, 'bot1', startMsg);

    const sent = tgCalls.filter((c) => c.method === 'sendMessage');
    expect(sent.length).toBe(250);
    expect(sent[0].payload.text).toBe('шаг 0');
    expect(sent[249].payload.text).toBe('шаг 249');
    // Никакого отложенного продолжения: поток прошёл целиком.
    expect(db.__sends.filter((r: SendRow) => r.method === 'resume')).toHaveLength(0);
    expect(db.__logs.some((l: any) => l.event.startsWith('engine.budget.resume'))).toBe(false);
    // Сессия не запаркована на середине: current_block = null (end).
    const sess = db.__sessions.get('bot1:1');
    expect(sess?.current_block).toBeNull();
  });

  it('1500 блоков — resume-строка + engine.budget.resume.<blockId>, крон доводит до конца', async () => {
    const sc = chainScenario(1500);
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv);
    await sendWebhook(env, 'bot1', startMsg);

    const resumeRows = db.__sends.filter((r: SendRow) => r.method === 'resume');
    expect(resumeRows.length).toBeGreaterThanOrEqual(1);
    const resumeLog = db.__logs.find((l: any) => l.event.startsWith('engine.budget.resume.'));
    expect(resumeLog).toBeTruthy();
    // Первый проход выдал ~1000 сообщений, не 1500.
    expect(tgCalls.filter((c) => c.method === 'sendMessage').length).toBeGreaterThan(900);
    expect(tgCalls.filter((c) => c.method === 'sendMessage').length).toBeLessThan(1100);

    // Крон-тик доводит остаток: processDue исполняет resume-строки.
    tgCalls.length = 0;
    const tick = await (worker as any).scheduled({}, env);
    expect((await tick.text())).toContain('processed');
    const total = tgCalls.filter((c) => c.method === 'sendMessage').length;
    expect(total).toBeGreaterThan(400); // хвост 1500-цепочки доехал
    // Поток завершён: resume-строк больше нет.
    expect(db.__sends.filter((r: SendRow) => r.method === 'resume')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- §6 async chain

function httpChainScenario(n: number): Scenario {
  const blocks: any = { s: { id: 's', type: 'start', params: { command: '/start' }, next: 'h0' } };
  for (let i = 0; i < n; i++) {
    blocks[`h${i}`] = {
      id: `h${i}`,
      type: 'http',
      params: { url: `https://api.example.com/r${i}`, method: 'GET', jsonPath: 'n', outVar: `v${i}` },
      next: i + 1 < n ? `h${i + 1}` : 'fin',
    };
  }
  blocks.fin = { id: 'fin', type: 'message', params: { text: 'цепочка готова' } };
  return { version: 1, start: 's', blocks } as Scenario;
}

describe('§6 асинхронная цепочка глубже 5', () => {
  it('12 http-блоков завершаются в ОДНОМ запросе, все outVar в сессии', async () => {
    const sc = httpChainScenario(12);
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv);
    await sendWebhook(env, 'bot1', startMsg);

    expect(httpHits.length).toBe(12);
    expect(tgCalls.some((c) => c.payload?.text === 'цепочка готова')).toBe(true);
    const sess = JSON.parse(db.__sessions.get('bot1:1')?.vars_json ?? '{}');
    for (let i = 0; i < 12; i++) expect(sess[`v${i}`]).toBeDefined();
    // Никаких отложений: глубина 12 < MAX_ASYNC_CHAIN(25).
    expect(db.__logs.some((l: any) => l.event.startsWith('async.chain.deferred'))).toBe(false);
  });

  it('30 http-блоков — хвост откладывается (async.chain.deferred + resume-строка), крон доводит', async () => {
    const sc = httpChainScenario(30);
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv);
    await sendWebhook(env, 'bot1', startMsg);

    const deferredLog = db.__logs.find((l: any) => l.event.startsWith('async.chain.deferred.'));
    expect(deferredLog).toBeTruthy();
    const resumeRows = db.__sends.filter((r: SendRow) => r.method === 'resume');
    expect(resumeRows.length).toBeGreaterThanOrEqual(1);
    expect(httpHits.length).toBe(26); // 25 проходов + первый блок

    // Крон доводит хвост.
    const tick = await (worker as any).scheduled({}, env);
    await tick.text();
    expect(httpHits.length).toBe(30);
    expect(tgCalls.some((c) => c.payload?.text === 'цепочка готова')).toBe(true);
  });
});

// ---------------------------------------------------------------- §5 ai history

function aiChainScenario(n: number, historyVar: string, extra: Record<string, unknown> = {}): Scenario {
  const blocks: any = { s: { id: 's', type: 'start', params: { command: '/start' }, next: 'a0' } };
  for (let i = 0; i < n; i++) {
    blocks[`a${i}`] = {
      id: `a${i}`,
      type: 'ai',
      params: { aiPrompt: `вопрос ${i}`, aiVar: `ans${i}`, historyVar, ...extra },
      next: i + 1 < n ? `a${i + 1}` : 'fin',
    };
  }
  blocks.fin = { id: 'fin', type: 'end', params: {} };
  return { version: 1, start: 's', blocks } as Scenario;
}

describe('§5 память диалога ai', () => {
  it('три последовательных ai-вызова с historyVar: messages 1, 3, 5', async () => {
    const sc = aiChainScenario(3, 'h');
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv, { AI_API_KEY: 'k', AI_BASE_URL: 'https://ai.example.com/v1' });
    await sendWebhook(env, 'bot1', startMsg);

    expect(aiRequests.length).toBe(3);
    expect(aiRequests[0].messages).toHaveLength(1);
    expect(aiRequests[0].messages[0]).toEqual({ role: 'user', content: 'вопрос 0' });
    expect(aiRequests[1].messages).toHaveLength(3);
    expect(aiRequests[1].messages[1]).toEqual({ role: 'assistant', content: 'answer1' });
    expect(aiRequests[2].messages).toHaveLength(5);
    // История в сессии: 3 пары user/assistant.
    const sess = JSON.parse(db.__sessions.get('bot1:1')?.vars_json ?? '{}');
    expect(Array.isArray(sess.h)).toBe(true);
    expect(sess.h).toHaveLength(6);
    expect(sess.ans0).toBe('answer1');
    expect(sess.ans2).toBe('answer3');
  });

  it('без historyVar поведение прежнее: один user-промпт на вызов', async () => {
    const sc = aiChainScenario(2, '');
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv, { AI_API_KEY: 'k', AI_BASE_URL: 'https://ai.example.com/v1' });
    await sendWebhook(env, 'bot1', startMsg);
    expect(aiRequests.length).toBe(2);
    for (const r of aiRequests) expect(r.messages).toHaveLength(1);
  });

  it('пустой ответ модели не добавляет assistant-ход', async () => {
    const sc = aiChainScenario(2, 'h');
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv, { AI_API_KEY: 'k', AI_BASE_URL: 'https://ai.example.com/v1' });
    (globalThis as any).__aiEmpty = true;
    await sendWebhook(env, 'bot1', startMsg);
    const sess = JSON.parse(db.__sessions.get('bot1:1')?.vars_json ?? '{}');
    // Два user-хода, ноль assistant-ходов.
    expect(sess.h).toHaveLength(2);
    expect(sess.h.every((t: any) => t.role === 'user')).toBe(true);
  });

  it('persistHistoryTo дублирует историю в коллекцию через data-операции', async () => {
    const sc = aiChainScenario(1, 'h', { persistHistoryTo: 'coll-history' });
    const db = makeDb({ scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    const env = makeEnv(db, kv, { AI_API_KEY: 'k', AI_BASE_URL: 'https://ai.example.com/v1' });
    await sendWebhook(env, 'bot1', startMsg);
    expect(db.__items.length).toBe(1);
    expect(db.__items[0].collection_id).toBe('coll-history');
    const data = JSON.parse(db.__items[0].data_json);
    expect(Array.isArray(JSON.parse(data.history))).toBe(true);
  });

  it('история больше 8 КБ режется oldest-first, вызов возвращает ответ', () => {
    const big = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'ы'.repeat(300) }));
    const asm = assembleAiMessages('система', 'текущий вопрос', big as any);
    expect(asm.dropped).toBeGreaterThan(0);
    const totalBytes = new TextEncoder().encode(JSON.stringify(asm.messages)).length;
    expect(totalBytes).toBeLessThanOrEqual(8 * 1024 + 512); // оценка сверху расходится с JSON максимум на служебные символы
    // Текущий промпт — всегда последнее сообщение.
    expect(asm.messages[asm.messages.length - 1]).toEqual({ role: 'user', content: 'текущий вопрос' });
    // Выжившие ходы — ХВОСТ истории (oldest-first drop).
    expect(asm.keptHistory[asm.keptHistory.length - 1].content).toBe(big[big.length - 1].content);
  });

  it('normalizeHistory/clampTurns/appendTurns — контракты', () => {
    expect(clampTurns(undefined)).toBe(6);
    expect(clampTurns(100)).toBe(20);
    expect(clampTurns(0)).toBe(6);
    const raw = [{ role: 'user', content: 'a' }, null, { role: 'alien', content: 'x' }, { role: 'assistant', content: 'b' }];
    expect(normalizeHistory(raw, 6)).toHaveLength(2);
    expect(normalizeHistory('не массив', 6)).toEqual([]);
    const appended = appendTurns([{ role: 'user', content: 'q' }], 'новый', 'ответ', 6);
    expect(appended).toHaveLength(3);
    expect(appended[2]).toEqual({ role: 'assistant', content: 'ответ' });
    const emptyAns = appendTurns([], 'q', '   ', 6);
    expect(emptyAns).toHaveLength(1); // пустой ответ не пишет assistant-ход
  });
});

// ---------------------------------------------------------------- §4 расписания

const scheduleScenario: Scenario = {
  version: 1,
  start: 's',
  blocks: {
    s: { id: 's', type: 'start', params: { command: '/start' }, next: 'sch' },
    sch: {
      id: 'sch',
      type: 'schedule' as any,
      params: { scheduleKind: 'daily', atTime: '10:00', scheduleAudience: 'all', timezone: 'Europe/Moscow' },
      next: 'flow1',
    },
    flow1: { id: 'flow1', type: 'message', params: { text: 'доброе утро' }, next: 'e' },
    e: { id: 'e', type: 'end', params: {} },
  },
} as any;

describe('§4 расписания: регистрация', () => {
  it('schedule-блок через вебхук регистрирует строку bot_schedules (cron из параметров, audience)', async () => {
    const db = makeDb({ scenario: scheduleScenario });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', scheduleScenario);
    const env = makeEnv(db, kv);
    await sendWebhook(env, 'bot1', startMsg);

    expect(db.__schedules.length).toBe(1);
    const row: SchedRow = db.__schedules[0];
    expect(row.bot_id).toBe('bot1');
    expect(row.block_id).toBe('sch');
    expect(row.cron_expr).toBe('0 10 * * *');
    expect(row.timezone).toBe('Europe/Moscow');
    expect(row.audience).toBe('all');
    expect(row.enabled).toBe(1);
    expect(db.__logs.some((l: any) => l.event === 'schedule.registered.sch')).toBe(true);
    // Поток после регистрации продолжается (next): сообщение отправлено.
    expect(tgCalls.some((c) => c.payload?.text === 'доброе утро')).toBe(true);
  });

  it('повторная регистрация того же блока — апсерт, строка одна', async () => {
    const db = makeDb({ scenario: scheduleScenario });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', scheduleScenario);
    const env = makeEnv(db, kv);
    await sendWebhook(env, 'bot1', startMsg);
    await sendWebhook(env, 'bot1', startMsg);
    expect(db.__schedules.length).toBe(1);
  });
});

describe('§4 расписания: крон', () => {
  const TICK = Date.UTC(2026, 8, 30, 7, 0, 30); // 10:00:30 Europe/Moscow

  function schedEnv(seed: FakeSeed) {
    const sc = seed.scenario ?? scheduleScenario;
    const db = makeDb({ ...seed, scenario: sc });
    const kv = makeKV('bot1');
    primeKv(kv, 'bot1', sc);
    return { db, env: makeEnv(db, kv) };
  }

  it('daily 10:00 MSK: тик в 07:00 UTC fire’ит — schedule_run-пачки всем подписчикам', async () => {
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', audience: 'all', created_at: TICK - 86_400_000 }],
      subscribers: [11, 22, 33],
    });
    const fired = await _testOnly.processSchedules(env, TICK);
    expect(fired).toBe(1);
    const rows = db.__sends.filter((r: SendRow) => r.method === 'schedule_run');
    expect(rows.length).toBe(1);
    const payload = JSON.parse(rows[0].payload_json);
    expect(payload.users).toEqual([11, 22, 33]);
    expect(payload.resumeBlockId).toBe('flow1');
    expect(db.__logs.some((l: any) => l.event.startsWith('schedule.fired.sch.'))).toBe(true);
    // last_run_at сдвинут.
    expect(db.__schedules[0].last_run_at).toBe(TICK);
  });

  it('два тика в одну минуту — второй НЕ fire’ит (атомарный markScheduleRun)', async () => {
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', audience: 'all', created_at: TICK - 86_400_000 }],
      subscribers: [11],
    });
    expect(await _testOnly.processSchedules(env, TICK)).toBe(1);
    expect(await _testOnly.processSchedules(env, TICK + 5_000)).toBe(0);
    expect(db.__sends.filter((r: SendRow) => r.method === 'schedule_run')).toHaveLength(1);
  });

  it('audience single — resume-строка на конкретного пользователя', async () => {
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: 'every:5', audience: 'single', audience_user: 77, created_at: TICK - 600_000, last_run_at: TICK - 600_000 }],
    });
    expect(await _testOnly.processSchedules(env, TICK)).toBe(1);
    const rows = db.__sends.filter((r: SendRow) => r.method === 'resume');
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(77);
    expect(JSON.parse(rows[0].payload_json).resumeBlockId).toBe('flow1');
  });

  it('audience tag — получатели по тегу', async () => {
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: 'every:5', audience: 'tag', audience_tag: 'vip', created_at: TICK - 600_000, last_run_at: TICK - 600_000 }],
      tags: [{ user_id: 5, tag: 'vip' }, { user_id: 6, tag: 'other' }],
    });
    await _testOnly.processSchedules(env, TICK);
    const rows = db.__sends.filter((r: SendRow) => r.method === 'schedule_run');
    expect(JSON.parse(rows[0].payload_json).users).toEqual([5]);
  });

  it('блок исчез из сборки — расписание глушится (enabled=0 + schedule.disabled.*), не error-loop', async () => {
    const noSch: Scenario = { version: 1, start: 's', blocks: { s: { id: 's', type: 'start', params: {}, next: 'e' }, e: { id: 'e', type: 'end', params: {} } } } as any;
    const { db, env } = schedEnv({
      scenario: noSch,
      schedules: [{ block_id: 'sch', cron_expr: 'every:5', audience: 'all', created_at: TICK - 600_000, last_run_at: TICK - 600_000 }],
      subscribers: [11],
    });
    await _testOnly.processSchedules(env, TICK);
    expect(db.__schedules[0].enabled).toBe(0);
    expect(db.__logs.some((l: any) => l.event === 'schedule.disabled.sch')).toBe(true);
    expect(db.__sends).toHaveLength(0);
  });

  it('потолок получателей за тик — не больше MAX_SCHEDULE_RECIPIENTS_PER_TICK', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => 1000 + i);
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', audience: 'all', created_at: TICK - 86_400_000 }],
      subscribers: many,
    });
    await _testOnly.processSchedules(env, TICK);
    const rows = db.__sends.filter((r: SendRow) => r.method === 'schedule_run');
    const total = rows.reduce((s: number, r: SendRow) => s + JSON.parse(r.payload_json).users.length, 0);
    expect(total).toBe(2000);
  });

  it('сквозной worker.scheduled: расписание → schedule_run → sendMessage каждому подписчику', async () => {
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', audience: 'all', created_at: TICK - 86_400_000 }],
      subscribers: [11, 22],
    });
    const res = await (worker as any).scheduled({ scheduledTime: TICK }, env);
    const text = await res.text();
    expect(text).toContain('schedules 1');
    // Пачка schedule_run обработана в этом же тике: по сообщению каждому.
    const sent = tgCalls.filter((c) => c.method === 'sendMessage' && c.payload.text === 'доброе утро');
    expect(sent.map((c) => c.payload.chat_id).sort()).toEqual([11, 22]);
    expect(db.__sends.filter((r: SendRow) => r.method === 'schedule_run')).toHaveLength(0);
  });

  it('новый подписчик не получает прошлые запуски (backfill исключён)', async () => {
    // created_at = сейчас, 10:00 уже прошло сегодня → в эту минуту не fire'ит.
    const createdAt = Date.UTC(2026, 8, 30, 8, 0, 0); // 11:00 MSK
    const { db, env } = schedEnv({
      schedules: [{ cron_expr: '0 10 * * *', timezone: 'Europe/Moscow', audience: 'all', created_at: createdAt, last_run_at: null }],
      subscribers: [11],
    });
    expect(await _testOnly.processSchedules(env, createdAt + 60_000)).toBe(0);
    expect(db.__sends).toHaveLength(0);
    // На следующее утро — сработает.
    const nextDay = Date.UTC(2026, 9, 1, 7, 0, 0);
    expect(await _testOnly.processSchedules(env, nextDay)).toBe(1);
  });
});
