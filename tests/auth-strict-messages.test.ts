// Строгие сообщения входа + проверяемый админ-ключ (29.09.2026).
//
// Покрытие:
//  - POST /api/auth/login: неизвестный логин → 401 «Логин не найден»
//    (code login_not_found) и НИКОГДА не «Пароль не верный»; существующий
//    аккаунт + неверный пароль → 401 «Пароль не верный» (code wrong_password);
//    верная пара → 200 с токеном, счётчики неудач в KV сброшены;
//  - 10 накопленных неудач → 429 (прежнее поведение);
//  - POST /api/auth/register: занятый логин → 409 «Логин занят»,
//    зарезервированный → 400 «этот логин зарезервирован»;
//  - GET /api/admin/session: верный ключ → 200 { ok, adminKey }; неверный и
//    отсутствующий заголовок → одинаковое 401 «Неверный админ-ключ»;
//    ADMIN_KEY не задан → 401 и в dev, и в production (fail-open убран);
//  - GET /api/bots: аноним → 401, чужой ключ → 401, верный ключ → 200 + adminKey;
//  - DELETE /api/auth/me и POST /api/auth/password: неверный пароль → 401
//    «Пароль не верный»;
//  - антибрут админ-ключа: 10 неудач с одного IP → 11-й запрос 429, успех
//    сбрасывает счётчик.
//
// Ключи и пароли вымышленные. ENVIRONMENT: 'production' — как в
// tests/admin-user-lookup.test.ts; dev-ветки проверяются отдельным env.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { hashPassword } from '../worker/src/auth';

const ADMIN_KEY = 'test-admin-key';
const ENC_KEY = btoa('0123456789abcdef0123456789abcdef');
const PASSWORD = 'correct-horse-99';
// Один настоящий PBKDF2-хэш на файл: 100k итераций не стоит платить за тест.
const PASS_HASH = await hashPassword(PASSWORD);

const ACCOUNTS: Record<string, { id: string; login: string; pass_hash: string; created_at: number }> = {
  ilya: { id: 'u1', login: 'ilya', pass_hash: PASS_HASH, created_at: 1700000000000 },
};

const BOTS = [
  { id: 'bot-admin', owner_id: 'admin', name: 'Бот платформы', active: 0, created_at: 5, owner_login: null },
  { id: 'bot-u1', owner_id: 'u1', name: 'Бот Ильи', active: 1, created_at: 6, owner_login: 'ilya' },
];

type Recorded = { sql: string; args: unknown[] };

function makeEnv(overrides: Partial<{ ADMIN_KEY: string | undefined; ENVIRONMENT: string }> = {}) {
  const recorded: Recorded[] = [];
  const kvStore = new Map<string, string>();
  // Действующая сессия аккаунта для DELETE /me и POST /password.
  kvStore.set('sess:tok-user', JSON.stringify({ id: 'u1', login: 'ilya', exp: Date.now() + 60_000 }));

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              recorded.push({ sql, args });
              if (sql.includes('FROM accounts WHERE login = ?')) {
                return (ACCOUNTS[String(args[0])] as T) ?? null;
              }
              return null;
            },
            async all<T>() {
              recorded.push({ sql, args });
              if (sql.includes('FROM bots b LEFT JOIN accounts a')) {
                const ownerId = args[0];
                return { results: BOTS.filter((b) => b.owner_id === ownerId) } as { results: T[] };
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
    // batch — сосед prepare (POST /api/bots пишет одной пачкой).
    async batch(stmts: { run?: () => Promise<unknown> }[] = []) {
      for (const s of stmts) await s?.run?.();
      return [];
    },
  };

  const kv = {
    get: async (key: string) => kvStore.get(key) ?? null,
    put: async (key: string, value: string) => {
      kvStore.set(key, value);
    },
    delete: async (key: string) => {
      kvStore.delete(key);
    },
  };

  const env = {
    DB: db,
    KV: kv,
    ENCRYPTION_KEY: ENC_KEY,
    ADMIN_KEY: 'ADMIN_KEY' in overrides ? overrides.ADMIN_KEY : ADMIN_KEY,
    ENVIRONMENT: overrides.ENVIRONMENT ?? 'production',
  } as any;
  return { env, kvStore, recorded };
}

