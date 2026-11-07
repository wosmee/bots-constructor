// DH-01: worker/src/auth.ts — хэширование паролей (PBKDF2-SHA256) и сессии в KV.
//
// Покрытие:
//  - hashPassword: формат pbkdf2$<iterations>$<salt-b64>$<hash-b64>, 100k итераций
//    (потолок WebCrypto в Workers), случайная соль — два вызова дают разные строки;
//  - verifyPassword: верный пароль → true, неверный → false, битый stored → false;
//  - createSession: токен 64 hex-символа, запись в KV с TTL 30 дней (2592000 c);
//  - readSession: валидный токен → пользователь, истёкший → null (и ключ удалён),
//    мусор/пустой токен → null;
//  - dropSession: удаляет ключ сессии из KV;
//  - bearerToken: достаёт токен из Authorization, без заголовка → ''.
//
// SESSION_TTL_SECONDS в auth.ts не экспортируется (модульная приватная
// константа), поэтому 30 дней проверяются через её наблюдаемые эффекты:
// expirationTtl в kv.put и exp в записанном JSON.
import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  createSession,
  readSession,
  dropSession,
  bearerToken,
  type SessionUser,
} from '../worker/src/auth';

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30; // 2592000

function mockKV() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; opts?: any }> = [];
  return {
    store,
    puts,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: any) => {
      store.set(key, value);
      puts.push({ key, value, opts });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

// bearerToken принимает Hono-контекст; из него нужен только c.req.header.
function ctxWith(headers: Record<string, string>) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    },
  } as any;
}

describe('hashPassword', () => {
  it('возвращает строку формата pbkdf2$<iterations>$<salt>$<hash>', async () => {
    const hash = await hashPassword('secret123');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    const parts = hash.split('$');
    expect(parts).toHaveLength(4);
    // 100 000 — потолок итераций PBKDF2 в Cloudflare Workers.
    expect(Number(parts[1])).toBe(100_000);
    // Соль 16 байт, хэш SHA-256 — 32 байта.
    expect(atob(parts[2]).length).toBe(16);
    expect(atob(parts[3]).length).toBe(32);
  });

  it('случайная соль: два хэша одного пароля не равны', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('верный пароль → true', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('неверный пароль → false', async () => {
    const stored = await hashPassword('right-password');
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });

  it('битый stored → false, без исключения', async () => {
    for (const bad of ['', 'garbage', 'pbkdf2$100000', 'pbkdf2$100000$only-three', 'bcrypt$10$aa$bb']) {
      await expect(verifyPassword('any', bad)).resolves.toBe(false);
    }
  });

  it('подменённый хэш → false', async () => {
    const stored = await hashPassword('pw');
    const parts = stored.split('$');
    // Меняем один символ хэша — сравнение должно разойтись.
    const tampered = [...atob(parts[3])];
    tampered[0] = tampered[0] === 'A' ? 'B' : 'A';
    parts[3] = btoa(tampered.join(''));
    await expect(verifyPassword('pw', parts.join('$'))).resolves.toBe(false);
  });
});

describe('createSession', () => {
  it('возвращает токен и кладёт сессию в KV с TTL 30 дней', async () => {
    const kv = mockKV();
    const user: SessionUser = { id: 'u1', login: 'ivan' };
    const before = Date.now();
    const token = await createSession(kv as any, user);

    // Два UUID без дефисов — 64 hex-символа.
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const raw = kv.store.get(`sess:${token}`);
    expect(raw).toBeTruthy();
    const data = JSON.parse(raw!);
    expect(data.id).toBe('u1');
    expect(data.login).toBe('ivan');
    // SESSION_TTL_SECONDS = 2592000 (30 дней): проверяем через exp и expirationTtl.
    expect(data.exp).toBeGreaterThanOrEqual(before + THIRTY_DAYS_SECONDS * 1000);
    expect(data.exp).toBeLessThanOrEqual(Date.now() + THIRTY_DAYS_SECONDS * 1000);

    const put = kv.puts.find((p) => p.key === `sess:${token}`);
    expect(put?.opts?.expirationTtl).toBe(THIRTY_DAYS_SECONDS);
  });

  it('две сессии подряд дают разные токены', async () => {
    const kv = mockKV();
    const a = await createSession(kv as any, { id: 'u1', login: 'ivan' });
    const b = await createSession(kv as any, { id: 'u1', login: 'ivan' });
    expect(a).not.toBe(b);
  });
});

describe('readSession', () => {
  it('валидный токен → пользователь без exp', async () => {
    const kv = mockKV();
    const token = await createSession(kv as any, { id: 'u2', login: 'mod' });
    await expect(readSession(kv as any, token)).resolves.toEqual({ id: 'u2', login: 'mod' });
  });

  it('истёкший токен → null, ключ удаляется из KV', async () => {
    const kv = mockKV();
    await kv.put('sess:expired', JSON.stringify({ id: 'u3', login: 'old', exp: Date.now() - 1000 }));
    await expect(readSession(kv as any, 'expired')).resolves.toBeNull();
    expect(kv.store.has('sess:expired')).toBe(false);
  });

  it('невалидный токен → null', async () => {
    const kv = mockKV();
    await expect(readSession(kv as any, 'no-such-token')).resolves.toBeNull();
    await expect(readSession(kv as any, '')).resolves.toBeNull();
  });

  it('мусор в значении KV → null', async () => {
    const kv = mockKV();
    await kv.put('sess:bad-json', 'не json{{{');
    await expect(readSession(kv as any, 'bad-json')).resolves.toBeNull();
    // JSON валиден, но id нет — тоже null.
    await kv.put('sess:no-id', JSON.stringify({ login: 'x', exp: Date.now() + 60_000 }));
    await expect(readSession(kv as any, 'no-id')).resolves.toBeNull();
  });

  it('сессия без exp не считается истёкшей', async () => {
    const kv = mockKV();
    await kv.put('sess:no-exp', JSON.stringify({ id: 'u4', login: 'legacy' }));
    await expect(readSession(kv as any, 'no-exp')).resolves.toEqual({ id: 'u4', login: 'legacy' });
  });
});

describe('dropSession', () => {
  it('удаляет сессию из KV', async () => {
    const kv = mockKV();
    const token = await createSession(kv as any, { id: 'u5', login: 'gone' });
    expect(kv.store.has(`sess:${token}`)).toBe(true);
    await dropSession(kv as any, token);
    expect(kv.store.has(`sess:${token}`)).toBe(false);
    await expect(readSession(kv as any, token)).resolves.toBeNull();
  });

  it('пустой токен — no-op, без исключения', async () => {
    const kv = mockKV();
    await expect(dropSession(kv as any, '')).resolves.toBeUndefined();
  });
});

describe('bearerToken', () => {
  it('достаёт токен из Authorization: Bearer', () => {
    expect(bearerToken(ctxWith({ authorization: 'Bearer abc123' }))).toBe('abc123');
  });

  it('регистр схемы не важен, лишний пробел trimming', () => {
    expect(bearerToken(ctxWith({ authorization: 'bearer abc123' }))).toBe('abc123');
    expect(bearerToken(ctxWith({ authorization: 'BEARER   abc123  ' }))).toBe('abc123');
  });

  it('без заголовка или с чужой схемой → пустая строка', () => {
    expect(bearerToken(ctxWith({}))).toBe('');
    expect(bearerToken(ctxWith({ authorization: 'Token abc123' }))).toBe('');
    expect(bearerToken(ctxWith({ authorization: 'abc123' }))).toBe('');
  });
});
