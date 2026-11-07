// Мини-аппы: конструктор-API (фаза A). Реальный app.fetch с фейковым D1
// (маршрутизация по подстрокам SQL, паттерн tests/subflow-worker.test.ts).
// Покрытие: создание (slug-валидация, дубликат 409), список, черновик
// (битая схема 400), публикация (revision растёт), версии, откат новой
// ревизией, удаление; рантайм: HTML только для опубликованного, 404/401.
import { describe, expect, it } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');
const TOKEN_ENC = await encryptToken('123456:TEST-TOKEN', ENC_KEY);
const BOT_ID = 'bot-mini-1';
const ADMIN_KEY = 'test-admin-key';

type Row = Record<string, unknown>;

function makeEnv() {
  const miniApps: Row[] = [];
  const versions: Row[] = [];
  const bots: Row[] = [
    { id: BOT_ID, owner_id: 'ivan', name: 'test', token_enc: TOKEN_ENC, webhook_secret: 'ws', bot_username: 'testbot', has_referral: 0 },
    { id: 'admin-mini-bot', owner_id: 'admin', name: 'admin bot', token_enc: TOKEN_ENC, webhook_secret: 'ws', bot_username: 'adminbot', has_referral: 0 },
  ];
  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ');
      const stmt = {
        _args: [] as unknown[],
        bind(...args: unknown[]) { this._args = args; return stmt; },
        async first() {
          if (s.includes('FROM mini_apps') && s.includes('WHERE id = ?')) return miniApps.find((r) => r.id === stmt._args[0]) ?? null;
          if (s.includes('FROM mini_apps') && s.includes('slug = ?')) return miniApps.find((r) => r.bot_id === stmt._args[0] && r.slug === stmt._args[1]) ?? null;
          if (s.includes('FROM mini_app_versions') && s.includes('revision = ?')) return versions.find((r) => r.mini_app_id === stmt._args[0] && r.revision === stmt._args[1]) ?? null;
          if (s.includes('MAX(revision)')) {
            const revs = versions.filter((r) => r.mini_app_id === stmt._args[0]).map((r) => Number(r.revision));
            return { rev: revs.length ? Math.max(...revs) : 0 };
          }
          if (s.includes('FROM bots') && s.includes('WHERE id = ?')) return bots.find((r) => r.id === stmt._args[0]) ?? null;
          return null;
        },
        async all() {
          if (s.includes('FROM mini_apps m JOIN bots b')) {
            return {
              results: miniApps.filter((r) => r.owner_id === stmt._args[0]).map((r) => ({
                id: r.id, bot_id: r.bot_id, bot_name: 'test', bot_username: 'testbot', name: r.name,
                slug: r.slug, published: r.published_json != null ? 1 : 0, updated_at: r.updated_at,
              })),
              success: true,
            };
          }
          if (s.includes('FROM mini_apps') && s.includes('bot_id = ?')) return { results: miniApps.filter((r) => r.bot_id === stmt._args[0]), success: true };
          if (s.includes('FROM mini_app_versions')) return { results: versions.filter((r) => r.mini_app_id === stmt._args[0]).sort((a, b) => Number(b.revision) - Number(a.revision)), success: true };
          return { results: [], success: true };
        },
        async run() {
          if (s.startsWith('INSERT INTO mini_apps')) {
            const [id, bot_id, owner_id, name, slug, access_rule_json, draft_json, created_at, updated_at] = stmt._args as unknown[];
            if (miniApps.some((r) => r.bot_id === bot_id && r.slug === slug)) throw new Error('UNIQUE constraint failed');
            miniApps.push({ id, bot_id, owner_id, name, slug, access_rule_json, draft_json, published_json: null, created_at, updated_at });
            return { success: true };
          }
          if (s.startsWith('INSERT INTO mini_app_versions')) {
            const [id, mini_app_id, revision, published_json, created_at] = stmt._args as unknown[];
            versions.push({ id, mini_app_id, revision, published_json, created_at });
            return { success: true };
          }
          if (s.startsWith('UPDATE mini_apps SET') && s.includes('published_json')) {
            const row = miniApps.find((r) => r.id === stmt._args[stmt._args.length - 1]);
            if (row) { row.published_json = stmt._args[0]; row.updated_at = stmt._args[1]; }
            return { success: true };
          }
          if (s.startsWith('UPDATE mini_apps SET') && s.includes('draft_json')) {
            const row = miniApps.find((r) => r.id === stmt._args[stmt._args.length - 1]);
            if (row) {
              if (stmt._args.length === 4) {
                row.name = stmt._args[0];
                row.draft_json = stmt._args[1];
                row.updated_at = stmt._args[2];
              } else {
                row.draft_json = stmt._args[0];
                row.updated_at = stmt._args[1];
              }
            }
            return { success: true };
          }
          if (s.startsWith('DELETE FROM mini_app_versions')) {
            for (let i = versions.length - 1; i >= 0; i--) if (versions[i].mini_app_id === stmt._args[0]) versions.splice(i, 1);
            return { success: true };
          }
          if (s.startsWith('DELETE FROM mini_apps')) {
            for (let i = miniApps.length - 1; i >= 0; i--) if (miniApps[i].id === stmt._args[0]) miniApps.splice(i, 1);
            return { success: true };
          }
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) { for (const st of stmts) await (st as any).run?.(); return []; },
  };
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production' } as any;
  return { env, miniApps, versions };
}

