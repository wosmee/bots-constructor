// Webhook-in runtime (блок webhook_in): разложение тела входящего вебхука в
// переменные сценария wh.<field>. Пустой список полей = всё тело целиком в
// wh.body (JSON-текст) — автор сам разбирает его блоками.

import { WH_PREFIX } from '../../../../shared/types';

const BODY_VAR = `${WH_PREFIX}body`;

// Распарсенное JSON-тело → переменные сценария. С полями: читаются ключи
// верхнего уровня объекта; объекты/массивы сериализуются JSON'ом, скаляры
// стрингуются, отсутствующий ключ пропускается (переменная не создаётся —
// условие «переменная существует» не должно срабатывать на undefined).
export function extractWebhookVars(fields: string[] | undefined, body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(fields) || fields.length === 0) {
    const json = JSON.stringify(body);
    out[BODY_VAR] = json === undefined ? String(body) : json;
    return out;
  }
  // Тело-скаляр или null: полей верхнего уровня нет, все f дают undefined.
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  for (const f of fields) {
    const key = String(f ?? '');
    if (!key) continue;
    const val = obj ? obj[key] : undefined;
    if (val === undefined) continue;
    out[WH_PREFIX + key] = val && typeof val === 'object' ? JSON.stringify(val) : String(val);
  }
  return out;
}

// Имя поля → допустимый суффикс переменной wh.<имя>: трим, всё кроме
// [a-zA-Z0-9_] заменяется на '_', подряд идущие '_' схлопываются, длина до 64,
// края без '_'. Кириллица и спецсимволы вычищаются целиком ('!!!' → '').
// Пустой результат — null-семантика: вызывающий фильтрует такое поле.
export function normalizeWebhookField(f: string): string {
  return String(f ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64)
    .replace(/^_+|_+$/g, '');
}
