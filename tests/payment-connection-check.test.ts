// Тесты честной проверки платёжного подключения (A1): чистая валидация
// validateConnectionInput и живая read-only проверка liveCheckConnection.
// Стиль — как в tests/payments.test.ts: секреты только в константах, fetch
// мокается через vi.stubGlobal. Роут /check здесь не гоняем — он покрыт
// контрактными ожиданиями ниже через те же функции.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validateConnectionInput,
  checkModeFor,
  liveCheckConnection,
  md5Hex,
  type PaymentConfig,
  type PaymentSecrets,
} from '../worker/src/blocks/payments/providers';
import type { PaymentProvider } from '../worker/src/db';

// Валидные по формату значения — мусор генерим отдельно.
const SECRET_OK = 'sk_live_test_9f3a1c7e2b';
const PASS_OK = 'p@ssw0rd-long-enough';
const TOKEN_OK = '123456:AAH-test_token.value-1';
const YOOKASSA_SHOP_OK = '123456';
const ROBOKASSA_SHOP_OK = 'MyShop01';

function validate(provider: PaymentProvider, config: PaymentConfig = {}, secrets: PaymentSecrets = {}) {
  return validateConnectionInput({ provider, config, secrets });
}

function problemsFor(problems: { field: string; kind: string }[], field: string) {
  return problems.filter((p) => p.field === field);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkModeFor', () => {
  it('telegram и custom — только формат, остальные — живая проверка', () => {
    expect(checkModeFor('telegram')).toBe('format-only');
    expect(checkModeFor('custom')).toBe('format-only');
    expect(checkModeFor('yookassa')).toBe('live');
    expect(checkModeFor('stripe')).toBe('live');
    expect(checkModeFor('robokassa')).toBe('live');
  });
});

