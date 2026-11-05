// Фиксы F-035/F-036/F-037/F-040 (аудит 18.10, задачи 1a/1b/1c):
// - boot отдаёт схему, отфильтрованную по visible_when НА СЕРВЕРЕ (1a);
// - /m/api query/action сверяют table с whitelist видимых элементов (1a);
// - /m/api insert/update пишут значения через sanitizeData (F-040);
// - PUT /api/miniapps/:id санитизирует draft (1b, S3-04);
// - GET /m/:botId/:slug вставляет бут-скрипт { botId, slug } в маркер MINI_BOOT,
//   SPA стартует через api('boot') (1c, F-035).
// Harness — копия tmp/audit-2026-10-18/s2/repro/harness.ts с путями tests/.
import { describe, it, expect } from 'vitest';
import { encryptToken } from '../worker/src/crypto';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');
const BOT_TOKEN = '123456789:AAF-test-token-miniapp';
const BOT_ID = 'bot-s2';
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
    user: JSON.stringify({ id: userId, first_name: 'Тест', username: 'audit_s2' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  });
}

const TOKEN_ENC = await encryptToken(BOT_TOKEN, ENC_KEY);

// Публичная витрина (products) + «админка» (orders, видна только с тегом admin).
const APP = {
  version: 1,
  tabbar: { enabled: false, tabs: [] },
  pages: [
    {
      id: 'p1', name: 'Витрина', bg: '#fff',
      els: [{ id: 'e1', type: 'grid', x: 0, y: 0, w: 350, h: 300, style: {}, props: { table: 'products', titleColumn: 'title', priceColumn: 'price' }, action: { id: 'none' } }],
    },
    {
      id: 'admin', name: 'Админка', bg: '#fff',
      els: [{
        id: 'e2', type: 'record_form', x: 0, y: 0, w: 320, h: 300, style: {},
        props: { table: 'orders', searchColumn: 'phone', editColumns: ['phone', 'note'] },
        action: { id: 'none' },
        visible_when: { left: 'tag:admin', op: 'not_empty', right: '' },
      }],
    },
  ],
  startPageId: 'p1',
};

type Row = Record<string, unknown>;

