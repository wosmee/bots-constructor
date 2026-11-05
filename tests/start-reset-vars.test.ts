// F-022 (аудит 2026-10-18): /start-сброс vars раньше удалял ВСЕ переменные
// кроме ref.* — включая служебный __chat (память последнего чата), выставленный
// в том же проходе. Отложенные задачи того же /start-прогона (delay, wait с
// таймаутом, budget-resume) возобновлялись без chat_id, Telegram молча
// отклонял отправку — пользователь не получал отложенное сообщение.
// После фикса служебные '__'-переменные переживают сброс выборочно: память и
// кэши (__chat, __menu, __bot_msg, __channel.*, __broadcast_count) остаются,
// а состояние потока управления (__loop.*, __wait.*, __http_page) чистится,
// чтобы stale-значения не протекли в свежий прогон.
//
// Движковая часть адаптирована из repro tmp/audit-2026-10-18/s1 (секция H4);
// воркерная — сквозная проверка персиста: вебхук /:botId → /start → wait,
// __chat обязан попасть в записанную сессию и в payload задачи wait_timeout.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEngine, type SessionState } from '../worker/src/engine';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import {
  CHAT_FALLBACK_VAR,
  loopVar,
  waitVar,
  HTTP_PAGE_VAR,
  type Scenario,
} from '../shared/types';

const msgUpdate = (text: string, chatId = 77) => ({
  message: { chat: { id: chatId }, from: { id: chatId }, message_id: 5, text },
});

function run(
  scenario: Scenario,
  update: any,
  session: SessionState = { currentBlock: null, vars: {} },
  startBlockId?: string
) {
  return runEngine({ scenario, update, session, startBlockId, botUsername: 'testbot' } as any);
}

const sc = (blocks: Scenario['blocks'], start = 's'): Scenario => ({ version: 1, start, blocks } as Scenario);

describe('F-022: /start-сброс сохраняет служебную память', () => {
  it('__chat и ref.* переживают сброс, пользовательские vars чистятся', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'привет' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'), {
      currentBlock: null,
      vars: {
        name: 'Аня',
        city: 'Москва',
        'ref.link': 'https://t.me/x?start=ref_1',
        'ref.count': 3,
        __menu: JSON.stringify({ buttons: [{ label: 'Меню', value: 'menu' }], branches: {} }),
      },
    });
    // __chat выставлен живым апдейтом ДО сброса — и пережил его.
    expect(res.vars[CHAT_FALLBACK_VAR]).toBe(77);
    expect(res.vars['ref.link']).toBe('https://t.me/x?start=ref_1');
    expect(res.vars['ref.count']).toBe(3);
    // Постоянная reply-клавиатура остаётся на экране пользователя — __menu живёт.
    expect(res.vars['__menu']).toBeTruthy();
    // Пользовательские переменные сброшены; last_input выставлен заново.
    expect(res.vars['name']).toBeUndefined();
    expect(res.vars['city']).toBeUndefined();
    expect(res.vars['last_input']).toBe('/start');
  });

  it('состояние потока управления (__loop.*, __wait.*, __http_page) НЕ переживает сброс', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'заново' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const stale = {
      currentBlock: null,
      vars: {
        [loopVar('oldloop')]: { items: ['a', 'b'], index: 1 },
        [waitVar('oldwait')]: 'nonce-1',
        [HTTP_PAGE_VAR]: { url: 'https://api.example/items', page: 3, cursor: 'c3' },
        [CHAT_FALLBACK_VAR]: 11,
      } as Record<string, unknown>,
    };
    const res = await run(scn, msgUpdate('/start'), stale);
    // Иначе foreach продолжил бы старую итерацию, аренда ожидания осталась бы
    // снятой не до конца, а пагинация возобновила бы прежний обход.
    expect(res.vars[loopVar('oldloop')]).toBeUndefined();
    expect(res.vars[waitVar('oldwait')]).toBeUndefined();
    expect(res.vars[HTTP_PAGE_VAR]).toBeUndefined();
    // Память чата при этом перезаписана свежим апдейтом.
    expect(res.vars[CHAT_FALLBACK_VAR]).toBe(77);
  });

  it('/start → delay: vars отложенного возобновления содержат __chat, resume уходит в тот же чат', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: { id: 'd', type: 'action', params: { actionKind: 'delay', seconds: 30 }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'после паузы' } },
    });
    const res = await run(scn, msgUpdate('/start', 55), { currentBlock: null, vars: { old: 'x' } });
    const delay = res.outs.find((o) => o.method === 'delay');
    expect(delay).toBeTruthy();
    const delayVars = delay!.payload.vars as Record<string, unknown>;
    expect(delayVars[CHAT_FALLBACK_VAR]).toBe(55);
    expect(delayVars['old']).toBeUndefined();
    // Возобновление БЕЗ апдейта: чат берётся из __chat, сообщение доставляется.
    const r2 = await run(scn, {}, { currentBlock: null, vars: delayVars }, 'm');
    const sent = r2.outs.find((o) => o.method === 'sendMessage');
    expect(sent).toBeTruthy();
    expect(sent!.payload.chat_id).toBe(55);
  });

  it('/start → wait с таймаутом: аренда __wait и __chat остаются в vars прогона', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: { id: 'w', type: 'wait', params: { seconds: 30, prompt: 'жду ответ' }, branches: { reply: 'r', timeout: 't' } },
      r: { id: 'r', type: 'message', params: { text: 'ответил' } },
      t: { id: 't', type: 'message', params: { text: 'таймаут' } },
    });
    const res = await run(scn, msgUpdate('/start', 55), { currentBlock: null, vars: { junk: 1 } });
    expect(res.currentBlock).toBe('w');
    expect(res.vars[CHAT_FALLBACK_VAR]).toBe(55);
    // Аренда ожидания создана ПОСЛЕ сброса — она нужна крону для отмены stale-задачи.
    expect(res.vars[waitVar('w')]).toBeTruthy();
    expect(res.vars['junk']).toBeUndefined();
    const waitOut = res.outs.find((o) => o.method === 'wait');
    expect(waitOut).toBeTruthy();
    expect((waitOut!.payload.vars as Record<string, unknown>)[CHAT_FALLBACK_VAR]).toBe(55);
    expect(waitOut!.payload.chatId).toBe(55);
  });
});

