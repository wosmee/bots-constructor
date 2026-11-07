// B2: страница «Пользователи» — staff-доступ к чужим аккаунтам и скоупинг
// дашборда. Гоняем реальный app.fetch с фейковым D1/KV.
//
// Покрытие:
//  - GET /api/bots: обычный пользователь получает ТОЛЬКО свои боты; чистая
//    ADMIN_KEY-сессия (без аккаунта) — свой каталог (боты с owner_id = 'admin')
//    плюс флаг adminKey, но НЕ глобальный список;
//  - GET /api/admin/users/:login: 401 анониму, 403 роли user, 200 moderator и
//    admin, 404 с человеческим сообщением на неизвестный логин;
//  - GET /api/admin/users/:login/logs: агрегирует строки только ботов этого
//    владельца, каждая строка несёт bot_id и bot_name;
//  - moderator по-прежнему ОТВЕДЁН от записи чужого бота
//    (PUT scenario / POST publish / DELETE bot);
//  - limit зажат до 500 (limit=10000 → в SQL уходит 500).
import { describe, expect, it } from 'vitest';
import worker from '../worker/src/index';

const ADMIN_KEY = 'test-admin-key';
const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');

// Аккаунты: u1 — обычный, m1 — модератор, a1 — админ, t1 — цель поиска.
const ACCOUNTS: Record<string, { id: string; login: string; role: string; created_at: number }> = {
  ivan: { id: 'u1', login: 'ivan', role: 'user', created_at: 1700000000000 },
  mod: { id: 'm1', login: 'mod', role: 'moderator', created_at: 1700000001000 },
  adm: { id: 'a1', login: 'adm', role: 'admin', created_at: 1700000002000 },
  target: { id: 't1', login: 'target', role: 'user', created_at: 1700000003000 },
};

const BOTS = [
  { id: 'bot-mine', owner_id: 'u1', name: 'Мой бот', active: 1, created_at: 1, published_version: 3 },
  { id: 'bot-t1', owner_id: 't1', name: 'Бот цели', active: 1, created_at: 2, published_version: 5 },
  { id: 'bot-t2', owner_id: 't1', name: 'Второй бот цели', active: 0, created_at: 3, published_version: null },
  { id: 'bot-other', owner_id: 'x9', name: 'Чужой бот', active: 1, created_at: 4, published_version: null },
  // Бот, созданный под платформенным ключом: владельца-аккаунта у него нет,
  // owner_id — литерал 'admin'. Ровно такие боты терялись из каталога.
  { id: 'bot-admin', owner_id: 'admin', name: 'Бот платформы', active: 0, created_at: 5, published_version: null },
];

// Логи: у каждого бота свои; чужие строки не должны попасть в агрегацию t1.
const LOGS = [
  { id: 11, bot_id: 'bot-t1', user_id: 100, event: 'scenario.saved.v5', ts: 500 },
  { id: 12, bot_id: 'bot-t2', user_id: null, event: 'bot.created', ts: 400 },
  { id: 13, bot_id: 'bot-other', user_id: 777, event: 'publish.ok', ts: 600 },
  { id: 14, bot_id: 'bot-mine', user_id: 100, event: 'step.s1', ts: 300 },
];

type Recorded = { sql: string; args: unknown[] };