function makeEnv(publishedApp: unknown = APP, accessRule: unknown = { kind: 'all' }, tags: string[] = []) {
  const state = {
    items: [
      { id: 'prod-1', collection_id: 'col-products', bot_id: BOT_ID, user_id: null, data_json: JSON.stringify({ title: 'Маникюр', price: '1000' }), search_text: 'маникюр 1000', created_at: 1, updated_at: 1 },
      { id: 'ord-1', collection_id: 'col-orders', bot_id: BOT_ID, user_id: 7, data_json: JSON.stringify({ phone: '+79990000000', note: 'секрет клиента' }), search_text: '+79990000000 секрет клиента', created_at: 2, updated_at: 2 },
    ] as Row[],
    deletedIds: [] as string[],
    logs: [] as string[],
  };
  const miniApps: Row[] = [{
    id: 'mini-1', bot_id: BOT_ID, owner_id: 'ilya', name: 'AUDIT-S2', slug: 'shop',
    access_rule_json: JSON.stringify(accessRule),
    draft_json: JSON.stringify(publishedApp),
    published_json: JSON.stringify(publishedApp),
    created_at: 1, updated_at: 1,
  }];
  const bots: Row[] = [{ id: BOT_ID, owner_id: 'ilya', name: 'test', token_enc: TOKEN_ENC, webhook_secret: 'ws', bot_username: 'testbot', has_referral: 0 }];
  const collections: Row[] = [
    { id: 'col-products', bot_id: BOT_ID, name: 'products', fields_json: '["title","price"]', created_at: 1 },
    { id: 'col-orders', bot_id: BOT_ID, name: 'orders', fields_json: '["phone","note"]', created_at: 2 },
  ];

  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      const stmt = {
        _args: [] as unknown[],
        bind(...args: unknown[]) { this._args = args; return stmt; },
        async first() {
          if (s.includes('FROM mini_apps') && s.includes('slug = ?')) return miniApps.find((r) => r.bot_id === stmt._args[0] && r.slug === stmt._args[1]) ?? null;
          if (s.includes('FROM mini_apps')) return miniApps.find((r) => r.id === stmt._args[0]) ?? null;
          if (s.includes('FROM bots')) return bots.find((r) => r.id === stmt._args[0]) ?? null;
          if (s.includes('FROM sessions')) return null;
          if (s.includes('FROM user_tags')) return null;
          if (s.includes('COUNT(*) AS n FROM collection_items')) {
            return { n: state.items.filter((i) => i.collection_id === stmt._args[0] && i.bot_id === stmt._args[1]).length };
          }
          if (s.includes('FROM collection_items') && s.includes('AND id = ?')) {
            return state.items.find((i) => i.collection_id === stmt._args[0] && i.bot_id === stmt._args[1] && i.id === stmt._args[2]) ?? null;
          }
          return null;
        },
        async all() {
          if (s.includes('FROM user_tags')) return { results: tags.map((t) => ({ tag: t })), success: true };
          if (s.includes('FROM collections')) return { results: collections.filter((c) => c.bot_id === stmt._args[0]), success: true };
          if (s.includes('FROM collection_items')) {
            const cid = stmt._args[0];
            let rows = state.items.filter((i) => i.collection_id === cid && i.bot_id === stmt._args[1]);
            if (s.includes('search_text LIKE')) {
              const needle = String(stmt._args[2] ?? '').toLowerCase();
              rows = rows.filter((r) => String(r.search_text ?? '').includes(needle.replace(/(^%|%$)/g, '')));
            }
            return { results: rows, success: true };
          }
          return { results: [], success: true };
        },
        async run() {
          if (s.startsWith('UPDATE mini_apps')) {
            // updateMiniAppDraft (db.ts:2693): bind (draftJson, now, name?, id)
            const row = miniApps.find((r) => r.id === stmt._args[stmt._args.length - 1]);
            if (row) row.draft_json = stmt._args[0];
            return { success: true };
          }
          if (s.startsWith('INSERT INTO logs')) { state.logs.push(String(stmt._args[2])); return { success: true }; }
          if (s.startsWith('INSERT INTO collection_items')) {
            const [id, collection_id, bot_id, user_id, data_json, created_at, updated_at, search_text] = stmt._args as unknown[];
            state.items.push({ id, collection_id, bot_id, user_id, data_json, created_at, updated_at, search_text });
            return { success: true };
          }
          if (s.startsWith('UPDATE collection_items SET data_json')) {
            const [data_json, , search_text, id, bot_id] = stmt._args as unknown[];
            const row = state.items.find((i) => i.id === id && i.bot_id === bot_id);
            if (row) { row.data_json = data_json; row.search_text = search_text; }
            return { success: true };
          }
          if (s.startsWith('DELETE FROM collection_items')) {
            const [id, bot_id] = stmt._args as unknown[];
            const ix = state.items.findIndex((i) => i.id === id && i.bot_id === bot_id);
            if (ix >= 0) state.items.splice(ix, 1);
            state.deletedIds.push(String(id));
            return { success: true };
          }
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) { for (const st of stmts) await (st as any).run?.(); return []; },
  };
  const kvStore = new Map<string, string>();
  kvStore.set('sess:tok-owner', JSON.stringify({ id: 'ilya', login: 'ilya', exp: Date.now() + 60_000 }));
  const kv = {
    async get(k: string) { return kvStore.get(k) ?? null; },
    async put(k: string, v: string) { kvStore.set(k, v); },
    async delete(k: string) { kvStore.delete(k); },
  };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'production' } as any;
  return { env, state, miniApps, collections };
}

