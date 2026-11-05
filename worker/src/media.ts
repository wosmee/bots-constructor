// Медиа мини-аппов и конструктора: S3-совместимое хранилище Filebase.
// Ключи FILEBASE_KEY / FILEBASE_SECRET — секреты воркера (wrangler secret put),
// в репозитории их нет. Без ключей модуль деградирует до 503, остальной воркер живёт.
//
// S5-10 → S6 (22.10.2026): сначала @aws-sdk/client-s3 импортировался динамически
// «чтобы не тянуть 625 КБ в бандл» — но wrangler НЕ режет динамические импорты на
// чанки: esbuild собирает всё в один index.js. Замер деплоя был 1745 KiB/gzip 343 KiB,
// из них ~1.3 МБ — SDK (smithy+checksums+s3). То есть каждый холодный старт изолята
// (включая вебхук-путь, которому S3 не нужен вовсе) парсил весь SDK.
// Здесь — своя реализация SigV4 поверх fetch: те же метод/эндпоинт/регион/подпись,
// ноль зависимостей. Эквивалентность подписи с SDK проверена тестом
// tests/media-sigv4.test.ts (сравнение Authorization-заголовков байт в байт).

const ENDPOINT = 'https://s3.filebase.io';
const REGION = 'auto';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
export const MEDIA_BUCKET = 'bots-media';

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const IMG_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function mediaEnabled(env: { FILEBASE_KEY?: string; FILEBASE_SECRET?: string }): boolean {
  return Boolean(env.FILEBASE_KEY && env.FILEBASE_SECRET);
}

type Env = { FILEBASE_KEY?: string; FILEBASE_SECRET?: string };

// ---- ошибка с той же формой, что у SDK ($metadata/httpStatusCode, .name, .Code) ----
// /m/img различает NoSuchKey/NotFound по этим полям — семантику сохраняем.
export class S3Error extends Error {
  Code: string;
  $metadata: { httpStatusCode: number };
  constructor(message: string, code: string, httpStatusCode: number) {
    super(message);
    this.name = code;
    this.Code = code;
    this.$metadata = { httpStatusCode };
  }
}

// ---- крипто-примитивы (WebCrypto есть и в воркере, и в Node 20+) ----

const te = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? te.encode(data) : data));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, te.encode(msg));
}

// AWS4-HMAC-SHA256: kDate = HMAC("AWS4"+secret, datestamp) → kRegion → kService → kSigning
async function signingKey(secret: string, datestamp: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(te.encode(`AWS4${secret}`), datestamp);
  const kRegion = await hmacSha256(kDate, REGION);
  const kService = await hmacSha256(kRegion, SERVICE);
  return hmacSha256(kService, 'aws4_request');
}

// URI-кодирование по правилам SigV4: без слешей и без unreserved-символов в кодировке.
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (ch === '/' && !encodeSlash) out += '/';
    else out += [...te.encode(ch)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }
  return out;
}

function amzDate(now: Date): { amz: string; stamp: string } {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  return { amz, stamp: amz.slice(0, 8) };
}

type Creds = { accessKeyId: string; secretAccessKey: string };

// Подписанный запрос к S3: method, путь (уже с бакетом при path-style), тело, доп-заголовки.
// Подписываем минимум, который требует S3: host, x-amz-content-sha256, x-amz-date.
async function s3Fetch(
  creds: Creds,
  method: string,
  path: string,
  body: Uint8Array | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const now = new Date();
  const { amz, stamp } = amzDate(now);
  const payloadHash = await sha256Hex(body ?? '');
  const host = new URL(ENDPOINT).host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
    ...extraHeaders,
  };

  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k].trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalRequest = [
    method,
    uriEncode(path, false),
    '', // query — во всех операциях модуля он пустой
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${stamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amz, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = hex(await hmacSha256(await signingKey(creds.secretAccessKey, stamp), stringToSign));

  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      ...headers,
      authorization: `${ALGORITHM} Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body ?? undefined,
  });
  return res;
}

// Тело ошибки S3 — XML с <Code>. Некоторые ответы (404 Filebase) приходят без тела.
async function throwS3(res: Response, fallbackCode: string): Promise<never> {
  let code = fallbackCode;
  try {
    const text = await res.text();
    const m = text.match(/<Code>([^<]+)<\/Code>/);
    if (m) code = m[1];
  } catch {
    /* тело уже прочитано или пустое — остаёмся на fallback */
  }
  throw new S3Error(`${code} (HTTP ${res.status})`, code, res.status);
}

function creds(env: Env): Creds {
  return { accessKeyId: env.FILEBASE_KEY as string, secretAccessKey: env.FILEBASE_SECRET as string };
}

// ---- публичное API модуля (имена и семантика — как были у SDK-версии) ----

// Бакет на free-тарифе один; создаём лениво при первой загрузке.
// Существующий бакет отдаёт 409 (BucketAlreadyOwnedByYou / BucketAlreadyExists) — это успех.
export async function ensureMediaBucket(env: Env): Promise<void> {
  const body = te.encode(
    '<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>auto</LocationConstraint></CreateBucketConfiguration>',
  );
  const res = await s3Fetch(creds(env), 'PUT', `/${MEDIA_BUCKET}`, body, { 'content-type': 'application/xml' });
  if (res.ok || res.status === 409) return;
  await throwS3(res, 'CreateBucketFailed');
}

export function mediaExt(contentType: string): string | null {
  return IMG_TYPES[contentType] ?? null;
}

export async function mediaPut(
  env: Env,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await s3Fetch(creds(env), 'PUT', `/${key}`, body, { 'content-type': contentType });
  if (!res.ok) await throwS3(res, 'PutObjectFailed');
}

export async function mediaGet(
  env: Env,
  key: string,
): Promise<{ body: ReadableStream; contentType: string; size: number } | null> {
  const res = await s3Fetch(creds(env), 'GET', `/${key}`, null);
  if (res.status === 404) return null;
  if (!res.ok) await throwS3(res, 'GetObjectFailed');
  if (!res.body) return null;
  return {
    body: res.body,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    size: Number(res.headers.get('content-length') ?? 0),
  };
}

export async function mediaDelete(
  env: Env,
  key: string,
): Promise<void> {
  const res = await s3Fetch(creds(env), 'DELETE', `/${key}`, null);
  if (!res.ok && res.status !== 204) await throwS3(res, 'DeleteObjectFailed');
}

// Ключ: <botId>/<uuid>.<ext>. В URL попадает как /m/img/<botId>/<uuid>.<ext>.
export function mediaKey(botId: string, ext: string): string {
  return `${botId}/${crypto.randomUUID()}.${ext}`;
}
