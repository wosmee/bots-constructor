// Оплата Telegram Stars из мини-аппов (фаза D).
//
// Серверная половина действия { id: 'pay' }: рантайм мини-аппа (spa.ts) шлёт
// POST /m/api/:botId/:slug/action { kind: 'pay', product, stars }, роут зовёт
// sendMiniInvoice, счёт уходит юзеру в личный чат бота (chat_id = userId).
//
// Переиспользование платёжного контура:
//  - Stars-счёт — тот же sendInvoice Telegram Payments, но БЕЗ provider_token
//    (для XTR он не нужен) и с валютой 'XTR', amount в звёздах (1 звезда = 1
//    единица, без копеек);
//  - pre_checkout_query отвечает OK существующий обработчик в index.ts — он
//    unconditional и provider_token не требует, для Stars подходит как есть;
//  - successful_payment приходит в вебхук бота обычным апдейтом.
//
// tgCall из index.ts не экспортирован, поэтому здесь локальный fetch в том же
// стиле (POST JSON, user-agent, таймаут 15 с).

import { TG_INVOICE_TITLE_MAX, TG_INVOICE_DESC_MAX, TG_INVOICE_PAYLOAD_MAX } from '../../../shared/limits';

const TG_TIMEOUT_MS = 15_000; // как tgCall в index.ts

export interface MiniPayEnv {
  DB: D1Database;
  KV: KVNamespace;
}

export interface MiniInvoiceArgs {
  botId: string;
  token: string;
  userId: number;
  product: string;
  stars: number;
  /**
   * F-041: id строки mini_payments (миграция 0029, создаёт интегратор index.ts).
   * Если задан, payload счёта — 'mini:<paymentId>' (уникальный на платёж, по нему
   * вебхук бота находит строку и сверяет сумму). Если нет — легаси-форма
   * 'mini:<botId>:<userId>' (не идемпотентна, сохранена для совместимости).
   */
  paymentId?: string;
}

// Префикс payload мини-платежей: вебхук бота различает по нему счета сценариев
// (externalId payment_orders) и счета мини-аппов (mini_payments).
const MINI_PAYLOAD_PREFIX = 'mini:';

// payload счёта для строки mini_payments: 'mini:<id>' (≤TG_INVOICE_PAYLOAD_MAX символов).
export function miniPaymentPayload(paymentId: string): string {
  return `${MINI_PAYLOAD_PREFIX}${paymentId}`.slice(0, TG_INVOICE_PAYLOAD_MAX);
}

// Разбор payload из pre_checkout_query / successful_payment. Возвращает
// paymentId только для НОВОЙ формы 'mini:<id>' без вложенных двоеточий;
// легаси 'mini:<botId>:<userId>' и чужие payload — null (вебхук игнорирует).
export function parseMiniPayPayload(payload: unknown): string | null {
  const s = String(payload ?? '');
  if (!s.startsWith(MINI_PAYLOAD_PREFIX)) return null;
  const id = s.slice(MINI_PAYLOAD_PREFIX.length);
  if (!id || id.includes(':')) return null;
  return id;
}

// Валидация до сети: product непустой ≤200, stars целое 1..10000.
// Ошибка — исключение с сообщением 'pay validation: ...' (роут мапит в 400).
export function validateMiniInvoice(args: { product: unknown; stars: unknown }): { product: string; stars: number } {
  const product = String(args.product ?? '').trim();
  if (!product) throw new Error('pay validation: product required');
  if (product.length > 200) throw new Error('pay validation: product too long');
  const stars = args.stars;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 10000) {
    throw new Error('pay validation: stars must be an integer 1..10000');
  }
  return { product, stars };
}

export async function sendMiniInvoice(env: MiniPayEnv, args: MiniInvoiceArgs): Promise<void> {
  const { product, stars } = validateMiniInvoice(args);
  void env; // DB/KV зарезервированы под будущие заказы/лимиты; счёт их не требует.

  const res = await fetch(`https://api.telegram.org/bot${args.token}/sendInvoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'bots-constructor/1.0' },
    body: JSON.stringify({
      chat_id: args.userId,
      title: product.slice(0, TG_INVOICE_TITLE_MAX), // лимит Telegram на title счёта
      description: product.slice(0, TG_INVOICE_DESC_MAX),
      // F-041: при заданном paymentId — уникальный payload строки mini_payments.
      payload: args.paymentId
        ? miniPaymentPayload(args.paymentId)
        : `mini:${args.botId}:${args.userId}`.slice(0, TG_INVOICE_PAYLOAD_MAX),
      // Stars: provider_token пустой, валюта XTR, amount — целые звёзды.
      currency: 'XTR',
      prices: [{ label: product.slice(0, 32), amount: stars }],
    }),
    signal: AbortSignal.timeout(TG_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`pay upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!json?.ok) {
    // HTTP 200, но Telegram отклонил счёт (например, бот не включил Payments).
    throw new Error(`pay upstream rejected: ${String(json?.description ?? '').slice(0, 200)}`);
  }
}
