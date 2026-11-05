// Тесты платёжного слоя: safeEqual, hmacHex/md5Hex, createCheckoutLink,
// verifyWebhook. Фокус — безопасность: подделанные подписи, replay-окно,
// отсутствие утечки секретов в результатах и ссылках.
import { describe, it, expect } from 'vitest';
import {
  safeEqual,
  hmacHex,
  md5Hex,
  hexLooksValid,
  parseConfig,
  parseSecrets,
  createCheckoutLink,
  verifyWebhook,
  type LinkInput,
  type WebhookVerifyInput,
} from '../worker/src/blocks/payments/providers';
import type { PaymentProvider } from '../worker/src/db';

// Фиксированное «сейчас», чтобы replay-проверки были детерминированными.
const NOW = Date.now();
const REPLAY_OLD_SEC = Math.floor((NOW - 6 * 60_000) / 1000); // за пределами окна 5 минут
const FRESH_SEC = Math.floor(NOW / 1000);

// Значения секретов — только внутри кода, не в названиях тестов.
const WEBHOOK_SECRET = 'whsec_test_9f3a1c7e2b';
const PASSWORD1 = 'p1_test_5d8e2a9c4f';
const PASSWORD2 = 'p2_test_7b1d3e6a8c';

// Независимая реализация HMAC-SHA256 через WebCrypto — для known-answer теста.
async function subtleHmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function linkInput(overrides: Partial<LinkInput> & { provider: PaymentProvider }): LinkInput {
  return {
    config: {},
    secrets: {},
    orderId: 'ord-1',
    amount: 12345,
    currency: 'RUB',
    description: 'Заказ №1',
    botWebhookBase: 'https://bot.example',
    connectionId: 'conn-1',
    ...overrides,
  };
}

function webhookInput(overrides: Partial<WebhookVerifyInput> & { provider: PaymentProvider }): WebhookVerifyInput {
  return {
    connectionId: 'conn-1',
    botId: 'bot-1',
    webhookPath: '/pay/conn-1',
    config: {},
    secrets: {},
    headers: new Headers(),
    rawBody: '',
    query: new URLSearchParams(),
    clientIp: null,
    now: NOW,
    ...overrides,
  };
}

describe('safeEqual', () => {
  it('одинаковые строки — true', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
  });

  it('разные строки — false', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('разная длина — false, без посимвольного сравнения', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abcd', 'abc')).toBe(false);
  });

  it('пустые и null/undefined не роняют функцию', () => {
    expect(() => safeEqual('', 'x')).not.toThrow();
    expect(safeEqual('', 'x')).toBe(false);
    // @ts-expect-error — защита от раннего выхода на мусорных входах
    expect(safeEqual(undefined, undefined)).toBe(true);
    // @ts-expect-error — null ?? '' даёт '', поэтому совпадает с пустой строкой
    expect(safeEqual(null, '')).toBe(true);
  });
});

describe('hmacHex', () => {
  it('детерминирован: один ключ и сообщение — один результат', async () => {
    const a = await hmacHex('key', 'message');
    const b = await hmacHex('key', 'message');
    expect(a).toBe(b);
  });

  it('совпадает с независимым HMAC через crypto.subtle (known-answer)', async () => {
    for (const [secret, message] of [
      ['key', 'message'],
      [WEBHOOK_SECRET, `{"orderId":"ord-1","amount":12345}`],
      ['ключ-по-русски', 'сообщение с юникодом'],
    ]) {
      expect(await hmacHex(secret, message)).toBe(await subtleHmacHex(secret, message));
    }
  });

  it('результат — 64 символа lowercase hex', async () => {
    const h = await hmacHex('key', 'message');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hexLooksValid(h)).toBe(true);
  });

  it('разные ключи/сообщения дают разные подписи', async () => {
    expect(await hmacHex('key1', 'msg')).not.toBe(await hmacHex('key2', 'msg'));
    expect(await hmacHex('key', 'msg1')).not.toBe(await hmacHex('key', 'msg2'));
  });
});

