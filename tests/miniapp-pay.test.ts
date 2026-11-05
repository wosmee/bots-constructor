// Оплата Telegram Stars из мини-аппов (фаза D): sendMiniInvoice.
// F-041: контракт payload — mini:<paymentId> (новый путь) и legacy mini:<botId>:<userId>.
import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  sendMiniInvoice,
  validateMiniInvoice,
  miniPaymentPayload,
  parseMiniPayPayload,
} from '../worker/src/miniapp/payments';

const ENV = { DB: {} as any, KV: {} as any };
const BASE = { botId: 'bot1', token: 'tok', userId: 42, product: 'Премиум', stars: 100 };

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockTg(body: unknown = { ok: true, result: {} }, status = 200) {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchSpy);
  return { fetchSpy };
}

describe('валидация (до сети)', () => {
  it('пустой product → ошибка, fetch не зовётся', async () => {
    const { fetchSpy } = mockTg();
    await expect(sendMiniInvoice(ENV, { ...BASE, product: '' })).rejects.toThrow('pay validation');
    await expect(sendMiniInvoice(ENV, { ...BASE, product: '   ' })).rejects.toThrow('pay validation');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('product длиннее 200 → ошибка', () => {
    expect(() => validateMiniInvoice({ product: 'x'.repeat(201), stars: 5 })).toThrow('pay validation');
    expect(() => validateMiniInvoice({ product: 'x'.repeat(200), stars: 5 })).not.toThrow();
  });

  it('stars 0 → ошибка до сети', async () => {
    const { fetchSpy } = mockTg();
    await expect(sendMiniInvoice(ENV, { ...BASE, stars: 0 })).rejects.toThrow('pay validation');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stars 10001 → ошибка до сети', async () => {
    const { fetchSpy } = mockTg();
    await expect(sendMiniInvoice(ENV, { ...BASE, stars: 10001 })).rejects.toThrow('pay validation');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stars 2.5 (дробное) → ошибка до сети', async () => {
    const { fetchSpy } = mockTg();
    await expect(sendMiniInvoice(ENV, { ...BASE, stars: 2.5 })).rejects.toThrow('pay validation');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stars строкой/NaN/null → ошибка', () => {
    expect(() => validateMiniInvoice({ product: 'p', stars: '100' })).toThrow('pay validation');
    expect(() => validateMiniInvoice({ product: 'p', stars: NaN })).toThrow('pay validation');
    expect(() => validateMiniInvoice({ product: 'p', stars: null })).toThrow('pay validation');
  });

  it('границы 1 и 10000 проходят', () => {
    expect(() => validateMiniInvoice({ product: 'p', stars: 1 })).not.toThrow();
    expect(() => validateMiniInvoice({ product: 'p', stars: 10000 })).not.toThrow();
  });
});

describe('успешный путь', () => {
  it('sendInvoice: XTR, amount = stars, payload с botId+userId', async () => {
    const { fetchSpy } = mockTg();
    await sendMiniInvoice(ENV, BASE);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(String(url)).toBe('https://api.telegram.org/bottok/sendInvoice');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe(42);
    expect(body.currency).toBe('XTR');
    expect(body.prices).toEqual([{ label: 'Премиум', amount: 100 }]);
    expect(body.payload).toBe('mini:bot1:42');
    expect(body.title).toBe('Премиум');
    expect(init.headers['user-agent']).toBe('bots-constructor/1.0');
  });

  it('HTTP 500 → ошибка pay upstream', async () => {
    mockTg({ ok: false }, 500);
    await expect(sendMiniInvoice(ENV, BASE)).rejects.toThrow(/pay upstream 500/);
  });

  it('ok:false в теле при 200 → ошибка rejected', async () => {
    mockTg({ ok: false, description: 'BOT_PAYMENTS_DISABLED' });
    await expect(sendMiniInvoice(ENV, BASE)).rejects.toThrow(/pay upstream rejected/);
  });
});

describe('F-041: payload mini_payments', () => {
  it('с paymentId → payload mini:<paymentId>', async () => {
    const { fetchSpy } = mockTg();
    await sendMiniInvoice(ENV, { ...BASE, paymentId: 'pay-uuid-1' });
    const body = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(body.payload).toBe('mini:pay-uuid-1');
  });

  it('без paymentId → легаси mini:<botId>:<userId> (обратная совместимость)', async () => {
    const { fetchSpy } = mockTg();
    await sendMiniInvoice(ENV, BASE);
    const body = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(body.payload).toBe('mini:bot1:42');
  });

  it('miniPaymentPayload: префикс mini: и лимит 128', () => {
    expect(miniPaymentPayload('abc')).toBe('mini:abc');
    expect(miniPaymentPayload('x'.repeat(200)).length).toBe(128);
  });

  it('parseMiniPayPayload: новый формат → id; legacy и чужие → null', () => {
    expect(parseMiniPayPayload('mini:pay-uuid-1')).toBe('pay-uuid-1');
    // legacy mini:<botId>:<userId> — вложенное двоеточие, вебхук его игнорирует
    expect(parseMiniPayPayload('mini:bot1:42')).toBeNull();
    expect(parseMiniPayPayload('mini:')).toBeNull();
    expect(parseMiniPayPayload('order-ext-1')).toBeNull();
    expect(parseMiniPayPayload('')).toBeNull();
    expect(parseMiniPayPayload(undefined)).toBeNull();
    // roundtrip
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(parseMiniPayPayload(miniPaymentPayload(id))).toBe(id);
  });
});