function call(env: any, method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  return (worker as any).fetch(
    new Request(`https://bots.example${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    {}
  ) as Promise<Response>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/auth/login — различимые сообщения', () => {
  it('неизвестный логин → 401 «Логин не найден» (code login_not_found), независимо от формы пароля', async () => {
    const { env } = makeEnv();
    for (const password of ['', 'x', 'wrong-password', PASSWORD]) {
      const res = await call(env, 'POST', '/api/auth/login', {}, { login: 'nosuchuser', password });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string; code?: string };
      expect(body.error).toBe('Логин не найден');
      expect(body.code).toBe('login_not_found');
      // Парольная ошибка на неизвестном логине не допускается ни в каком виде.
      expect(body.error).not.toBe('Пароль не верный');
    }
  });

  it('известный логин + неверный пароль → 401 «Пароль не верный» (code wrong_password)', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'POST', '/api/auth/login', {}, { login: 'ilya', password: 'not-the-password' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Пароль не верный', code: 'wrong_password' });
  });

  it('верная пара → 200 с токеном, счётчики неудач сброшены', async () => {
    const { env, kvStore } = makeEnv();
    // Предварительно «набрутфорсим» оба бакета — успех обязан их очистить.
    kvStore.set('rl:login:unknown', '3');
    kvStore.set('rl:acct:ilya', '3');
    const res = await call(env, 'POST', '/api/auth/login', {}, { login: 'ilya', password: PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; token: string; user: { id: string; login: string } };
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user).toEqual({ id: 'u1', login: 'ilya' });
    expect(kvStore.has('rl:login:unknown')).toBe(false);
    expect(kvStore.has('rl:acct:ilya')).toBe(false);
  });

  it('10 накопленных неудач → 429 (прежнее поведение)', async () => {
    const { env, kvStore } = makeEnv();
    kvStore.set('rl:login:unknown', '10');
    const res = await call(env, 'POST', '/api/auth/login', {}, { login: 'ilya', password: 'wrong' });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('слишком много неудачных попыток. Подождите 10 минут');
  });

  it('неудача с неизвестным логином тоже пополняет счётчики login:<ip> и acct:<login>', async () => {
    const { env, kvStore } = makeEnv();
    await call(env, 'POST', '/api/auth/login', {}, { login: 'ghost', password: 'x' });
    expect(kvStore.get('rl:login:unknown')).toBe('1');
    expect(kvStore.get('rl:acct:ghost')).toBe('1');
  });
});

describe('POST /api/auth/register — без изменений', () => {
  it('занятый логин → 409 «Логин занят»', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'POST', '/api/auth/register', {}, { login: 'ilya', password: 'secret123' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Логин занят');
  });

  it('зарезервированный логин → 400 «этот логин зарезервирован»', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'POST', '/api/auth/register', {}, { login: 'admin', password: 'secret123' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('этот логин зарезервирован');
  });
});

describe('GET /api/admin/session — проверка ключа сервером', () => {
  it('верный ключ → 200 { ok, adminKey }', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': ADMIN_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, adminKey: true });
  });

  it('неверный ключ → 401 «Неверный админ-ключ» (code admin_key_invalid)', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': 'random-text' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Неверный админ-ключ', code: 'admin_key_invalid' });
  });

  it('нет заголовка → то же тело 401, что и при неверном ключе', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/admin/session', {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Неверный админ-ключ', code: 'admin_key_invalid' });
  });

  it('ADMIN_KEY не задан, ENVIRONMENT=dev, любой заголовок → 401 (fail-open убран)', async () => {
    const { env } = makeEnv({ ADMIN_KEY: undefined, ENVIRONMENT: 'dev' });
    for (const key of ['anything', '', ADMIN_KEY]) {
      const res = await call(env, 'GET', '/api/admin/session', key ? { 'x-admin-key': key } : {});
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Неверный админ-ключ');
    }
  });

  it('ADMIN_KEY не задан, ENVIRONMENT=production → 401', async () => {
    const { env } = makeEnv({ ADMIN_KEY: undefined, ENVIRONMENT: 'production' });
    const res = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': 'anything' });
    expect(res.status).toBe(401);
  });

  it('пустой заголовок при заданном ключе → 401 (пустое не сравнивается)', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': '' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/bots — админ-доступ только по верному ключу', () => {
  it('аноним → 401', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/bots');
    expect(res.status).toBe(401);
  });

  it('неверный админ-ключ → 401', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/bots', { 'x-admin-key': 'not-the-key' });
    expect(res.status).toBe(401);
  });

  it('верный ключ → 200 с adminKey: true и платформенным каталогом', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'GET', '/api/bots', { 'x-admin-key': ADMIN_KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: any[]; adminKey: boolean };
    expect(body.adminKey).toBe(true);
    expect(body.bots.map((b) => b.id)).toEqual(['bot-admin']);
  });

  it('ADMIN_KEY не задан (dev) → админ-доступа нет, аноним 401', async () => {
    const { env } = makeEnv({ ADMIN_KEY: undefined, ENVIRONMENT: 'dev' });
    const anon = await call(env, 'GET', '/api/bots');
    expect(anon.status).toBe(401);
    const withKey = await call(env, 'GET', '/api/bots', { 'x-admin-key': 'anything' });
    expect(withKey.status).toBe(401);
  });
});

describe('DELETE /api/auth/me и POST /api/auth/password — неверный пароль', () => {
  it('DELETE /api/auth/me с неверным паролем → 401 «Пароль не верный»', async () => {
    const { env } = makeEnv();
    const res = await call(env, 'DELETE', '/api/auth/me', { authorization: 'Bearer tok-user' }, { password: 'wrong' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Пароль не верный', code: 'wrong_password' });
  });

  it('POST /api/auth/password с неверным старым паролем → 401 «Пароль не верный»', async () => {
    const { env } = makeEnv();
    const res = await call(
      env,
      'POST',
      '/api/auth/password',
      { authorization: 'Bearer tok-user' },
      { oldPassword: 'wrong', newPassword: 'new-secret-1' }
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Пароль не верный', code: 'wrong_password' });
  });
});

describe('антибрут админ-ключа (бакет admin:<ip>)', () => {
  it('10 неудач с одного IP → 11-й запрос 429 (code rate_limited)', async () => {
    // slowDown спит реальными таймерами (до 3 с на попытку) — в тесте
    // выполняем колбэк сразу.
    vi.stubGlobal('setTimeout', (fn: () => void) => {
      fn();
      return 0;
    });
    const { env, kvStore } = makeEnv();
    for (let i = 0; i < 10; i++) {
      const res = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': `wrong-${i}` });
      expect(res.status).toBe(401);
    }
    expect(kvStore.get('rl:admin:unknown')).toBe('10');
    const blocked = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': ADMIN_KEY });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string; code?: string };
    expect(body.error).toBe('слишком много неудачных попыток. Подождите 10 минут');
    expect(body.code).toBe('rate_limited');
  });

  it('успех сбрасывает счётчик неудач', async () => {
    const { env, kvStore } = makeEnv();
    kvStore.set('rl:admin:unknown', '9');
    const ok = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': ADMIN_KEY });
    expect(ok.status).toBe(200);
    expect(kvStore.has('rl:admin:unknown')).toBe(false);
    // После сброса даже неудача не блокирует — снова 401, не 429.
    const after = await call(env, 'GET', '/api/admin/session', { 'x-admin-key': 'wrong' });
    expect(after.status).toBe(401);
  });
});