async function call(env: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`https://bots.example${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await (await import('../worker/src/index')).default.fetch(req, env, {});
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
}

const H = (initData: string) => ({ 'x-telegram-init-data': initData });

describe('F-036 (1a): boot отдаёт только видимые элементы', () => {
  it('юзер БЕЗ тега admin не видит админский record_form в схеме', async () => {
    const { env } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/boot`, {}, H(init));
    expect(res.status).toBe(200);
    const admin = res.data.app.pages.find((p: any) => p.id === 'admin');
    // Страница остаётся (структура), но скрытый элемент вырезан сервером.
    expect(admin.els).toHaveLength(0);
    const p1 = res.data.app.pages.find((p: any) => p.id === 'p1');
    expect(p1.els).toHaveLength(1);
  });

  it('юзер С тегом admin видит админский элемент', async () => {
    const { env } = makeEnv(APP, { kind: 'all' }, ['admin']);
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/boot`, {}, H(init));
    expect(res.status).toBe(200);
    const admin = res.data.app.pages.find((p: any) => p.id === 'admin');
    expect(admin.els).toHaveLength(1);
    expect(admin.els[0].props.table).toBe('orders');
  });
});

describe('F-036 (1a): query/action по whitelist таблиц', () => {
  it('query к НЕоткрытой таблице (orders без тега admin) — пусто', async () => {
    const { env, state } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/query`, { kind: 'rows', table: 'orders', limit: 50 }, H(init));
    expect(res.status).toBe(200);
    expect(res.data.rows).toHaveLength(0);
    // секрет клиента не ушёл
    expect(res.text).not.toContain('секрет клиента');
    expect(state.items.some((i) => i.id === 'ord-1')).toBe(true);
  });

  it('query к открытой таблице (products) работает', async () => {
    const { env } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/query`, { kind: 'rows', table: 'products', limit: 50 }, H(init));
    expect(res.status).toBe(200);
    expect(res.data.rows).toHaveLength(1);
    expect(res.data.rows[0].data.title).toBe('Маникюр');
  });

  it('query к orders С тегом admin — строки видны', async () => {
    const { env } = makeEnv(APP, { kind: 'all' }, ['admin']);
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/query`, { kind: 'rows', table: 'orders', limit: 50 }, H(init));
    expect(res.status).toBe(200);
    expect(res.data.rows).toHaveLength(1);
  });

  it('F3-202: фильтр op:in со склеенным списком (2+ чипа) находит обе строки', async () => {
    // Чипы SPA: buildQuery шлёт { column, op:'in', value: 'a,b' } — раньше
    // строгое равенство давало всегда пустой список.
    const { env } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/query`, {
      kind: 'rows', table: 'products', limit: 50,
      filters: [{ column: 'title', op: 'in', value: 'Маникюр,Педикюр' }],
    }, H(init));
    expect(res.status).toBe(200);
    expect(res.data.rows).toHaveLength(1);
    expect(res.data.rows[0].data.title).toBe('Маникюр');
  });

  it('F3-202: фильтр op:in с пустым списком — фильтр отбрасывается (все строки)', async () => {
    // values.join(',') от пустого набора чипов даст ',' после trim/filter —
    // пустой список, фильтр не должен вырезать все строки.
    const { env } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/query`, {
      kind: 'rows', table: 'products', limit: 50,
      filters: [{ column: 'title', op: 'in', value: ',' }],
    }, H(init));
    expect(res.status).toBe(200);
    expect(res.data.rows).toHaveLength(1);
  });

  it('F3-202: фильтр без op — прежнее строгое равенство', async () => {
    const { env } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/query`, {
      kind: 'rows', table: 'products', limit: 50,
      filters: [{ column: 'title', value: 'Маникюр' }],
    }, H(init));
    expect(res.status).toBe(200);
    expect(res.data.rows).toHaveLength(1);
  });

  it('action update чужой закрытой таблицы — 403, данные не меняются', async () => {
    const { env, state } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/action`, { kind: 'update', table: 'orders', itemId: 'ord-1', values: { note: 'взломано' } }, H(init));
    expect(res.status).toBe(403);
    const row = state.items.find((i) => i.id === 'ord-1');
    expect(String(row?.data_json)).toContain('секрет клиента');
  });

  it('action delete закрытой таблицы — 403, строка жива', async () => {
    const { env, state } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/action`, { kind: 'delete', table: 'orders', itemId: 'ord-1' }, H(init));
    expect(res.status).toBe(403);
    expect(state.deletedIds).toEqual([]);
    expect(state.items.some((i) => i.id === 'ord-1')).toBe(true);
  });

  it('action update открытой таблицы С тегом admin — авторизован (200)', async () => {
    // Примечание: фактическая мутация строки здесь не проверяется — update по
    // where={id} молча не работает из-за F-038 (задача 22a группы 2, вне этой
    // сессии). Проверяем только авторизационный контур: 403 → 200 с тегом.
    const { env } = makeEnv(APP, { kind: 'all' }, ['admin']);
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/action`, { kind: 'update', table: 'orders', itemId: 'ord-1', values: { note: 'обновлено' } }, H(init));
    expect(res.status).toBe(200);
  });
});

