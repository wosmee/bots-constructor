// Волна 2 аудита 2026-10-18, вебхук /:botId:
//  - F-002: персист сессии через upsertSessionCas — два параллельных апдейта
//    одного юзера сохраняют переменные обоих (merged-ветка), а не затирают;
//  - F-014: тело апдейта > 1 МБ → 200 {ok:true} БЕЗ парсинга + warn-лог;
//  - F-041: pre_checkout_query с mini-payload сверяет сумму с pending-строкой
//    (расхождение → ok=false с русской причиной); successful_payment mini:…
//    идемпотентно отмечает paid и НЕ возобновляет сценарий.
// Harness — паттерн tests/worker-callback.test.ts / webhook-audit-fixes.test.ts:
// фейковый D1 с честным хранилищем sessions, batch СОСЕДНИЙ prepare (§18/19).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import type { Scenario } from '../shared/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BOT_ID = 'bot-w2wh';
const SECRET = 'whsec-w2';

function setvarScenario(varName: string): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'v' },
      v: { id: 'v', type: 'setvar', params: { assignVar: varName, expr: '1' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

interface SessionRow { current_block: string | null; vars_json: string; updated_at: number; first_name?: string | null; username?: string | null }

function makeEnv(scenario: Scenario, opts: { session?: SessionRow | null; miniPayments?: Row[] } = {}) {
  const flow = JSON.stringify(scenario);
  const sessions = new Map<string, SessionRow>();
  if (opts.session) sessions.set(`${BOT_ID}:7`, { ...opts.session });
  const payments: Row[] = opts.miniPayments ?? [];
  const written: Array<{ sql: string; args: unknown[] }> = [];
  const db: any = {
    written,
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async first<T>() {
          if (s.includes('FROM bots')) {
            return {
              id: BOT_ID, owner_id: 'u1', name: 'W2 Bot',
              token_enc: await encryptToken('123:TESTTOKEN', KEY),
              webhook_secret: SECRET, active: 1, created_at: 1,
              bot_username: 'w2bot', has_referral: 0, published_version: 1,
            } as unknown as T;
          }
          if (s === 'SELECT current_block, vars_json, updated_at FROM sessions WHERE bot_id = ? AND user_id = ?')
            return (sessions.get(`${stmt.args[0]}:${stmt.args[1]}`) ?? null) as T;
          if (s === 'SELECT current_block, vars_json FROM sessions WHERE bot_id = ? AND user_id = ?')
            return (sessions.get(`${stmt.args[0]}:${stmt.args[1]}`) ?? null) as T;
          if (s === 'SELECT vars_json, updated_at FROM sessions WHERE bot_id = ? AND user_id = ?')
            return (sessions.get(`${stmt.args[0]}:${stmt.args[1]}`) ?? null) as T;
          if (s === 'SELECT first_name, username FROM sessions WHERE bot_id = ? AND user_id = ?') {
            const row = sessions.get(`${stmt.args[0]}:${stmt.args[1]}`);
            return (row ? { first_name: row.first_name ?? null, username: row.username ?? null } : null) as T;
          }
          if (s.includes('FROM mini_payments WHERE payload = ?'))
            return (payments.find((p) => p.payload === stmt.args[0]) ?? null) as T;
          if (s.includes('flow_json')) return { flow_json: flow, version: 1, has_referral: 0 } as T;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() {
          written.push({ sql: s, args: stmt.args });
          // upsertSessionCas: CAS-ветка с условием на updated_at.
          if (s === 'UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ? WHERE bot_id = ? AND user_id = ? AND updated_at = ?') {
            const key = `${stmt.args[4]}:${stmt.args[5]}`;
            const row = sessions.get(key);
            if (!row || row.updated_at !== Number(stmt.args[6])) return { meta: { changes: 0 } };
            sessions.set(key, { ...row, current_block: stmt.args[0] as string | null, vars_json: String(stmt.args[1]), updated_at: Number(stmt.args[2]) });
            return { meta: { changes: 1 } };
          }
          // merged-ветка (тот же UPDATE без updated_at).
          if (s === 'UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ? WHERE bot_id = ? AND user_id = ?') {
            const key = `${stmt.args[4]}:${stmt.args[5]}`;
            const row = sessions.get(key)!;
            sessions.set(key, { ...row, current_block: stmt.args[0] as string | null, vars_json: String(stmt.args[1]), updated_at: Number(stmt.args[2]) });
            return { meta: { changes: 1 } };
          }
          if (s.startsWith('INSERT INTO sessions')) {
            const key = `${stmt.args[0]}:${stmt.args[1]}`;
            sessions.set(key, { current_block: stmt.args[2] as string | null, vars_json: String(stmt.args[3]), updated_at: Number(stmt.args[4]), first_name: stmt.args[5] as string | null, username: stmt.args[6] as string | null });
            return { meta: { changes: 1 } };
          }
          // профильный UPDATE персиста (после CAS).
          if (s.startsWith('UPDATE sessions SET first_name = COALESCE')) {
            const key = `${stmt.args[2]}:${stmt.args[3]}`;
            const row = sessions.get(key);
            if (row) {
              if (stmt.args[0] != null) row.first_name = String(stmt.args[0]);
              if (stmt.args[1] != null) row.username = String(stmt.args[1]);
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          // markMiniPaymentPaid: идемпотентный UPDATE.
          if (s.startsWith("UPDATE mini_payments SET status = 'paid'")) {
            const row = payments.find((p) => p.payload === stmt.args[2] && p.status !== 'paid' && p.charge_id == null);
            if (!row) return { meta: { changes: 0 } };
            row.status = 'paid';
            row.charge_id = String(stmt.args[0]);
            row.paid_at = Number(stmt.args[1]);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) {
      for (const x of stmts) await x?.run?.();
      return [];
    },
    __sessions: sessions,
    __payments: payments,
  };
  const kvStore = new Map<string, string>();
  const kv = {
    async get(k: string) {
      if (k === BOT_ID) return SECRET;
      return kvStore.get(k) ?? null;
    },
    async put(k: string, v: string) { kvStore.set(k, v); },
    async delete(k: string) { kvStore.delete(k); },
  };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ENVIRONMENT: 'production' } as any;
  return { env, db, kvStore };
}

type Row = Record<string, any>;

const tgCalls: Array<{ method: string; body: any }> = [];
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

async function postUpdate(env: any, update: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`https://test.example/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET, ...headers },
    body: typeof update === 'string' ? update : JSON.stringify(update),
  });
  return (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } }) as Promise<Response>;
}

function msgUpdate(id: number, text: string) {
  return {
    update_id: id,
    message: { message_id: id, date: 1, chat: { id: 7, type: 'private' }, from: { id: 7, is_bot: false, first_name: 'Т' }, text },
  };
}

describe('F-002: CAS-персист вебхука', () => {
  it('параллельная запись между чтением и персистом: переменные обоих сохраняются (merged)', async () => {
    // Базовое чтение видит updated_at=1000, vars { shared: 'base' }.
    const base: SessionRow = { current_block: null, vars_json: JSON.stringify({ shared: 'base' }), updated_at: 1000 };
    const { env, db } = makeEnv(setvarScenario('ignored'), { session: base });

    // Имитация второго изолята: СРАЗУ после базового чтения (getSessionCas)
    // «параллельный» запрос пишет свою переменную и сдвигает updated_at.
    // Наш персист в конце запроса увидит устаревшую метку — CAS не сработает
    // и включится merged-ветка: чужой 'other' не затирается, наш diff
    // (last_input) накладывается поверх.
    let raced = false;
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = realPrepare(sql);
      if (sql.includes('current_block, vars_json, updated_at FROM sessions')) {
        const inner = stmt.first.bind(stmt);
        stmt.first = async () => {
          const row = await inner();
          if (!raced) {
            raced = true;
            db.__sessions.set(`${BOT_ID}:7`, {
              current_block: null,
              vars_json: JSON.stringify({ shared: 'base', other: 'x' }),
              updated_at: 2000,
            });
          }
          return row;
        };
      }
      return stmt;
    };

    const res = await postUpdate(env, msgUpdate(102, '/start'));
    expect(res.status).toBe(200);
    expect(raced).toBe(true);
    const vars = JSON.parse(db.__sessions.get(`${BOT_ID}:7`).vars_json);
    // Наша переменная записана…
    expect(vars.last_input).toBe('/start');
    // …чужая параллельная правка сохранена merged-веткой, не затёрта.
    expect(vars.other).toBe('x');
    // Персист прошёл именно merged-веткой (UPDATE без условия updated_at).
    expect(db.written.some((w: any) => w.sql === 'UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ? WHERE bot_id = ? AND user_id = ?')).toBe(true);
  });

  it('обычный последовательный апдейт пишет сессию CAS-веткой', async () => {
    const { env, db } = makeEnv(setvarScenario('ignored'));
    const res = await postUpdate(env, msgUpdate(201, '/start'));
    expect(res.status).toBe(200);
    const row = db.__sessions.get(`${BOT_ID}:7`);
    expect(row).toBeTruthy();
    expect(JSON.parse(row.vars_json).last_input).toBe('/start');
  });

  it('существующая сессия: персист идёт CAS-веткой (UPDATE … AND updated_at = ?)', async () => {
    const base: SessionRow = { current_block: null, vars_json: '{}', updated_at: 1000 };
    const { env, db } = makeEnv(setvarScenario('ignored'), { session: base });
    const res = await postUpdate(env, msgUpdate(211, '/start'));
    expect(res.status).toBe(200);
    expect(db.written.some((w: any) => w.sql.includes('AND updated_at = ?'))).toBe(true);
  });

  it('профиль (first_name) из апдейта доезжает до сессии', async () => {
    const { env, db } = makeEnv(setvarScenario('ignored'));
    await postUpdate(env, msgUpdate(202, '/start'));
    expect(db.__sessions.get(`${BOT_ID}:7`).first_name).toBe('Т');
  });
});

describe('F-014: лимит тела вебхука', () => {
  it('content-length > 1 МБ → 200 {ok:true} без парсинга, warn-лог', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, db } = makeEnv(setvarScenario('ignored'));
    const huge = JSON.stringify({ update_id: 1, message: { text: 'x'.repeat(1_200_000) } });
    const res = await postUpdate(env, huge);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('oversized body'))).toBe(true);
    // Сценарий не исполнялся: ни отправок, ни записи сессии.
    expect(tgCalls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
    expect(db.__sessions.size).toBe(0);
    warnSpy.mockRestore();
  });

  it('обычное тело проходит как раньше', async () => {
    const { env } = makeEnv(setvarScenario('ignored'));
    const res = await postUpdate(env, msgUpdate(301, '/start'));
    expect(res.status).toBe(200);
  });
});

describe('F-025/F-026: причина 400 от Telegram в observability', () => {
  it('400 на sendMessage: send.error в логах + description в console.warn', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, _init: any) => {
      const u = String(url);
      if (u.includes('api.telegram.org/bot') && u.endsWith('sendMessage')) {
        return new Response(
          JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message is too long' }),
          { status: 400 }
        );
      }
      if (u.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Сценарий с message-блоком: именно его sendMessage получит 400.
    const msgScenario: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'm' },
        m: { id: 'm', type: 'message', params: { text: 'очень длинный текст' }, next: 'e' },
        e: { id: 'e', type: 'end', params: {} },
      },
    } as Scenario;
    const { env, db } = makeEnv(msgScenario);
    const res = await postUpdate(env, msgUpdate(801, '/start'));
    expect(res.status).toBe(200);
    // Событие send.error записано в logs (схема таблицы не менялась).
    expect(db.written.some((w: any) => w.sql.includes('INSERT INTO logs') && String(w.args[2]) === 'send.error')).toBe(true);
    // Причина (description) — в observability-логе.
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warns).toContain('message is too long');
    warnSpy.mockRestore();
  });
});

describe('F-041: mini-платёж в вебхуке', () => {
  function pcqUpdate(payload: string, amount: number, id = 401) {
    return {
      update_id: id,
      pre_checkout_query: {
        id: `pcq-${id}`, from: { id: 7 }, currency: 'XTR',
        total_amount: amount, invoice_payload: payload,
      },
    };
  }

  it('pre_checkout: сумма совпадает с pending-строкой → answerPreCheckoutQuery ok=true', async () => {
    const { env } = makeEnv(setvarScenario('ignored'), {
      miniPayments: [{ id: 'p1', bot_id: BOT_ID, app_id: 'm1', user_id: 7, amount: 100, payload: 'mini:p1', charge_id: null, status: 'pending', created_at: 1, paid_at: null }],
    });
    const res = await postUpdate(env, pcqUpdate('mini:p1', 100));
    expect(res.status).toBe(200);
    const ans = tgCalls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(ans).toBeTruthy();
    expect(ans!.body.ok).toBe(true);
    expect(ans!.body.error_message).toBeUndefined();
  });

  it('pre_checkout: расхождение суммы → ok=false с русским текстом, платёж отменён', async () => {
    const { env } = makeEnv(setvarScenario('ignored'), {
      miniPayments: [{ id: 'p1', bot_id: BOT_ID, app_id: 'm1', user_id: 7, amount: 100, payload: 'mini:p1', charge_id: null, status: 'pending', created_at: 1, paid_at: null }],
    });
    const res = await postUpdate(env, pcqUpdate('mini:p1', 1));
    expect(res.status).toBe(200);
    const ans = tgCalls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(ans!.body.ok).toBe(false);
    expect(String(ans!.body.error_message)).toMatch(/Не удалось подтвердить платёж/);
  });

  it('pre_checkout: неизвестный mini-payload → ok=false', async () => {
    const { env } = makeEnv(setvarScenario('ignored'), { miniPayments: [] });
    const res = await postUpdate(env, pcqUpdate('mini:ghost', 5));
    expect(res.status).toBe(200);
    const ans = tgCalls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(ans!.body.ok).toBe(false);
  });

  it('pre_checkout: сценарный payload (не mini:) — прежнее безусловное ok=true', async () => {
    const { env } = makeEnv(setvarScenario('ignored'));
    const res = await postUpdate(env, pcqUpdate('order-123', 999));
    expect(res.status).toBe(200);
    const ans = tgCalls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(ans!.body.ok).toBe(true);
  });

  it('successful_payment mini:… → статус paid + лог, сценарий НЕ возобновляется', async () => {
    const { env, db } = makeEnv(setvarScenario('ignored'), {
      miniPayments: [{ id: 'p1', bot_id: BOT_ID, app_id: 'm1', user_id: 7, amount: 100, payload: 'mini:p1', charge_id: null, status: 'pending', created_at: 1, paid_at: null }],
    });
    const update = {
      update_id: 501,
      message: {
        message_id: 1, date: 1, chat: { id: 7 }, from: { id: 7 },
        successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: 'mini:p1', telegram_payment_charge_id: 'chg-1', telegram_payment_provider_charge_id: 'prov-1' },
      },
    };
    const res = await postUpdate(env, update);
    expect(res.status).toBe(200);
    const row = db.__payments.find((p: Row) => p.id === 'p1');
    expect(row.status).toBe('paid');
    expect(row.charge_id).toBe('chg-1');
    // Лог mini.payment.paid.100 записан.
    expect(db.written.some((w: any) => w.sql.includes('INSERT INTO logs') && String(w.args[2]).startsWith('mini.payment.paid'))).toBe(true);
    // Сценарий не прогонялся: сессии нет, sendMessage не было.
    expect(db.__sessions.size).toBe(0);
    expect(tgCalls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  it('повтор successful_payment (ретрай Telegram) → без двойных эффектов', async () => {
    const { env, db } = makeEnv(setvarScenario('ignored'), {
      miniPayments: [{ id: 'p1', bot_id: BOT_ID, app_id: 'm1', user_id: 7, amount: 100, payload: 'mini:p1', charge_id: null, status: 'pending', created_at: 1, paid_at: null }],
    });
    const update = (id: number) => ({
      update_id: id,
      message: {
        message_id: id, date: 1, chat: { id: 7 }, from: { id: 7 },
        successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: 'mini:p1', telegram_payment_charge_id: 'chg-1', telegram_payment_provider_charge_id: 'prov-1' },
      },
    });
    await postUpdate(env, update(601));
    await postUpdate(env, update(602)); // ретрай с другим update_id (дедуп не мешает)
    const paidLogs = db.written.filter((w: any) => w.sql.includes('INSERT INTO logs') && String(w.args[2]).startsWith('mini.payment.paid'));
    const dupLogs = db.written.filter((w: any) => w.sql.includes('INSERT INTO logs') && String(w.args[2]) === 'mini.payment.duplicate');
    expect(paidLogs).toHaveLength(1);
    expect(dupLogs).toHaveLength(1);
  });

  it('successful_payment сценарного платежа идёт прежним путём (сценарий исполняется)', async () => {
    const { env, db } = makeEnv(setvarScenario('ignored'));
    const update = {
      update_id: 701,
      message: {
        message_id: 1, date: 1, chat: { id: 7 }, from: { id: 7 },
        successful_payment: { currency: 'RUB', total_amount: 150000, invoice_payload: 'order-123', telegram_payment_charge_id: 'chg-9', telegram_payment_provider_charge_id: 'prov-9' },
      },
    };
    const res = await postUpdate(env, update);
    expect(res.status).toBe(200);
    // Движок отработал: сессия записана (персист вебхука).
    expect(db.__sessions.size).toBe(1);
    // referral recordPayment вызван (INSERT INTO referral_payments).
    expect(db.written.some((w: any) => w.sql.includes('referral_payments'))).toBe(true);
  });
});