async function call(env: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`https://bots.example${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await (worker as any).fetch(req, env, {});
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const validDraft = {
  version: 1,
  tabbar: { enabled: false, tabs: [] },
  pages: [{ id: 'p1', name: 'Главная', bg: '#fff', els: [] }],
  startPageId: 'p1',
};

describe('mini apps constructor API', () => {
  it('создаёт мини-апп и отдаёт его в списке', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'Витрина', slug: 'shop' });
    expect(created.status).toBe(201);
    expect(created.data.slug).toBe('shop');
    const list = await call(env, 'GET', `/api/bots/${BOT_ID}/miniapps`);
    expect(list.status).toBe(200);
    expect(list.data.miniapps).toHaveLength(1);
    expect(list.data.miniapps[0].published).toBe(false);
  });

  it('отдаёт общий список мини-аппов только текущего владельца с username бота', async () => {
    const { env } = makeEnv();
    await call(env, 'POST', '/api/bots/admin-mini-bot/miniapps', { name: 'Витрина', slug: 'shop' });
    const list = await call(env, 'GET', '/api/miniapps');
    expect(list.status).toBe(200);
    expect(list.data.miniapps).toEqual([expect.objectContaining({ bot_id: 'admin-mini-bot', bot_username: 'testbot', slug: 'shop', published: 0 })]);
  });

  it('отклоняет плохой slug и дубликат', async () => {
    const { env } = makeEnv();
    const bad = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'A!' });
    expect(bad.status).toBe(400);
    await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const dup = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'Y', slug: 'SHOP' });
    expect(dup.status).toBe(409);
  });

  it('черновик: битая схема 400, валидная сохраняется', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const id = created.data.id;
    const bad = await call(env, 'PUT', `/api/miniapps/${id}`, { draft: { version: 2 } });
    expect(bad.status).toBe(400);
    const ok = await call(env, 'PUT', `/api/miniapps/${id}`, { draft: validDraft, name: 'Новое имя' });
    expect(ok.status).toBe(200);
    const got = await call(env, 'GET', `/api/miniapps/${id}`);
    expect(got.data.name).toBe('Новое имя');
    expect(got.data.draft.pages[0].id).toBe('p1');
  });

  it('публикация растёт ревизией, откат пишет новую ревизию', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const id = created.data.id;
    const p1 = await call(env, 'POST', `/api/miniapps/${id}/publish`, { app: validDraft });
    expect(p1.status).toBe(200);
    expect(p1.data.revision).toBe(1);
    const v2 = JSON.parse(JSON.stringify(validDraft));
    v2.pages[0].name = 'Вторая';
    const p2 = await call(env, 'POST', `/api/miniapps/${id}/publish`, { app: v2 });
    expect(p2.data.revision).toBe(2);
    const vers = await call(env, 'GET', `/api/miniapps/${id}/versions`);
    expect(vers.data.versions.map((v: any) => v.revision)).toEqual([2, 1]);
    const rb = await call(env, 'POST', `/api/miniapps/${id}/rollback`, { revision: 1 });
    expect(rb.data.revision).toBe(3);
    const got = await call(env, 'GET', `/api/miniapps/${id}`);
    expect(got.data.published.pages[0].name).toBe('Главная');
  });

  it('публикация черновика без тела и битой схемы не проходит', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const id = created.data.id;
    // черновик по умолчанию валиден (пустая страница) — публикация без тела ок
    const ok = await call(env, 'POST', `/api/miniapps/${id}/publish`, {});
    expect(ok.status).toBe(200);
    const bad = await call(env, 'POST', `/api/miniapps/${id}/publish`, { app: { version: 1 } });
    expect(bad.status).toBe(400);
  });

  it('удаление убирает апп и версии', async () => {
    const { env, miniApps, versions } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const id = created.data.id;
    await call(env, 'POST', `/api/miniapps/${id}/publish`, {});
    expect(versions).toHaveLength(1);
    const del = await call(env, 'DELETE', `/api/miniapps/${id}`);
    expect(del.status).toBe(200);
    expect(miniApps).toHaveLength(0);
    expect(versions).toHaveLength(0);
  });

  it('чужой мини-апп без админ-ключа недоступен', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const id = created.data.id;
    const req = new Request(`https://bots.example/api/miniapps/${id}`, { method: 'GET' });
    const res = await (worker as any).fetch(req, { ...env, ADMIN_KEY: undefined, ENVIRONMENT: 'production' }, {});
    expect(res.status).toBe(401);
  });

  it('рантайм: HTML только для опубликованного, иначе 404', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    const id = created.data.id;
    const before = await call(env, 'GET', `/m/${BOT_ID}/shop`);
    expect(before.status).toBe(404);
    await call(env, 'POST', `/api/miniapps/${id}/publish`, {});
    const after = await new Request(`https://bots.example/m/${BOT_ID}/shop`, { method: 'GET' });
    const res = await (worker as any).fetch(after, env, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('рантайм: boot без initData — 401', async () => {
    const { env } = makeEnv();
    const created = await call(env, 'POST', `/api/bots/${BOT_ID}/miniapps`, { name: 'X', slug: 'shop' });
    await call(env, 'POST', `/api/miniapps/${created.data.id}/publish`, {});
    const res = await call(env, 'POST', `/m/api/${BOT_ID}/shop/boot`, {});
    expect(res.status).toBe(401);
  });
});