describe('F-040: insert/update через sanitizeData (поля схемы, размер)', () => {
  it('insert с мусорным ключом вне схемы — ключ отброшен', async () => {
    const { env, state } = makeEnv();
    const init = await freshInitData();
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/action`, { kind: 'insert', table: 'products', values: { title: 'Новый', junk: 'x'.repeat(3000) } }, H(init));
    expect(res.status).toBe(200);
    const added = state.items[state.items.length - 1];
    const data = JSON.parse(String(added.data_json));
    expect(data.title).toBe('Новый');
    expect('junk' in data).toBe(false);
  });

  it('insert с непустым значением по схеме, но без полей таблицы — 400 не создаёт мусор', async () => {
    const { env, state } = makeEnv();
    const init = await freshInitData();
    const before = state.items.length;
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/action`, { kind: 'insert', table: 'products', values: 'не объект' }, H(init));
    expect(res.status).toBe(400);
    expect(state.items.length).toBe(before);
  });
});

describe('F-035 (1c): GET /m/:botId/:slug вставляет бут-скрипт', () => {
  it('в HTML есть script id="mini-boot" с { botId, slug } и нет схемы', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', `/m/${BOT_ID}/shop`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<script id="mini-boot" type="application/json">');
    const m = res.text.match(/<script id="mini-boot" type="application\/json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const boot = JSON.parse(m![1]);
    expect(boot.botId).toBe(BOT_ID);
    expect(boot.slug).toBe('shop');
    // схема и ctx в HTML НЕ кладутся — только через boot-запрос с initData
    expect(boot.app).toBeUndefined();
    expect(boot.ctx).toBeUndefined();
    expect(res.text).not.toContain('секрет');
  });

  it('SPA-рантайм стартует через api(\'boot\')', async () => {
    const { SPA_HTML } = await import('../worker/src/miniapp/spa');
    expect(SPA_HTML).toContain("api('boot', {}).then(startApp)");
    expect(SPA_HTML).toContain('<!--MINI_BOOT-->');
  });
});

describe('F-037/S3-04 (1b): PUT draft санитизирует richtext', () => {
  it('опасный html в draft вычищается при сохранении', async () => {
    const app = JSON.parse(JSON.stringify(APP));
    app.pages[0].els.push({ id: 'rt', type: 'richtext', x: 0, y: 400, w: 300, h: 100, style: {}, props: { html: '<b/onclick=alert(1)>жирный</b><a href="javascript:alert(2)">ссылка</a>' }, action: { id: 'none' } });
    const { env, miniApps } = makeEnv(APP);
    const res = await call(env, 'PUT', '/api/miniapps/mini-1', { draft: app }, { authorization: 'Bearer tok-owner' });
    expect(res.status).toBe(200);
    const saved = JSON.parse(String(miniApps[0].draft_json));
    const rt = saved.pages[0].els.find((e: any) => e.id === 'rt');
    expect(rt.props.html).not.toContain('onclick');
    expect(rt.props.html).not.toContain('javascript');
    expect(rt.props.html).toContain('жирный');
  });
});