describe('validateConnectionInput: мусорный ввод', () => {
  it('пустые обязательные поля → kind missing (сообщения про shopId сохранены)', () => {
    const yk = validate('yookassa', {}, {}).problems;
    expect(problemsFor(yk, 'shopId')[0].kind).toBe('missing');
    expect(problemsFor(yk, 'shopId')[0].message).toContain('не задан shopId');
    expect(problemsFor(yk, 'secretKey')[0].kind).toBe('missing');

    const rb = validate('robokassa', {}, {}).problems;
    expect(problemsFor(rb, 'shopId')[0].kind).toBe('missing');
    expect(problemsFor(rb, 'password1')[0].kind).toBe('missing');
    expect(problemsFor(rb, 'password2')[0].kind).toBe('missing');

    const st = validate('stripe', {}, {}).problems;
    expect(problemsFor(st, 'secretKey')[0].kind).toBe('missing');
    expect(problemsFor(st, 'webhookSecret')[0].kind).toBe('missing');

    const cu = validate('custom', {}, {}).problems;
    expect(problemsFor(cu, 'webhookSecret')[0].kind).toBe('missing');
    expect(problemsFor(cu, 'linkTemplate')[0].kind).toBe('missing');

    const tg = validate('telegram', {}, {}).problems;
    expect(problemsFor(tg, 'providerToken')[0].kind).toBe('missing');
  });

  it('telegram: мусорный токен → format, валидный — ни одной проблемы', () => {
    // Короткие, с пробелами и с недопустимыми символами — всё format.
    for (const bad of ['qwerty', 'abc', '123', 'токен с пробелами', 'ключ+с+плюсами']) {
      const r = validate('telegram', {}, { providerToken: bad }).problems;
      expect(problemsFor(r, 'providerToken')[0]?.kind, bad).toBe('format');
    }
    expect(validate('telegram', {}, { providerToken: TOKEN_OK }).problems).toEqual([]);
  });

  it('yookassa: мусорный shopId → format, короткие/мусорные ключи → format', () => {
    const tpl = { linkTemplate: 'https://pay.example/c?o={{order}}' };
    expect(problemsFor(validate('yookassa', { shopId: 'abc', ...tpl }, { secretKey: SECRET_OK }).problems, 'shopId')[0].kind).toBe('format');
    expect(problemsFor(validate('yookassa', { shopId: '12', ...tpl }, { secretKey: SECRET_OK }).problems, 'shopId')[0].kind).toBe('format');
    expect(problemsFor(validate('yookassa', { shopId: YOOKASSA_SHOP_OK, ...tpl }, { secretKey: 'qwerty' }).problems, 'secretKey')[0].kind).toBe('format');
    expect(problemsFor(validate('yookassa', { shopId: YOOKASSA_SHOP_OK, ...tpl }, { secretKey: 'с пробелом ключ' }).problems, 'secretKey')[0].kind).toBe('format');
    expect(validate('yookassa', { shopId: YOOKASSA_SHOP_OK, ...tpl }, { secretKey: SECRET_OK }).problems).toEqual([]);
  });

  it('WS-02: yookassa без linkTemplate → missing с подсказкой про API-checkout и quickpay', () => {
    const r = validate('yookassa', { shopId: YOOKASSA_SHOP_OK }, { secretKey: SECRET_OK }).problems;
    const link = problemsFor(r, 'linkTemplate')[0];
    expect(link).toBeTruthy();
    expect(link.kind).toBe('missing');
    // Подсказка объясняет, почему дефолта больше нет: quickpay не совместим с вебхуком.
    expect(link.message).toContain('quickpay');
    expect(link.message).toContain('{{order}}');
    // Сообщение без значений полей и секретов.
    expect(link.message).not.toContain(YOOKASSA_SHOP_OK);
    expect(link.message).not.toContain(SECRET_OK);
  });

  it('WS-02: yookassa с мусорным linkTemplate → format (проверяется как у stripe/custom)', () => {
    const notUrl = validate('yookassa', { shopId: YOOKASSA_SHOP_OK, linkTemplate: 'не url' }, { secretKey: SECRET_OK }).problems;
    expect(problemsFor(notUrl, 'linkTemplate')[0].kind).toBe('format');
    const unknown = validate('yookassa', { shopId: YOOKASSA_SHOP_OK, linkTemplate: 'https://p.example/{{foo}}' }, { secretKey: SECRET_OK }).problems;
    expect(problemsFor(unknown, 'linkTemplate')[0].kind).toBe('format');
  });

  it('robokassa: мусорный MerchantLogin → format, мусорные пароли → format', () => {
    expect(problemsFor(validate('robokassa', { shopId: 'ab' }, { password1: PASS_OK, password2: PASS_OK }).problems, 'shopId')[0].kind).toBe('format');
    expect(problemsFor(validate('robokassa', { shopId: 'магазин' }, { password1: PASS_OK, password2: PASS_OK }).problems, 'shopId')[0].kind).toBe('format');
    const r = validate('robokassa', { shopId: ROBOKASSA_SHOP_OK }, { password1: 'abc', password2: '123' }).problems;
    expect(problemsFor(r, 'password1')[0].kind).toBe('format');
    expect(problemsFor(r, 'password2')[0].kind).toBe('format');
    expect(validate('robokassa', { shopId: ROBOKASSA_SHOP_OK }, { password1: PASS_OK, password2: PASS_OK }).problems).toEqual([]);
  });

  it('stripe/custom: короткий webhookSecret → format, мусорный secretKey → format', () => {
    expect(problemsFor(validate('stripe', {}, { secretKey: SECRET_OK, webhookSecret: 'abc' }).problems, 'webhookSecret')[0].kind).toBe('format');
    expect(problemsFor(validate('custom', { linkTemplate: 'https://p.example/{{order}}' }, { webhookSecret: '123' }).problems, 'webhookSecret')[0].kind).toBe('format');
    expect(problemsFor(validate('stripe', {}, { secretKey: 'qwerty', webhookSecret: PASS_OK }).problems, 'secretKey')[0].kind).toBe('format');
  });

  it('сообщения не содержат значений полей (секреты не утекают в UI)', () => {
    const secrets = { secretKey: SECRET_OK, webhookSecret: PASS_OK, password1: PASS_OK, password2: PASS_OK, providerToken: TOKEN_OK };
    const providers: PaymentProvider[] = ['telegram', 'yookassa', 'robokassa', 'stripe', 'custom'];
    for (const provider of providers) {
      const r = validate(provider, { shopId: 'мусор', linkTemplate: 'не url', successUrl: 'qwerty' }, secrets);
      const dump = JSON.stringify(r.problems);
      for (const s of Object.values(secrets)) expect(dump).not.toContain(s);
      expect(dump).not.toContain('мусор');
      expect(dump).not.toContain('qwerty');
    }
  });
});