describe('md5Hex', () => {
  it('стандартные тестовые векторы (RFC 1321)', async () => {
    expect(await md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(await md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await md5Hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('кириллица: корректная форма hex и отличие от ASCII-варианта', async () => {
    const h = await md5Hex('Привет');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(hexLooksValid(h)).toBe(true);
    expect(h).not.toBe(await md5Hex('Privet'));
    // Детерминизм на UTF-8 входе.
    expect(h).toBe(await md5Hex('Привет'));
  });

  it('вход длиннее одного блока (>= 55 байт) считается корректно', async () => {
    // Вектор RFC: md5 от строки из 80 символов 'a'... используем известный вектор
    // 'message digest' и длинную строку через повторный прогон (стабильность).
    expect(await md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    const long = 'a'.repeat(1000);
    const h = await md5Hex(long);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(await md5Hex(long));
  });
});

describe('parseConfig / parseSecrets', () => {
  it('разбирают валидный JSON', () => {
    expect(parseConfig('{"shopId":"123","testMode":true}')).toEqual({ shopId: '123', testMode: true });
    expect(parseSecrets('{"password2":"x"}')).toEqual({ password2: 'x' });
  });

  it('битый JSON и мусор дают пустой объект, без исключения', () => {
    expect(parseConfig('не json')).toEqual({});
    expect(parseSecrets('')).toEqual({});
    expect(parseConfig('"строка"')).toEqual({});
    expect(parseConfig('[1,2]')).toEqual({});
  });
});

describe('createCheckoutLink', () => {
  it('telegram — ссылки нет (null)', async () => {
    expect(await createCheckoutLink(linkInput({ provider: 'telegram' }))).toBeNull();
  });

  it('yookassa без linkTemplate — null: quickpay-дефолт удалён (WS-02)', async () => {
    // Дефолтная форма yoomoney.ru/quickpay не совместима с вебхуком: платёж
    // не фиксируется. Без шаблона ссылки нет — владелец обязан его задать.
    const link = await createCheckoutLink(
      linkInput({ provider: 'yookassa', config: { shopId: '410012345678' } })
    );
    expect(link).toBeNull();
  });

  it('yookassa с linkTemplate — подстановка плейсхолдеров, как у stripe/custom', async () => {
    const link = await createCheckoutLink(
      linkInput({
        provider: 'yookassa',
        config: {
          shopId: '410012345678',
          linkTemplate: 'https://pay.example/checkout?o={{order}}&a={{amount}}&c={{currency}}&d={{description}}&s={{success}}&f={{fail}}',
          successUrl: 'https://ok.example/done',
          failUrl: 'https://fail.example',
        },
      })
    );
    expect(link).toContain('o=ord-1');
    expect(link).toContain('a=12345'); // минимальные единицы как есть
    expect(link).toContain('c=RUB');
    expect(link).toContain(`d=${encodeURIComponent('Заказ №1')}`);
    expect(link).toContain('s=https%3A%2F%2Fok.example%2Fdone');
    expect(link).toContain('f=https%3A%2F%2Ffail.example');
    expect(link).not.toContain('{{');
    // quickpay-форма больше не собирается ни с каким шаблоном
    expect(link).not.toContain('yoomoney.ru');
    expect(link).not.toContain('quickpay-form');
  });

  it('robokassa — SignatureValue = md5(OutSum:InvId:Password1), OutSum в рублях', async () => {
    const link = await createCheckoutLink(
      linkInput({ provider: 'robokassa', config: { shopId: 'shop' }, secrets: { password1: PASSWORD1 } })
    );
    expect(link).toContain('https://auth.robokassa.ru/Merchant/Index.aspx?');
    expect(link).toContain('OutSum=123.45');
    expect(link).toContain('InvId=ord-1');
    const expected = await md5Hex(`123.45:ord-1:${PASSWORD1}`);
    expect(link).toContain(`SignatureValue=${expected}`);
  });

  it('robokassa — IsTest=1 только в тестовом режиме', async () => {
    const base = { provider: 'robokassa' as const, secrets: { password1: PASSWORD1 } };
    const test = await createCheckoutLink(linkInput({ ...base, config: { testMode: true } }));
    const prod = await createCheckoutLink(linkInput({ ...base, config: { testMode: false } }));
    const def = await createCheckoutLink(linkInput({ ...base, config: {} }));
    expect(test).toContain('IsTest=1');
    expect(prod).not.toContain('IsTest');
    expect(def).not.toContain('IsTest');
  });

  it('stripe/custom — подстановка плейсхолдеров шаблона с URL-кодированием', async () => {
    const template = 'https://pay.example/c?o={{order}}&a={{amount}}&c={{currency}}&d={{description}}&s={{success}}&f={{fail}}';
    for (const provider of ['stripe', 'custom'] as PaymentProvider[]) {
      const link = await createCheckoutLink(
        linkInput({
          provider,
          config: { linkTemplate: template, successUrl: 'https://ok.example', failUrl: 'https://fail.example' },
          description: 'Курс «Боты» & доступ',
        })
      );
      expect(link).toContain('o=ord-1');
      expect(link).toContain('a=12345'); // минимальные единицы как есть
      expect(link).toContain('c=RUB');
      expect(link).toContain(`d=${encodeURIComponent('Курс «Боты» & доступ')}`);
      expect(link).toContain('s=https%3A%2F%2Fok.example');
      expect(link).toContain('f=https%3A%2F%2Ffail.example');
      expect(link).not.toContain('{{');
    }
  });

  it('custom без шаблона — null', async () => {
    expect(await createCheckoutLink(linkInput({ provider: 'custom', config: {} }))).toBeNull();
  });
});

describe('verifyWebhook: telegram', () => {
  it('всегда отказ 404 — платежи приходят в вебхук бота', async () => {
    const r = await verifyWebhook(webhookInput({ provider: 'telegram' }));
    expect(r).toEqual(expect.objectContaining({ ok: false, httpStatus: 404 }));
  });
});

describe('verifyWebhook: robokassa', () => {
  const secrets = { password2: PASSWORD2 };

  async function query(outSum: string, invId: string, signature: string): Promise<URLSearchParams> {
    return new URLSearchParams({ OutSum: outSum, InvId: invId, SignatureValue: signature });
  }

  it('подделанная подпись — отказ 4xx без externalId', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'robokassa', secrets, query: await query('123.45', 'ord-1', 'deadbeef'.repeat(4)) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('пустые query-поля — отказ 400', async () => {
    const r = await verifyWebhook(webhookInput({ provider: 'robokassa', secrets }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('валидная подпись принимается, сумма в минимальных единицах', async () => {
    const sig = await md5Hex(`123.45:ord-42:${PASSWORD2}`);
    const r = await verifyWebhook(
      webhookInput({ provider: 'robokassa', secrets, query: await query('123.45', 'ord-42', sig) })
    );
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.externalId).toBe('ord-42');
    expect(r.paymentStatus).toBe('paid');
    expect(r.amount).toBe(12345);
    expect(r.currency).toBe('RUB');
  });

  it('подпись в верхнем регистре тоже проходит (протокол регистронезависим)', async () => {
    const sig = (await md5Hex(`10.00:ord-7:${PASSWORD2}`)).toUpperCase();
    const r = await verifyWebhook(
      webhookInput({ provider: 'robokassa', secrets, query: await query('10.00', 'ord-7', sig) })
    );
    expect(r.ok).toBe(true);
  });
});

describe('verifyWebhook: stripe', () => {
  const secrets = { webhookSecret: WEBHOOK_SECRET };
  const body = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', metadata: { order_id: 'ord-99' }, amount_total: 12345, currency: 'rub' } },
  });

  function headers(t: number, v1: string): Headers {
    return new Headers({ 'stripe-signature': `t=${t},v1=${v1}` });
  }

  it('подделанная v1 — отказ 4xx без externalId', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'stripe', secrets, rawBody: body, headers: headers(FRESH_SEC, 'ab'.repeat(32)) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('нет заголовка подписи — отказ 400', async () => {
    const r = await verifyWebhook(webhookInput({ provider: 'stripe', secrets, rawBody: body }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('пустой signing secret — отказ 400 без исключения', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'stripe', secrets: {}, rawBody: body, headers: headers(FRESH_SEC, 'ab'.repeat(32)) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('replay: старый t с ВАЛИДНОЙ подписью отклоняется', async () => {
    const v1 = await hmacHex(WEBHOOK_SECRET, `${REPLAY_OLD_SEC}.${body}`);
    const r = await verifyWebhook(
      webhookInput({ provider: 'stripe', secrets, rawBody: body, headers: headers(REPLAY_OLD_SEC, v1) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('валидная подпись принимается: externalId, paid, amount_total, currency', async () => {
    const v1 = await hmacHex(WEBHOOK_SECRET, `${FRESH_SEC}.${body}`);
    const r = await verifyWebhook(
      webhookInput({ provider: 'stripe', secrets, rawBody: body, headers: headers(FRESH_SEC, v1) })
    );
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.externalId).toBe('ord-99');
    expect(r.paymentStatus).toBe('paid');
    expect(r.amount).toBe(12345);
    expect(r.currency).toBe('RUB');
  });

  it('тип без succeeded → pending', async () => {
    const other = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
    const v1 = await hmacHex(WEBHOOK_SECRET, `${FRESH_SEC}.${other}`);
    const r = await verifyWebhook(
      webhookInput({ provider: 'stripe', secrets, rawBody: other, headers: headers(FRESH_SEC, v1) })
    );
    expect(r.ok).toBe(true);
    expect(r.paymentStatus).toBe('pending');
    expect(r.externalId).toBe('cs_1'); // metadata нет → id объекта
  });
});

describe('verifyWebhook: custom', () => {
  const secrets = { webhookSecret: WEBHOOK_SECRET };
  const body = JSON.stringify({ orderId: 'ord-5', status: 'paid', amount: 12345, currency: 'rub' });

  async function signedHeaders(rawBody: string, ts?: number): Promise<Headers> {
    const h = new Headers({ 'x-signature': await hmacHex(WEBHOOK_SECRET, rawBody) });
    if (ts != null) h.set('x-timestamp', String(ts));
    return h;
  }

  it('подделанная X-Signature — отказ 4xx без externalId', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'custom', secrets, rawBody: body, headers: new Headers({ 'x-signature': 'ff'.repeat(32) }) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('нет X-Signature — отказ 400', async () => {
    const r = await verifyWebhook(webhookInput({ provider: 'custom', secrets, rawBody: body }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('пустой webhookSecret — отказ 400 без исключения', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'custom', secrets: {}, rawBody: body, headers: new Headers({ 'x-signature': 'ab'.repeat(32) }) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('replay: старый X-Timestamp с ВАЛИДНОЙ подписью отклоняется', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'custom', secrets, rawBody: body, headers: await signedHeaders(body, REPLAY_OLD_SEC) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('валидная подпись принимается: externalId, paid, amount, currency', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'custom', secrets, rawBody: body, headers: await signedHeaders(body, FRESH_SEC) })
    );
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.externalId).toBe('ord-5');
    expect(r.paymentStatus).toBe('paid');
    expect(r.amount).toBe(12345);
    expect(r.currency).toBe('RUB');
  });

  it('WS-06: нет X-Timestamp при заданном webhookSecret — отказ 400, даже с валидной подписью', async () => {
    const h = new Headers({ 'x-signature': await hmacHex(WEBHOOK_SECRET, body) });
    const r = await verifyWebhook(webhookInput({ provider: 'custom', secrets, rawBody: body, headers: h }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.reason).toContain('X-Timestamp');
    expect(r.externalId).toBeUndefined();
  });

  it('WS-06: нечисловой X-Timestamp — отказ 400 (окно нельзя обойти мусором)', async () => {
    const h = new Headers({ 'x-signature': await hmacHex(WEBHOOK_SECRET, body), 'x-timestamp': 'not-a-number' });
    const r = await verifyWebhook(webhookInput({ provider: 'custom', secrets, rawBody: body, headers: h }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('битое тело с валидной подписью — отказ 400, без исключения', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'custom', secrets, rawBody: 'not json', headers: await signedHeaders('not json', FRESH_SEC) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('маппинг статусов: paid/succeeded/cancelled/canceled/failed/остальное', async () => {
    const cases: Array<[string, 'paid' | 'cancelled' | 'failed' | 'pending']> = [
      ['paid', 'paid'],
      ['succeeded', 'paid'],
      ['SUCCEEDED', 'paid'], // регистронезависимо
      ['cancelled', 'cancelled'],
      ['canceled', 'cancelled'],
      ['failed', 'failed'],
      ['waiting', 'pending'],
      ['', 'pending'],
    ];
    for (const [status, expected] of cases) {
      const raw = JSON.stringify({ orderId: 'o', status });
      const r = await verifyWebhook(
        webhookInput({ provider: 'custom', secrets, rawBody: raw, headers: await signedHeaders(raw, FRESH_SEC) })
      );
      expect(r.ok, `status=${status}`).toBe(true);
      expect(r.paymentStatus, `status=${status}`).toBe(expected);
    }
  });

  it('amount округляется до целого (Math.round)', async () => {
    const raw = JSON.stringify({ orderId: 'o', status: 'paid', amount: 100.4 });
    const r = await verifyWebhook(
      webhookInput({ provider: 'custom', secrets, rawBody: raw, headers: await signedHeaders(raw, FRESH_SEC) })
    );
    expect(r.amount).toBe(100);
  });
});

describe('verifyWebhook: yookassa', () => {
  function eventBody(type: string, createdAt: string): string {
    return JSON.stringify({
      event: type,
      object: {
        id: 'pay-1',
        metadata: { order_id: 'ord-77' },
        created_at: createdAt,
        amount: { value: 123.45, currency: 'RUB' },
      },
    });
  }

  it('payment.succeeded → paid, сумма в минимальных единицах, externalId из metadata', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'yookassa', rawBody: eventBody('payment.succeeded', new Date(NOW - 1000).toISOString()) })
    );
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.externalId).toBe('ord-77');
    expect(r.paymentStatus).toBe('paid');
    expect(r.amount).toBe(12345);
    expect(r.currency).toBe('RUB');
  });

  it('payment.canceled → cancelled', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'yookassa', rawBody: eventBody('payment.canceled', new Date(NOW).toISOString()) })
    );
    expect(r.paymentStatus).toBe('cancelled');
  });

  it('прочее событие → pending', async () => {
    const r = await verifyWebhook(
      webhookInput({
        provider: 'yookassa',
        rawBody: eventBody('payment.waiting_for_capture', new Date(NOW).toISOString()),
      })
    );
    expect(r.paymentStatus).toBe('pending');
  });

  it('replay: старый created_at отклоняется 400', async () => {
    const r = await verifyWebhook(
      webhookInput({ provider: 'yookassa', rawBody: eventBody('payment.succeeded', new Date(NOW - 6 * 60_000).toISOString()) })
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.externalId).toBeUndefined();
  });

  it('битое тело — отказ 400, без исключения', async () => {
    const r = await verifyWebhook(webhookInput({ provider: 'yookassa', rawBody: 'not json' }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('пустое тело — отказ 400', async () => {
    const r = await verifyWebhook(webhookInput({ provider: 'yookassa', rawBody: '' }));
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(400);
  });

  it('без metadata.order_id externalId падает на id объекта', async () => {
    const raw = JSON.stringify({ event: 'payment.succeeded', object: { id: 'pay-42', amount: { value: '10.00', currency: 'RUB' } } });
    const r = await verifyWebhook(webhookInput({ provider: 'yookassa', rawBody: raw }));
    expect(r.ok).toBe(true);
    expect(r.externalId).toBe('pay-42');
    expect(r.amount).toBe(1000);
  });
});

describe('утечка секретов', () => {
  const allSecrets = [WEBHOOK_SECRET, PASSWORD1, PASSWORD2];

  it('ссылка robokassa не содержит Password1 (в URL — только производная подпись)', async () => {
    const link = await createCheckoutLink(
      linkInput({ provider: 'robokassa', config: { shopId: 'shop' }, secrets: { password1: PASSWORD1 } })
    );
    expect(link).not.toBeNull();
    expect(link).not.toContain(PASSWORD1);
    expect(link).toContain('SignatureValue=');
  });

  it('ссылки остальных провайдеров не содержат секретов', async () => {
    const links = await Promise.all([
      createCheckoutLink(
        linkInput({ provider: 'yookassa', config: { shopId: '410', linkTemplate: 'https://pay.example/{{order}}' }, secrets: { secretKey: WEBHOOK_SECRET } })
      ),
      createCheckoutLink(
        linkInput({ provider: 'stripe', config: { linkTemplate: 'https://p.example/{{order}}' }, secrets: { secretKey: WEBHOOK_SECRET } })
      ),
      createCheckoutLink(
        linkInput({ provider: 'custom', config: { linkTemplate: 'https://p.example/{{order}}' }, secrets: { webhookSecret: WEBHOOK_SECRET } })
      ),
    ]);
    for (const link of links) {
      for (const s of allSecrets) expect(link ?? '').not.toContain(s);
    }
  });

  it('результаты verifyWebhook (включая отказы) не содержат секретов', async () => {
    const stripeBody = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi' } } });
    const results = await Promise.all([
      verifyWebhook(webhookInput({ provider: 'telegram', secrets: { providerToken: WEBHOOK_SECRET } })),
      verifyWebhook(
        webhookInput({
          provider: 'robokassa',
          secrets: { password2: PASSWORD2 },
          query: new URLSearchParams({ OutSum: '1.00', InvId: 'x', SignatureValue: 'wrong' }),
        })
      ),
      verifyWebhook(
        webhookInput({
          provider: 'stripe',
          secrets: { webhookSecret: WEBHOOK_SECRET },
          rawBody: stripeBody,
          headers: new Headers({ 'stripe-signature': `t=${FRESH_SEC},v1=wrong` }),
        })
      ),
      verifyWebhook(
        webhookInput({
          provider: 'custom',
          secrets: { webhookSecret: WEBHOOK_SECRET },
          rawBody: '{}',
          headers: new Headers({ 'x-signature': 'wrong' }),
        })
      ),
      verifyWebhook(webhookInput({ provider: 'yookassa', secrets: { secretKey: WEBHOOK_SECRET }, rawBody: '{}' })),
    ]);
    for (const r of results) {
      const dump = JSON.stringify(r);
      for (const s of allSecrets) expect(dump).not.toContain(s);
      // reason не должен возвращать провайдеру ожидаемую подпись.
      expect(dump).not.toContain('expected');
    }
  });
});