function makeEnv() {
  const recorded: Recorded[] = [];

  const sessions: Record<string, { id: string; login: string }> = {
    'sess:tok-user': { id: 'u1', login: 'ivan' },
    'sess:tok-mod': { id: 'm1', login: 'mod' },
    'sess:tok-admin': { id: 'a1', login: 'adm' },
  };

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              recorded.push({ sql, args });
              if (sql.includes('FROM accounts WHERE login = ?')) {
                const acc = ACCOUNTS[String(args[0])];
                return acc ? ({ ...acc, pass_hash: 'pbkdf2$x' } as T) : null;
              }
              if (sql.includes('SELECT role FROM accounts WHERE id = ?')) {
                const acc = Object.values(ACCOUNTS).find((a) => a.id === args[0]);
                return acc ? ({ role: acc.role } as T) : ({ role: 'user' } as T);
              }
              if (sql.includes('FROM bots WHERE id = ?')) {
                const b = BOTS.find((x) => x.id === args[0]);
                return b
                  ? ({ ...b, token_enc: 'enc', webhook_secret: 'ws' } as T)
                  : null;
              }
              if (sql.includes('SELECT COUNT(*) AS n FROM logs l JOIN bots b')) {
                const ownerBots = BOTS.filter((b) => b.owner_id === args[0]).map((b) => b.id);
                return { n: LOGS.filter((l) => ownerBots.includes(l.bot_id)).length } as T;
              }
              return null;
            },
            async all<T>() {
              recorded.push({ sql, args });
              if (sql.includes('FROM bots b LEFT JOIN accounts a')) {
                const ownerId = args[0];
                const rows = BOTS.filter((b) => b.owner_id === ownerId).map((b) => ({
                  ...b,
                  owner_login: Object.values(ACCOUNTS).find((a) => a.id === b.owner_id)?.login ?? null,
                }));
                return { results: rows } as { results: T[] };
              }
              if (sql.includes('FROM bots b WHERE b.owner_id = ?')) {
                const rows = BOTS.filter((b) => b.owner_id === args[0]).map((b) => ({
                  id: b.id,
                  name: b.name,
                  active: b.active,
                  created_at: b.created_at,
                  published_version: b.published_version,
                  scenario_version: b.active ? 1 : null,
                }));
                return { results: rows } as { results: T[] };
              }
              if (sql.includes('FROM logs l JOIN bots b')) {
                // Честный JOIN: только боты этого владельца, фильтры botId/userId,
                // порядок ts DESC, id DESC, лимит — последний аргумент.
                const ownerId = args[0];
                const ownerBots = BOTS.filter((b) => b.owner_id === ownerId).map((b) => b.id);
                let rows = LOGS.filter((l) => ownerBots.includes(l.bot_id));
                let argIdx = 1;
                if (sql.includes('l.bot_id = ?')) {
                  // Значение фиксируем ДО filter: инкремент внутри колбэка
                  // сдвигал бы индекс на каждой строке.
                  const botId = args[argIdx++];
                  rows = rows.filter((l) => l.bot_id === botId);
                }
                if (sql.includes('l.user_id = ?')) {
                  const uid = args[argIdx++];
                  rows = rows.filter((l) => l.user_id === uid);
                }
                const lim = Number(args[args.length - 1]);
                rows = [...rows].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, lim);
                return {
                  results: rows.map((l) => ({
                    ...l,
                    bot_name: BOTS.find((b) => b.id === l.bot_id)?.name ?? '',
                  })),
                } as { results: T[] };
              }
              return { results: [] } as { results: T[] };
            },
            async run() {
              recorded.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    // batch — СОСЕД prepare на объекте db, а не метод внутри него: создание
    // бота вызывает db.batch([...]) (см. POST /api/bots), и вложенный в
    // prepare batch дал бы TypeError: db.batch is not a function.
    //
    // Записывать statement'ы обязательно: создание бота идёт одной пачкой
    // (INSERT INTO bots + scenarios), и без этого проверка «под ключом пишется
    // owner_id = admin» проверяла бы пустоту.
    async batch(stmts: { run?: () => Promise<unknown> }[] = []) {
      for (const s of stmts) await s?.run?.();
      return [];
    },
  };

  const kv = {
    get: async (key: string) => (key in sessions ? JSON.stringify({ ...sessions[key], exp: Date.now() + 60_000 }) : null),
    put: async () => {},
    delete: async () => {},
  };

  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY, ENVIRONMENT: 'production' } as any;
  return { env, recorded };
}

function get(env: any, path: string, headers: Record<string, string> = {}) {
  return (worker as any).fetch(new Request(`https://bots.example${path}`, { headers }), env, {});
}