describe('validateConnectionInput: successUrl/failUrl', () => {
  const base = { providerToken: TOKEN_OK };

  it('необязательны: пусто — нет проблем', () => {
    expect(validate('telegram', {}, base).problems).toEqual([]);
  });

  it('http://localhost проходит, остальной http и мусор — format', () => {
    expect(validate('telegram', { successUrl: 'http://localhost:3000/ok' }, base).problems).toEqual([]);
    for (const bad of ['http://example.com', 'ftp://x', 'qwerty']) {
      const r = validate('telegram', { successUrl: bad, failUrl: bad }, base).problems;
      expect(problemsFor(r, 'successUrl')[0]?.kind, bad).toBe('format');
      expect(problemsFor(r, 'failUrl')[0]?.kind, bad).toBe('format');
    }
  });

  it('https проходит, 127.0.0.1 по http — тоже', () => {
    expect(validate('telegram', { successUrl: 'https://ok.example/done', failUrl: 'http://127.0.0.1/ok' }, base).problems).toEqual([]);
  });
});

describe('validateConnectionInput: linkTemplate', () => {
  it('неизвестный плейсхолдер {{foo}} отклоняется, {{order}} проходит', () => {
    const bad = validate('custom', { linkTemplate: 'https://p.example/{{foo}}' }, { webhookSecret: PASS_OK }).problems;
    expect(problemsFor(bad, 'linkTemplate')[0].kind).toBe('format');

    const ok = validate('custom', { linkTemplate: 'https://p.example/pay?o={{order}}&s={{success}}' }, { webhookSecret: PASS_OK }).problems;
    expect(problemsFor(ok, 'linkTemplate')).toEqual([]);
  });

  it('не-URL и относительный путь отклоняются', () => {
    expect(problemsFor(validate('custom', { linkTemplate: 'не url' }, { webhookSecret: PASS_OK }).problems, 'linkTemplate')[0].kind).toBe('format');
    expect(problemsFor(validate('custom', { linkTemplate: '/pay/{{order}}' }, { webhookSecret: PASS_OK }).problems, 'linkTemplate')[0].kind).toBe('format');
  });

  it('stripe: linkTemplate необязателен, но если задан — проверяется', () => {
    expect(validate('stripe', {}, { secretKey: SECRET_OK, webhookSecret: PASS_OK }).problems).toEqual([]);
    const r = validate('stripe', { linkTemplate: 'https://p.example/{{bar}}' }, { secretKey: SECRET_OK, webhookSecret: PASS_OK }).problems;
    expect(problemsFor(r, 'linkTemplate')[0].kind).toBe('format');
  });
});

// ------------------------------------------------------------- живая проверка

type FetchArgs = { url: string; init: RequestInit };

function stubFetch(handler: (args: FetchArgs) => Promise<Response> | Response): FetchArgs[] {
  const calls: FetchArgs[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return handler({ url: String(url), init });
    })
  );
  return calls;
}

function jsonResponse(status: number, body = '{}'): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('liveCheckConnection: yookassa', () => {
  const config = { shopId: YOOKASSA_SHOP_OK };
  const secrets = { secretKey: SECRET_OK };

  it('200 → verified; запрос на /v3/me с Basic-авторизацией, GET, таймаутом и User-Agent', async () => {
    const calls = stubFetch(() => jsonResponse(200));
    const r = await liveCheckConnection('yookassa', config, secrets);
    expect(r.outcome).toBe('verified');
    expect(r.providerStatus).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.yookassa.ru/v3/me');
    expect(calls[0].init.method).toBe('GET');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Basic ${btoa(`${YOOKASSA_SHOP_OK}:${SECRET_OK}`)}`);
    expect(headers['User-Agent']).toBe('bots-constructor-check/1.0');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    // Секрет не светится ни в URL, ни в message.
    expect(calls[0].url).not.toContain(SECRET_OK);
    expect(r.message).not.toContain(SECRET_OK);
  });

  it('401 → rejected, message про отклонённые ключи, без тела ответа', async () => {
    stubFetch(() => jsonResponse(401, '{"description":"wrong credentials"}'));
    const r = await liveCheckConnection('yookassa', config, secrets);
    expect(r.outcome).toBe('rejected');
    expect(r.providerStatus).toBe(401);
    expect(r.message).toContain('ключи отклонены провайдером');
    expect(r.message).not.toContain('wrong credentials');
  });

  it('500 → error с кодом в message', async () => {
    stubFetch(() => jsonResponse(500));
    const r = await liveCheckConnection('yookassa', config, secrets);
    expect(r.outcome).toBe('error');
    expect(r.message).toContain('500');
  });

  it('сетевой сбой → unreachable и никогда не verified', async () => {
    stubFetch(() => Promise.reject(new Error('network down')));
    const r = await liveCheckConnection('yookassa', config, secrets);
    expect(r.outcome).toBe('unreachable');
    expect(r.outcome).not.toBe('verified');
    expect(r.message).toContain('недоступен');
  });

  it('таймаут (AbortError) → unreachable', async () => {
    stubFetch(() => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    const r = await liveCheckConnection('yookassa', config, secrets);
    expect(r.outcome).toBe('unreachable');
  });
});

describe('liveCheckConnection: stripe', () => {
  const secrets = { secretKey: 'sk_test_abcdef123456' };

  it('200 → verified; GET /v1/balance с Bearer-ключом', async () => {
    const calls = stubFetch(() => jsonResponse(200));
    const r = await liveCheckConnection('stripe', {}, secrets);
    expect(r.outcome).toBe('verified');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/balance');
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${secrets.secretKey}`);
  });

  it('403 → rejected', async () => {
    stubFetch(() => jsonResponse(403));
    const r = await liveCheckConnection('stripe', {}, secrets);
    expect(r.outcome).toBe('rejected');
    expect(r.message).toContain('ключи отклонены провайдером');
  });

  it('reject сети → unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('dns fail')));
    expect((await liveCheckConnection('stripe', {}, secrets)).outcome).toBe('unreachable');
  });
});

