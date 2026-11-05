// Password hashing (PBKDF2-SHA256) + session helpers for platform accounts.
// Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>

// Cloudflare Workers' WebCrypto rejects PBKDF2 iteration counts above 100000,
// so 100k is the platform ceiling here. That is BELOW the OWASP recommendation
// for PBKDF2-HMAC-SHA256 (210k iterations; 600k for SHA-1) — accepted as an
// unavoidable runtime limitation (owner decision 2026-10: no pepper). Do not
// describe this setting as meeting or exceeding OWASP guidance.
const ITERATIONS = 100_000;
const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2' || !iter || !saltB64 || !hashB64) return false;
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations: Number(iter), hash: 'SHA-256' },
      key,
      256
    );
    const expected = fromB64(hashB64);
    const actual = new Uint8Array(bits);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export interface SessionUser {
  id: string;
  login: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function createSession(kv: KVNamespace, user: SessionUser): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await kv.put(`sess:${token}`, JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function readSession(kv: KVNamespace, token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(`sess:${token}`).catch(() => null);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SessionUser & { exp?: number };
    if (!data?.id) return null;
    if (data.exp && data.exp < Date.now()) {
      await kv.delete(`sess:${token}`).catch(() => {});
      return null;
    }
    return { id: data.id, login: data.login };
  } catch {
    return null;
  }
}

export async function dropSession(kv: KVNamespace, token: string): Promise<void> {
  if (token) await kv.delete(`sess:${token}`).catch(() => {});
}

export function bearerToken(c: any): string {
  const h = c.req.header('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}
