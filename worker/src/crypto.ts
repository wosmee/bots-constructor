// AES-256-GCM token encryption using WebCrypto (available in CF Workers).
// ENCRYPTION_KEY env = base64 of exactly 32 random bytes.

const enc = new TextEncoder();
const dec = new TextDecoder();

// Кэш импортированных AES-ключей (модульный скоуп = память isolate).
const KEY_CACHE_MAX = 4;
const keyCache = new Map<string, CryptoKey>();

function b64ToBytes(b: string): Uint8Array {
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}
function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

async function getKey(keyB64: string): Promise<CryptoKey> {
  const cached = keyCache.get(keyB64);
  if (cached) return cached;
  const raw = b64ToBytes(keyB64);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  // importKey стоит дорого, а decryptToken зовётся на каждый апдейт вебхука.
  // CryptoKey неизвлекаем (extractable=false) и живёт только в памяти isolate.
  // Ключей на практике один-два; при переполнении кэш просто очищаем.
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(keyB64, key);
  return key;
}

export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const key = await getKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return bytesToB64(iv) + '|' + bytesToB64(new Uint8Array(ct));
}

export async function decryptToken(blob: string, keyB64: string): Promise<string> {
  const key = await getKey(keyB64);
  const parts = blob.split('|');
  if (parts.length !== 2) throw new Error('bad token blob');
  const iv = b64ToBytes(parts[0]);
  const ct = b64ToBytes(parts[1]);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}