describe('liveCheckConnection: robokassa', () => {
  const config = { shopId: ROBOKASSA_SHOP_OK };
  const secrets = { password2: PASS_OK };
  const xml = (code: number) => `<OperationStateResponse><Result><Code>${code}</Code></Result></OperationStateResponse>`;

  it('Code 3 (операция не найдена) → verified: логин и Password2 приняты', async () => {
    const calls = stubFetch(() => jsonResponse(200, xml(3)));
    const r = await liveCheckConnection('robokassa', config, secrets);
    expect(r.outcome).toBe('verified');
    // Read-only OpStateExt с подписью md5(login:0:password2), InvoiceID=0.
    const url = new URL(calls[0].url);
    expect(calls[0].url.startsWith('https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt')).toBe(true);
    expect(url.searchParams.get('MerchantLogin')).toBe(ROBOKASSA_SHOP_OK);
    expect(url.searchParams.get('InvoiceID')).toBe('0');
    expect(url.searchParams.get('Signature')).toBe(await md5Hex(`${ROBOKASSA_SHOP_OK}:0:${PASS_OK}`));
    expect(calls[0].init.method).toBe('GET');
    // Пароль не попадает ни в URL, ни в message.
    expect(calls[0].url).not.toContain(encodeURIComponent(PASS_OK));
    expect(r.message).not.toContain(PASS_OK);
  });

  it('Code 0 → verified', async () => {
    stubFetch(() => jsonResponse(200, xml(0)));
    expect((await liveCheckConnection('robokassa', config, secrets)).outcome).toBe('verified');
  });

  it('Code 1 (неверная подпись) → rejected', async () => {
    stubFetch(() => jsonResponse(200, xml(1)));
    const r = await liveCheckConnection('robokassa', config, secrets);
    expect(r.outcome).toBe('rejected');
    expect(r.message).toContain('ключи отклонены провайдером');
  });

  it('Code 2 (мерчант не найден) → rejected', async () => {
    stubFetch(() => jsonResponse(200, xml(2)));
    expect((await liveCheckConnection('robokassa', config, secrets)).outcome).toBe('rejected');
  });

  it('Code 1000 и непарсящийся XML → error', async () => {
    stubFetch(() => jsonResponse(200, xml(1000)));
    expect((await liveCheckConnection('robokassa', config, secrets)).outcome).toBe('error');
    stubFetch(() => jsonResponse(200, '<html>not a result</html>'));
    expect((await liveCheckConnection('robokassa', config, secrets)).outcome).toBe('error');
  });

  it('HTTP 401 → rejected, прочие 4xx → error с кодом', async () => {
    stubFetch(() => jsonResponse(401));
    expect((await liveCheckConnection('robokassa', config, secrets)).outcome).toBe('rejected');
    stubFetch(() => jsonResponse(503));
    const r = await liveCheckConnection('robokassa', config, secrets);
    expect(r.outcome).toBe('error');
    expect(r.message).toContain('503');
  });

  it('сетевой сбой → unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('reset')));
    expect((await liveCheckConnection('robokassa', config, secrets)).outcome).toBe('unreachable');
  });
});

vi.unstubAllGlobals();
