// Платёжные провайдеры: сборка ссылки, разбор и ПРОВЕРКА подписи вебхука.
//
// Принцип платформы (держим его в каждом файле про платежи): платформа НЕ
// использует свой платёжный аккаунт, не проксирует деньги и никогда не видит
// данные карт. Владелец бота подключает СВОЕГО провайдера, платформа хранит
// конфиг, строит checkout-ссылку и проверяет подпись входящего вебхука.
//
// Все сравнения подписей — constant-time: обычное `===` на подписи раскрывает
// длину совпадающего префикса и позволяет подбирать её по времени ответа.
import type { PaymentProvider } from '../../db';

// ------------------------------------------------------------------ сравнение

// Constant-time сравнение строк. Длина не секрет, содержимое — секрет:
// сравниваем всегда полную длину, накапливая разницу без раннего выхода.
export function safeEqual(a: string, b: string): boolean {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------------ подписи

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const clean = String(hex ?? '').trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function b64ToBytes(b: string): Uint8Array {
  try {
    return Uint8Array.from(atob(String(b ?? '')), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

// HMAC-SHA256, шестнадцатеричная строка в нижнем регистре. Ключ всегда берём из
// расшифрованного секрета подключения (см. secrets в index.ts).
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// ------------------------------------------------------------------ конфиг

// Не секретная часть конфига подключения. Всё, что похоже на ключ, здесь
// лежать не должно — для этого есть secrets_enc.
export interface PaymentConfig {
  /** ЮKassa/Robokassa: идентификатор магазина. Telegram: не используется. */
  shopId?: string;
  /** Куда вести пользователя после успешной оплаты. */
  successUrl?: string;
  /** Куда вести после отказа. */
  failUrl?: string;
  /**
   * Шаблон checkout-ссылки: {{order}}, {{amount}}, {{currency}}, {{description}},
   * {{success}}, {{fail}}. Обязателен для 'custom' и 'yookassa' (WS-02: дефолтной
   * quickpay-формы больше нет — с неё вебхук YooKassa API не приходит и платёж
   * не фиксируется).
   */
  linkTemplate?: string;
  /** Robokassa: использовать ли тестовый режим (IsTest=1). */
  testMode?: boolean;
}

// Секретная часть. Формат — плоская карта строк; шифруется целиком.
export interface PaymentSecrets {
  /** Telegram Payments: provider_token из BotFather. */
  providerToken?: string;
  /** ЮKassa/Stripe: секретный ключ. */
  secretKey?: string;
  /** Robokassa: Password2 (проверка Result URL). */
  password2?: string;
  /** Robokassa: Password1 (формирование ссылки). */
  password1?: string;
  /** custom/stripe: секрет подписи вебхука. */
  webhookSecret?: string;
  /** Telegram: не используется, оставлено для симметрии форм. */
  webhookPassword?: string;
}

export function parseConfig(raw: string): PaymentConfig {
  try {
    const v = JSON.parse(raw || '{}');
    // Массив — тоже object; конфиг и секреты обязаны быть плоскими картами.
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as PaymentConfig) : {};
  } catch {
    return {};
  }
}

export function parseSecrets(raw: string): PaymentSecrets {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as PaymentSecrets) : {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ ссылки

// Ожидаемые от провайдера формы ссылки. Для 'telegram' внешней ссылки нет —
// счёт выставляет сам Telegram (sendInvoice), поэтому createLink вернёт null,
// а движок пойдёт веткой «создано» с пустой ссылкой.
export interface LinkInput {
  provider: PaymentProvider;
  config: PaymentConfig;
  secrets: PaymentSecrets;
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  botWebhookBase: string;
  connectionId: string;
}

// Собрать checkout-ссылку. Секреты попадают в URL только для провайдеров, где
// это предусмотрено протоколом (Robokassa — подпись), и никогда — в наши логи.
export async function createCheckoutLink(input: LinkInput): Promise<string | null> {
  const { provider, config, secrets, orderId, amount, currency, description } = input;
  const q = (s: string): string => encodeURIComponent(String(s ?? ''));

  switch (provider) {
    case 'telegram':
      // Счёт Telegram: ссылки нет, выставляет движок через sendInvoice.
      return null;
    case 'yookassa': {
      // WS-02: quickpay-дефолт (yoomoney.ru/quickpay/confirm.xml) удалён —
      // с quickpay-формы вебхук YooKassa API не приходит, платёж не фиксируется
      // (reverify по label не резольвится в /v3/payments). Шаблон обязателен
      // (validateConnectionInput) и работает как у stripe/custom: владелец
      // указывает свой API-checkout с плейсхолдерами. Без шаблона ссылки нет.
      const template = config.linkTemplate || '';
      if (!template) return null;
      return template
        .replace(/\{\{order\}\}/g, q(orderId))
        .replace(/\{\{amount\}\}/g, String(Math.round(amount)))
        .replace(/\{\{currency\}\}/g, q(currency))
        .replace(/\{\{description\}\}/g, q(description))
        .replace(/\{\{success\}\}/g, q(config.successUrl || ''))
        .replace(/\{\{fail\}\}/g, q(config.failUrl || ''));
    }
    case 'robokassa': {
      // Подпись Robokassa: md5(OutSum:InvId:Password1) в нижнем регистре.
      const sum = (Math.round(amount) / 100).toFixed(2);
      const base = `${sum}:${orderId}:${secrets.password1 || ''}`;
      const signature = await md5Hex(base);
      const params = [
        `MerchantLogin=${q(config.shopId || '')}`,
        `OutSum=${sum}`,
        `InvId=${q(orderId)}`,
        `Description=${q(description || orderId)}`,
        `SignatureValue=${signature}`,
        ...(config.testMode ? ['IsTest=1'] : []),
      ].join('&');
      return `https://auth.robokassa.ru/Merchant/Index.aspx?${params}`;
    }
    case 'stripe': {
      const template = config.linkTemplate || 'https://checkout.stripe.com/pay/';
      // Владелец кладёт в linkTemplate свою checkout-сессию; подставляем данные.
      return template
        .replace(/\{\{order\}\}/g, q(orderId))
        .replace(/\{\{amount\}\}/g, String(Math.round(amount)))
        .replace(/\{\{currency\}\}/g, q(currency))
        .replace(/\{\{description\}\}/g, q(description))
        .replace(/\{\{success\}\}/g, q(config.successUrl || ''))
        .replace(/\{\{fail\}\}/g, q(config.failUrl || ''));
    }
    case 'custom':
    default: {
      const template = config.linkTemplate || '';
      if (!template) return null;
      return template
        .replace(/\{\{order\}\}/g, q(orderId))
        .replace(/\{\{amount\}\}/g, String(Math.round(amount)))
        .replace(/\{\{currency\}\}/g, q(currency))
        .replace(/\{\{description\}\}/g, q(description))
        .replace(/\{\{success\}\}/g, q(config.successUrl || ''))
        .replace(/\{\{fail\}\}/g, q(config.failUrl || ''));
    }
  }
}

// ------------------------------------------------------------------ вебхуки

export interface WebhookVerifyInput {
  provider: PaymentProvider;
  connectionId: string;
  botId: string;
  // Публичный путь подключения — часть URL для custom/Robokassa.
  webhookPath: string;
  config: PaymentConfig;
  secrets: PaymentSecrets;
  headers: Headers;
  rawBody: string;
  query: URLSearchParams;
  clientIp: string | null;
  now: number;
}

export interface WebhookResult {
  /** ok=false: подпись не совпала или событие устарело — писать в базу нельзя. */
  ok: boolean;
  /** HTTP-код ответа провайдеру. 2xx — принято, 4xx — отклонено. Никогда не 5xx. */
  httpStatus: number;
  /** Внутренний внешний id заказа (InvId/label/orderId). */
  externalId?: string;
  /** Статус платежа из тела события. */
  paymentStatus?: 'paid' | 'failed' | 'pending' | 'cancelled';
  /** Сумма из тела — её обязательно сверяем со stored order. */
  amount?: number;
  currency?: string;
  reason?: string;
}

// Окно отсечения повторов: событие старше 5 минут считаем повтором (replay).
const REPLAY_WINDOW_MS = 5 * 60_000;

// Проверка подписи ДО любой работы с базой. Порядок обязателен: сначала
// подпись, потом разбор тела и суммы — иначе подделанное событие успело бы
// изменить состояние до отказа.
export async function verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
  const { provider, headers, rawBody, query, secrets } = input;

  switch (provider) {
    // Telegram Payments внешнего вебхука не имеет: оплата приходит апдейтом
    // successful_payment в webhook бота, а не сюда.
    case 'telegram':
      return { ok: false, httpStatus: 404, reason: 'платежи Telegram приходят в вебхук бота, а не сюда' };

    case 'yookassa': {
      // ЮKassa не подписывает тело; рекомендуемый способ — сверять IP отправителя
      // и перепроверять сумму/статус через их API. API-перепроверка живёт в
      // index.ts (нужен fetch); здесь только структурный разбор + дата события.
      const body = parseJsonObject(rawBody);
      if (!body) return { ok: false, httpStatus: 400, reason: 'тело не JSON' };
      const event = String(body.event ?? '');
      const obj = (body.object ?? {}) as Record<string, unknown>;
      const createdAt = String(obj.created_at ?? '');
      if (createdAt) {
        const ts = Date.parse(createdAt);
        if (Number.isFinite(ts) && input.now - ts > REPLAY_WINDOW_MS) {
          return { ok: false, httpStatus: 400, reason: 'событие устарело' };
        }
      }
      const paymentStatus = event === 'payment.succeeded' ? 'paid' : event === 'payment.canceled' ? 'cancelled' : 'pending';
      const amountObj = (obj.amount ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        httpStatus: 200,
        externalId: String(obj.metadata && (obj.metadata as any).order_id ? (obj.metadata as any).order_id : obj.id ?? ''),
        paymentStatus,
        // ЮKassa отдаёт сумму в рублях с копейками; переводим в минимальные единицы.
        amount: amountObj.value != null ? Math.round(Number(amountObj.value) * 100) : undefined,
        currency: String(amountObj.currency ?? 'RUB'),
      };
    }

    case 'robokassa': {
      // Result URL: OutSum / InvId / SignatureValue в query.
      // Подпись: md5(OutSum:InvId:Password2), сравнение constant-time.
      const outSum = query.get('OutSum') ?? '';
      const invId = query.get('InvId') ?? '';
      const signature = (query.get('SignatureValue') ?? '').toLowerCase();
      if (!outSum || !invId || !signature) return { ok: false, httpStatus: 400, reason: 'нет полей подписи' };
      const expected = await md5Hex(`${outSum}:${invId}:${secrets.password2 || ''}`);
      if (!safeEqual(expected, signature)) return { ok: false, httpStatus: 400, reason: 'подпись не совпала' };
      return {
        ok: true,
        httpStatus: 200,
        externalId: invId,
        paymentStatus: 'paid',
        // OutSum — рубли с копейками; в минимальные единицы.
        amount: Math.round(Number(outSum) * 100),
        currency: 'RUB',
      };
    }

    case 'stripe': {
      // Заголовок Stripe-Signature: t=<unix>,v1=<hmac>. Подпись считается по
      // строке «<t>.<rawBody>» ключом signing secret подключения.
      const header = headers.get('stripe-signature') || '';
      const parts = new Map<string, string>();
      for (const chunk of header.split(',')) {
        const [k, v] = chunk.split('=');
        if (k && v) parts.set(k.trim(), v.trim());
      }
      const t = parts.get('t') || '';
      const v1 = (parts.get('v1') || '').toLowerCase();
      if (!t || !v1) return { ok: false, httpStatus: 400, reason: 'нет заголовка подписи' };
      const ts = Number(t) * 1000;
      if (Number.isFinite(ts) && input.now - ts > REPLAY_WINDOW_MS) {
        return { ok: false, httpStatus: 400, reason: 'событие устарело' };
      }
      // Пустой signing secret недопустим: WebCrypto бросает DataError на ключе
      // нулевой длины, а verifyWebhook обязан возвращать результат, а не исключение.
      if (!secrets.webhookSecret) return { ok: false, httpStatus: 400, reason: 'подключение без signing secret' };
      const expected = await hmacHex(secrets.webhookSecret, `${t}.${rawBody}`);
      if (!safeEqual(expected, v1)) return { ok: false, httpStatus: 400, reason: 'подпись не совпала' };
      const body = parseJsonObject(rawBody);
      const obj = (body?.data?.object ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        httpStatus: 200,
        externalId: String((obj.metadata as any)?.order_id ?? obj.id ?? ''),
        paymentStatus: String(body?.type ?? '').includes('succeeded') ? 'paid' : 'pending',
        amount: obj.amount_total != null ? Number(obj.amount_total) : obj.amount != null ? Number(obj.amount) : undefined,
        currency: String(obj.currency ?? '').toUpperCase() || undefined,
      };
    }

    case 'custom':
    default: {
      // Наш собственный контракт: HMAC-SHA256 по СЫРОМУ телу в X-Signature,
      // плюс ОБЯЗАТЕЛЬНЫЙ X-Timestamp для защиты от повторов (окно 5 минут).
      // WS-06: без X-Timestamp подпись отклоняется — иначе перехваченное
      // событие можно повторять вечно, replay-окно не работает.
      const signature = (headers.get('x-signature') || '').toLowerCase();
      if (!signature) return { ok: false, httpStatus: 400, reason: 'нет заголовка X-Signature' };
      // См. stripe: без секрета WebCrypto бросит исключение — отказываем сами.
      if (!secrets.webhookSecret) return { ok: false, httpStatus: 400, reason: 'подключение без signing secret' };
      const tsRaw = headers.get('x-timestamp') || '';
      if (!tsRaw) return { ok: false, httpStatus: 400, reason: 'нет заголовка X-Timestamp' };
      const ts = Number(tsRaw) * 1000;
      if (!Number.isFinite(ts) || input.now - ts > REPLAY_WINDOW_MS) {
        return { ok: false, httpStatus: 400, reason: 'событие устарело' };
      }
      const expected = await hmacHex(secrets.webhookSecret, rawBody);
      if (!safeEqual(expected, signature)) return { ok: false, httpStatus: 400, reason: 'подпись не совпала' };
      const body = parseJsonObject(rawBody);
      if (!body) return { ok: false, httpStatus: 400, reason: 'тело не JSON' };
      const statusRaw = String(body.status ?? '').toLowerCase();
      const paymentStatus: WebhookResult['paymentStatus'] =
        statusRaw === 'paid' || statusRaw === 'succeeded'
          ? 'paid'
          : statusRaw === 'cancelled' || statusRaw === 'canceled'
          ? 'cancelled'
          : statusRaw === 'failed'
          ? 'failed'
          : 'pending';
      return {
        ok: true,
        httpStatus: 200,
        externalId: String(body.orderId ?? body.order_id ?? body.id ?? ''),
        paymentStatus,
        amount: body.amount != null ? Math.round(Number(body.amount)) : undefined,
        currency: body.currency != null ? String(body.currency).toUpperCase() : undefined,
      };
    }
  }
}

function parseJsonObject(raw: string): any | null {
  try {
    const v = JSON.parse(raw || '');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ md5

// MD5 нужен только Robokassa (их протокол подписи). В WebCrypto MD5 нет,
// поэтому берём компактную реализацию; используется ТОЛЬКО для совместимости
// с провайдером, не для защиты своих данных.
export async function md5Hex(input: string): Promise<string> {
  const bytes = new Uint8Array(enc.encode(input));
  return md5Bytes(bytes);
}

// md5 в виде «руками» — алгоритм по RFC 1321, таблицы K и сдвиги.
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K: number[] = [];
for (let i = 0; i < 64; i++) MD5_K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

function md5Bytes(input: Uint8Array): string {
  const withPad = new Uint8Array(((input.length + 8) >> 6) * 64 + 64);
  withPad.set(input);
  withPad[input.length] = 0x80;
  const bitLen = input.length * 8;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, bitLen >>> 0, true);
  view.setUint32(withPad.length - 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < withPad.length; chunk += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(chunk + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      f = (f + A + MD5_K[i] + m[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(f, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  const bytes = new Uint8Array(out.buffer);
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// Не используется напрямую, но нужно тестам на контракт подписи: проверка, что
// шестнадцатеричная строка вообще корректна.
export function hexLooksValid(hex: string): boolean {
  return /^[0-9a-f]+$/i.test(String(hex ?? '')) && String(hex).length % 2 === 0;
}

// Разбор секретов из base64-блоба невозможен без ключа шифрования: это делает
// index.ts через crypto.ts. Здесь оставлены помощники только для тестов.
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b: string): Uint8Array {
  return b64ToBytes(b);
}

export { fromHex };

// ---------------------------------------------- валидация и живая проверка подключения

// Проблема подключения. field — ключ поля ровно как его знает форма фронтенда
// (config: shopId | successUrl | failUrl | linkTemplate; secrets: providerToken |
// secretKey | password1 | password2 | webhookSecret) либо '' для провайдерской
// ошибки. message — короткая честная строка для UI: БЕЗ значений полей, чтобы
// секреты не утекли ни в ответ, ни в журнал.
export interface ConnectionProblem {
  field: string;
  kind: 'format' | 'provider' | 'missing';
  message: string;
}

// Есть ли у провайдера read-only API для проверки ключей. Telegram Payments
// проверяет токен только в момент sendInvoice, у custom внешнего API нет —
// для них честный предел это форматная валидация.
export function checkModeFor(provider: PaymentProvider): 'live' | 'format-only' {
  return provider === 'yookassa' || provider === 'stripe' || provider === 'robokassa' ? 'live' : 'format-only';
}

const KEY_CHARSET_RE = /^[A-Za-z0-9_:.-]+$/;
const WHITESPACE_RE = /\s/;
const YOOKASSA_SHOPID_RE = /^\d{4,20}$/;
const ROBOKASSA_SHOPID_RE = /^[A-Za-z0-9]{3,30}$/;
const TEMPLATE_PLACEHOLDERS = ['order', 'amount', 'currency', 'description', 'success', 'fail'];

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

// Чистая форматная валидация подключения: никаких сетевых запросов. Правила
// провайдер-скоупные — от Stripe не требуется то, что нужно ЮKassa. Пустое
// обязательное поле → kind 'missing', мусор в заполненном → kind 'format'.
export function validateConnectionInput(input: {
  provider: PaymentProvider;
  config: PaymentConfig;
  secrets: PaymentSecrets;
}): { problems: ConnectionProblem[] } {
  const { provider, config, secrets } = input;
  const problems: ConnectionProblem[] = [];

  // Секреты-ключи (providerToken, secretKey): без пробелов, только
  // [A-Za-z0-9_:.-], длина не короче 8.
  const keySecret = (field: 'providerToken' | 'secretKey', missingMessage: string): void => {
    const v = str(secrets[field]);
    if (!v) {
      problems.push({ field, kind: 'missing', message: missingMessage });
      return;
    }
    if (WHITESPACE_RE.test(v) || !KEY_CHARSET_RE.test(v) || v.length < 8) {
      problems.push({ field, kind: 'format', message: 'ключ без пробелов, от 8 символов, только буквы, цифры и _ : . -' });
    }
  };

  // Пароли и webhook-секреты: набор символов не ограничиваем, но без
  // пробелов и не короче 8.
  const passSecret = (field: 'password1' | 'password2' | 'webhookSecret', missingMessage: string): void => {
    const v = str(secrets[field]);
    if (!v) {
      problems.push({ field, kind: 'missing', message: missingMessage });
      return;
    }
    if (WHITESPACE_RE.test(v) || v.length < 8) {
      problems.push({ field, kind: 'format', message: 'без пробелов, не короче 8 символов' });
    }
  };

  // successUrl/failUrl необязательны у всех, но если заданы — полный URL по
  // https (http терпим только для локальной отладки).
  const optionalUrl = (field: 'successUrl' | 'failUrl'): void => {
    const v = str(config[field]);
    if (!v) return;
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      problems.push({ field, kind: 'format', message: 'нужен полный URL, например https://site.ru/ok' });
      return;
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
      problems.push({ field, kind: 'format', message: 'нужен адрес по https' });
    }
  };

  // Шаблон ссылки: абсолютный URL, хотя бы один известный плейсхолдер,
  // неизвестные {{...}} отклоняются (движок их не подставит).
  const linkTemplateField = (required: boolean): void => {
    const v = str(config.linkTemplate);
    if (!v) {
      if (required) problems.push({ field: 'linkTemplate', kind: 'missing', message: 'не задан шаблон ссылки' });
      return;
    }
    try {
      new URL(v);
    } catch {
      problems.push({ field: 'linkTemplate', kind: 'format', message: 'шаблон должен быть абсолютным URL' });
      return;
    }
    const found = Array.from(v.matchAll(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g), (m) => m[1]);
    if (found.some((name) => !TEMPLATE_PLACEHOLDERS.includes(name))) {
      problems.push({ field: 'linkTemplate', kind: 'format', message: 'неизвестный плейсхолдер в шаблоне' });
    }
    if (!found.some((name) => TEMPLATE_PLACEHOLDERS.includes(name))) {
      problems.push({ field: 'linkTemplate', kind: 'format', message: 'в шаблоне нет ни одного плейсхолдера' });
    }
  };

  switch (provider) {
    case 'telegram':
      keySecret('providerToken', 'не задан provider_token из BotFather');
      break;
    case 'yookassa': {
      const shopId = str(config.shopId);
      if (!shopId) problems.push({ field: 'shopId', kind: 'missing', message: 'не задан shopId' });
      else if (!YOOKASSA_SHOPID_RE.test(shopId)) problems.push({ field: 'shopId', kind: 'format', message: 'shopId — от 4 до 20 цифр' });
      keySecret('secretKey', 'не задан секретный ключ');
      // WS-02: без linkTemplate подключения больше нет — дефолтная quickpay-форма
      // не совместима с вебхуком (платёж не фиксируется).
      if (!str(config.linkTemplate)) {
        problems.push({
          field: 'linkTemplate',
          kind: 'missing',
          message:
            'не задан шаблон ссылки на оплату: укажите адрес платёжной страницы ЮKassa, созданной через их API (с вебхуками /v3/payments), с плейсхолдерами, например {{order}} и {{amount}}. Ссылка вида yoomoney.ru/quickpay не подходит — с неё вебхук не приходит и оплата не отмечается',
        });
      } else {
        linkTemplateField(false);
      }
      break;
    }
    case 'robokassa': {
      const shopId = str(config.shopId);
      if (!shopId) problems.push({ field: 'shopId', kind: 'missing', message: 'не задан MerchantLogin' });
      else if (!ROBOKASSA_SHOPID_RE.test(shopId)) problems.push({ field: 'shopId', kind: 'format', message: 'MerchantLogin — от 3 до 30 латинских букв или цифр' });
      passSecret('password1', 'не задан Password1');
      passSecret('password2', 'не задан Password2');
      break;
    }
    case 'stripe':
      keySecret('secretKey', 'не задан секретный ключ');
      passSecret('webhookSecret', 'не задан signing secret');
      linkTemplateField(false);
      break;
    case 'custom':
    default:
      passSecret('webhookSecret', 'не задан секрет подписи');
      linkTemplateField(true);
      break;
  }

  optionalUrl('successUrl');
  optionalUrl('failUrl');

  return { problems };
}

// --------------------------------------------------------- живая проверка

export type LiveCheckOutcome = 'verified' | 'rejected' | 'error' | 'unreachable';

export interface LiveCheckResult {
  outcome: LiveCheckOutcome;
  /** HTTP-статус ответа провайдера, если запрос вообще дошёл. */
  providerStatus?: number;
  /** Короткая строка для UI/журнала. Никогда не содержит ключей и тела ответа. */
  message: string;
}

const CHECK_TIMEOUT_MS = 10_000;
const CHECK_MAX_BYTES = 256 * 1024;
const CHECK_USER_AGENT = 'bots-constructor-check/1.0';

// Чтение тела с жёстким лимитом — по образцу readCapped из index.ts: звать
// res.json()/res.text() по неограниченному телу в изоляте нельзя.
async function readCheckBodyCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > CHECK_MAX_BYTES) throw new Error('ответ провайдера слишком большой');
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
    if (total > CHECK_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('ответ провайдера слишком большой');
    }
    chunks.push(value as Uint8Array);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// Общий маппинг HTTP-статуса. 200 → verified, 401/403 → rejected, остальное →
// error. Никакого «успеха» при любом другом исходе.
function statusOutcome(status: number): LiveCheckResult {
  if (status === 200) return { outcome: 'verified', providerStatus: status, message: 'ключи приняты провайдером' };
  if (status === 401 || status === 403) return { outcome: 'rejected', providerStatus: status, message: 'ключи отклонены провайдером' };
  return { outcome: 'error', providerStatus: status, message: `провайдер вернул ошибку ${status}` };
}

// Живая проверка подключения: ТОЛЬКО read-only GET-запросы к API провайдера с
// таймаутом 10 с и фиксированным User-Agent. Ничего не создаёт, не бронирует и
// не списывает. Сетевой сбой/таймаут → 'unreachable', никогда не 'verified'.
export async function liveCheckConnection(
  provider: PaymentProvider,
  config: PaymentConfig,
  secrets: PaymentSecrets
): Promise<LiveCheckResult> {
  try {
    switch (provider) {
      case 'yookassa': {
        // GET /v3/me — информация о магазине; тело читать не нужно, важен статус.
        const shopId = str(config.shopId);
        const secretKey = str(secrets.secretKey);
        if (!shopId || !secretKey) return { outcome: 'error', message: 'не хватает данных для проверки' };
        const res = await fetch('https://api.yookassa.ru/v3/me', {
          method: 'GET',
          headers: {
            Authorization: `Basic ${btoa(`${shopId}:${secretKey}`)}`,
            'User-Agent': CHECK_USER_AGENT,
          },
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        return statusOutcome(res.status);
      }
      case 'stripe': {
        // GET /v1/balance — самая дешёвая read-only точка с аутентификацией.
        const secretKey = str(secrets.secretKey);
        if (!secretKey) return { outcome: 'error', message: 'не хватает данных для проверки' };
        const res = await fetch('https://api.stripe.com/v1/balance', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'User-Agent': CHECK_USER_AGENT,
          },
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        return statusOutcome(res.status);
      }
      case 'robokassa': {
        // Read-only метод OpStateExt (docs.robokassa.ru, XML-интерфейсы): только
        // спрашивает состояние операции, ничего не создаёт. InvoiceID=0 заведомо
        // не существует, поэтому Code 0 («успех») и 3 («операция не найдена»)
        // означают, что логин и Password2 приняты, а подпись верна.
        // Code 1 — неверная подпись, 2 — мерчант не найден/неактивен → rejected.
        const login = str(config.shopId);
        const password2 = str(secrets.password2);
        if (!login || !password2) return { outcome: 'error', message: 'не хватает данных для проверки' };
        const signature = await md5Hex(`${login}:0:${password2}`);
        const url =
          'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt' +
          `?MerchantLogin=${encodeURIComponent(login)}&InvoiceID=0&Signature=${signature}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': CHECK_USER_AGENT },
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        if (res.status === 401 || res.status === 403) return { outcome: 'rejected', providerStatus: res.status, message: 'ключи отклонены провайдером' };
        if (res.status !== 200) return { outcome: 'error', providerStatus: res.status, message: `провайдер вернул ошибку ${res.status}` };
        const body = await readCheckBodyCapped(res);
        const m = body.match(/<Code>\s*(-?\d+)\s*<\/Code>/i);
        if (!m) return { outcome: 'error', providerStatus: 200, message: 'провайдер вернул неразобранный ответ' };
        const code = Number(m[1]);
        if (code === 0 || code === 3) return { outcome: 'verified', providerStatus: 200, message: 'ключи приняты провайдером' };
        if (code === 1) return { outcome: 'rejected', providerStatus: 200, message: 'ключи отклонены провайдером' };
        if (code === 2) return { outcome: 'rejected', providerStatus: 200, message: 'магазин не найден или не активен' };
        return { outcome: 'error', providerStatus: 200, message: 'провайдер вернул ошибку в ответе' };
      }
      default:
        // telegram/custom: проверять ключи негде, роут сюда и не обращается.
        return { outcome: 'error', message: 'для этого провайдера живая проверка не выполняется' };
    }
  } catch {
    // Сетевой сбой, таймаут, слишком большое тело — ключи НЕ проверены.
    return { outcome: 'unreachable', message: 'провайдер недоступен, ключи не проверены' };
  }
}