function call(env: any, method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return (worker as any).fetch(
    new Request(`https://bots.example${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body != null ? { body } : {}),
    }),
    env,
    {}
  );
}

const asUser = { authorization: 'Bearer tok-user' };
const asMod = { authorization: 'Bearer tok-mod' };
const asAdminAcc = { authorization: 'Bearer tok-admin' };
const asAdminKey = { 'x-admin-key': ADMIN_KEY };

describe('GET /api/bots — скоупинг дашборда', () => {
  it('обычный пользователь получает только свои боты', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/bots', asUser);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: any[]; adminKey?: boolean };
    expect(body.adminKey).toBeUndefined();
    expect(body.bots.map((b) => b.id)).toEqual(['bot-mine']);
  });

  it('модератор тоже видит только СВОИ боты (глобальный список убран)', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/bots', asMod);
    const body = (await res.json()) as { bots: any[] };
    // У m1 своих ботов нет в фикстуре.
    expect(body.bots).toEqual([]);
  });

  // Регрессия: под платформенным ключом бот создавался с owner_id = 'admin', но
  // список отдавался пустой — бот не появлялся в каталоге ни разу.
  it('чистая ADMIN_KEY-сессия получает свой каталог (owner_id = admin) + флаг adminKey', async () => {
    const { env, recorded } = makeEnv();
    const res = await get(env, '/api/bots', asAdminKey);
    const body = (await res.json()) as { bots: any[]; adminKey: boolean };
    expect(body.adminKey).toBe(true);
    expect(body.bots.map((b) => b.id)).toEqual(['bot-admin']);
    // Фильтр шёл по owner_id: чужие боты в список не попали.
    expect(body.bots.map((b) => b.owner_id)).toEqual(['admin']);
    // Глобальный SELECT (без owner_id) не выполнялся.
    expect(recorded.some((r) => r.sql.includes('FROM bots b LEFT JOIN accounts a') && r.args.length === 0)).toBe(false);
  });

  it('созданный под ключом бот виден в том же каталоге сразу после создания', async () => {
    const { env, recorded } = makeEnv();
    const created = await call(
      env,
      'POST',
      '/api/bots',
      asAdminKey,
      JSON.stringify({ name: 'Новый бот платформы', token: '123456789:AAF-test' })
    );
    expect(created.status).toBe(200);
    const insert = recorded.find((r) => r.sql.includes('INSERT INTO bots'));
    expect(insert).toBeTruthy();
    // Владелец — ровно тот ключ, которым читается каталог платформенной сессии.
    expect(insert!.args[1]).toBe('admin');
  });

  it('аноним — 401', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/bots');
    expect(res.status).toBe(401);
  });

  // Пагинация (опциональная): без параметров — прежнее поведение (весь список,
  // total равен длине); с limit/offset — COUNT + LIMIT/OFFSET в SQL, total из
  // COUNT. Фейковый D1 в makeEnv не знает LIMIT/OFFSET для этого SELECT —
  // проверяем сам SQL и форму ответа, не порядок строк.
  it('?limit/offset включает пагинацию: COUNT + LIMIT/OFFSET, total из COUNT', async () => {
    const { env, recorded } = makeEnv();
    const res = await get(env, '/api/bots?limit=10&offset=5', asUser);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: any[]; total: number };
    expect(typeof body.total).toBe('number');
    // COUNT-запрос ушёл (в first), фильтр по владельцу — тот же bind.
    const countQ = recorded.find((r) => r.sql.includes('SELECT COUNT(*) AS n FROM bots b'));
    expect(countQ).toBeTruthy();
    expect(countQ!.args).toEqual(['u1']);
    // Основной запрос — с LIMIT/OFFSET.
    const listQ = recorded.find((r) => r.sql.includes('FROM bots b LEFT JOIN accounts a') && /LIMIT \? OFFSET \?/.test(r.sql));
    expect(listQ).toBeTruthy();
    expect(listQ!.args.slice(-2)).toEqual([10, 5]);
  });

  it('без параметров пагинации SQL прежний: без LIMIT и без COUNT', async () => {
    const { env, recorded } = makeEnv();
    await get(env, '/api/bots', asUser);
    expect(recorded.some((r) => r.sql.includes('SELECT COUNT(*) AS n FROM bots b'))).toBe(false);
    expect(recorded.some((r) => /LIMIT \? OFFSET \?/.test(r.sql))).toBe(false);
  });

  it('битые limit/offset игнорируются — работает как без пагинации', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/bots?limit=abc', asUser);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: any[]; total: number };
    expect(body.total).toBe(body.bots.length);
  });
});

describe('GET /api/admin/users/:login', () => {
  it('401 анониму', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/admin/users/target');
    expect(res.status).toBe(401);
  });

  it('403 роли user', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/admin/users/target', asUser);
    expect(res.status).toBe(403);
  });

  it('200 модератору: профиль, боты и итоги', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/admin/users/target', asMod);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.user).toEqual({ id: 't1', login: 'target', role: 'user', created_at: 1700000003000 });
    expect(body.bots.map((b: any) => b.id)).toEqual(['bot-t1', 'bot-t2']);
    // published_version из фикстуры, scenario_version — число или null.
    expect(body.bots[0]).toMatchObject({ published_version: 5, scenario_version: 1 });
    expect(body.bots[1].published_version).toBeNull();
    expect(body.totals).toEqual({ bots: 2, logEvents: 2 });
  });

  it('200 админу аккаунта и ADMIN_KEY-сессии', async () => {
    const { env } = makeEnv();
    expect((await get(env, '/api/admin/users/target', asAdminAcc)).status).toBe(200);
    expect((await get(env, '/api/admin/users/target', asAdminKey)).status).toBe(200);
  });

  it('404 с человекочитаемым сообщением на неизвестный логин', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/admin/users/nosuchuser', asMod);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('аккаунт не найден');
  });

  it('поиск регистронезависим и логируется в журнал', async () => {
    const { env, recorded } = makeEnv();
    const res = await get(env, '/api/admin/users/TARGET', asMod);
    expect(res.status).toBe(200);
    const events = recorded
      .filter((r) => r.sql.includes('INSERT INTO logs'))
      .map((r) => String(r.args[2]));
    expect(events).toContain('admin.user.view.target');
  });
});

describe('GET /api/admin/users/:login/logs', () => {
  it('агрегирует только боты владельца; bot_name присутствует', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/admin/users/target/logs', asMod);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logs: any[] };
    // bot-other (владелец x9) и bot-mine (u1) НЕ попадают.
    expect(body.logs.map((l) => l.id)).toEqual([11, 12]);
    for (const l of body.logs) {
      expect(l.bot_id).toBeTruthy();
      expect(l.bot_name).toBeTruthy();
      expect(['bot-t1', 'bot-t2']).toContain(l.bot_id);
    }
  });

  it('фильтр botId сужает выборку', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/admin/users/target/logs?botId=bot-t2', asMod);
    const body = (await res.json()) as { logs: any[] };
    expect(body.logs.map((l) => l.id)).toEqual([12]);
  });

  it('лимит зажат до 500', async () => {
    const { env, recorded } = makeEnv();
    await get(env, '/api/admin/users/target/logs?limit=10000', asMod);
    const joinQuery = recorded.filter((r) => r.sql.includes('FROM logs l JOIN bots b') && r.sql.includes('LIMIT'));
    expect(joinQuery.length).toBeGreaterThan(0);
    expect(Number(joinQuery[0].args[joinQuery[0].args.length - 1])).toBe(500);
  });

  it('403 обычному пользователю, 401 анониму', async () => {
    const { env } = makeEnv();
    expect((await get(env, '/api/admin/users/target/logs', asUser)).status).toBe(403);
    expect((await get(env, '/api/admin/users/target/logs')).status).toBe(401);
  });

  it('чтение логов чужого бота доступно модератору через /api/bots/:id/logs', async () => {
    const { env } = makeEnv();
    const res = await get(env, '/api/bots/bot-t1/logs?limit=10', asMod);
    expect(res.status).toBe(200);
    // Обычному пользователю чужой бот — 403.
    const res2 = await get(env, '/api/bots/bot-t1/logs', asUser);
    expect(res2.status).toBe(403);
  });
});

describe('граница записи: moderator НЕ расширяет loadOwnedBot', () => {
  it('PUT /api/bots/:id/scenario чужого бота → 403', async () => {
    const { env } = makeEnv();
    const res = await call(
      env,
      'PUT',
      '/api/bots/bot-t1/scenario',
      asMod,
      JSON.stringify({ name: 'x', flow_json: '{"version":1,"start":"s","blocks":{"s":{"id":"s","type":"start","params":{},"next":""}}}' })
    );
    expect(res.status).toBe(403);
  });

  it('POST /api/bots/:id/publish чужого бота → 403', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'POST', '/api/bots/bot-t1/publish', asMod, JSON.stringify({ name: 'x' }));
    expect(res.status).toBe(403);
  });

  it('DELETE /api/bots/:id чужого бота → 403', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'DELETE', '/api/bots/bot-t1', asMod);
    expect(res.status).toBe(403);
  });

  it('DELETE без авторизации → 401', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'DELETE', '/api/bots/bot-t1');
    expect(res.status).toBe(401);
  });
});