// ---------------- сквозной персист через вебхук /:botId ----------------

const BOT_ID = 'bot-f022';
const SECRET = 'whsec-f022';
const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function waitScenario(): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: { id: 'w', type: 'wait', params: { seconds: 30, prompt: 'жду' }, branches: { reply: 'r', timeout: 't' } },
      r: { id: 'r', type: 'message', params: { text: 'ответил' } },
      t: { id: 't', type: 'message', params: { text: 'таймаут' } },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

// FakeDb по образцу repro (tmp/audit-2026-10-18/s1): prepare и batch — СОСЕДНИЕ
// методы db, batch реально исполняет statement'ы, все bind-аргументы пишутся
// в written (§19/§28).
function makeEnv(scenario: Scenario) {
  const flow = JSON.stringify(scenario);
  const written: { sql: string; args: unknown[] }[] = [];
  const db: any = {
    written,
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async first<T>() {
          if (sql.includes('FROM bots')) {
            return {
              id: BOT_ID, owner_id: 'u1', name: 'F022 Bot',
              token_enc: await encryptToken('123:TESTTOKEN', KEY),
              webhook_secret: SECRET, active: 1, created_at: 1,
              bot_username: 'f022bot', has_referral: 0, published_version: 1,
            } as unknown as T;
          }
          if (sql.includes('FROM sessions')) return null;
          if (sql.includes('flow_json')) return { flow_json: flow, version: 1, has_referral: 0 } as T;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() { written.push({ sql, args: stmt.args }); return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      for (const s of stmts ?? []) await s?.run?.();
      return [];
    },
  };
  const kvStore = new Map<string, string>();
  const kv = {
    async get(k: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string) { kvStore.set(k, v); },
    async delete(k: string) { kvStore.delete(k); },
  };
  return { env: { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ENVIRONMENT: 'dev' } as any, db };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      void init;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('F-022 (вебхук): записанная сессия и задача wait_timeout содержат __chat', () => {
  it('после /start в vars_json сессии есть __chat, пользовательские vars сброшены', async () => {
    const { env, db } = makeEnv(waitScenario());
    const update = {
      update_id: 9001,
      message: { message_id: 1, date: 1, chat: { id: 55, type: 'private' }, from: { id: 55, is_bot: false }, text: '/start' },
    };
    const req = new Request(`https://test.example/${BOT_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify(update),
    });
    const res = await (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
    expect(res.status).toBe(200);

    // Персист сессии идёт батчем sessionAndLogStmts: INSERT INTO sessions,
    // bind (bot_id, user_id, current_block, vars_json, ...).
    const sessionWrites = db.written.filter((w: any) => w.sql.includes('INSERT INTO sessions'));
    expect(sessionWrites.length).toBeGreaterThan(0);
    const vars = JSON.parse(String(sessionWrites[sessionWrites.length - 1].args[3])) as Record<string, unknown>;
    expect(vars[CHAT_FALLBACK_VAR]).toBe(55);
    expect(vars[waitVar('w')]).toBeTruthy();
    expect(sessionWrites[sessionWrites.length - 1].args[2]).toBe('w');

    // Задача wait_timeout в scheduled_sends несёт те же vars — крон возобновит
    // сценарий по ветке timeout и отправит сообщение в чат 55.
    const waits = db.written.filter((w: any) => w.sql.includes('INSERT INTO scheduled_sends') && w.args[3] === 'wait_timeout');
    expect(waits.length).toBe(1);
    const payload = JSON.parse(String(waits[0].args[4])) as { vars?: Record<string, unknown>; blockId?: string; timeoutTarget?: string };
    expect(payload.vars?.[CHAT_FALLBACK_VAR]).toBe(55);
    expect(payload.blockId).toBe('w');
    expect(payload.timeoutTarget).toBe('t');
  });
});
