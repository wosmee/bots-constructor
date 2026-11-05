// MsgOps runtime (edit_message / delete_message): разбор цели сообщения и
// классификация ошибок Telegram.
//
// Цель читается из переменной сценария: по умолчанию {{__bot_msg}} — воркер
// кладёт туда id последнего отправленного ботом сообщения (rememberBotMsg в
// worker/src/index.ts, форма { chatId, messageId }). Допустимые формы
// значения: объект { chatId, messageId }, объект { chat_id, message_id },
// JSON-строка такого объекта либо число/числовая строка — тогда это id
// сообщения в чате fallbackChatId. Любая порча → null: блок уходит в ветку
// ошибки, а не правит «что попало».

import { BOT_MSG_VAR } from '../../../../shared/types';

export interface MsgRef {
  chatId: number;
  messageId: number;
}

// Целый id из числа либо непустой числовой строки. NaN, Infinity, дробные,
// null/undefined/були — порча (Number(null) === 0 ловить нельзя).
function intOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

export function resolveMsgRef(
  vars: Record<string, any>,
  msgRefVar: string | undefined,
  fallbackChatId: number | null | undefined
): MsgRef | null {
  const name = msgRefVar || BOT_MSG_VAR;
  let raw = vars?.[name];
  if (raw == null) return null;
  // JSON-строка объекта — распарсить; непарсящееся содержимое ниже отсечёт
  // числовая ветка ('abc' → Number → NaN → null).
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        raw = JSON.parse(s);
      } catch {
        return null;
      }
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { chatId?: unknown; messageId?: unknown; chat_id?: unknown; message_id?: unknown };
    // chatId может отсутствовать (переменную собрал автор) — тогда чат из
    // fallback, как в pushDeletes движка. message_id обязателен всегда.
    const chatId = intOf(o.chatId ?? o.chat_id ?? fallbackChatId);
    const messageId = intOf(o.messageId ?? o.message_id);
    if (chatId == null || messageId == null) return null;
    return { chatId, messageId };
  }
  // Число либо числовая строка: id сообщения в текущем чате.
  if (typeof raw === 'number' || typeof raw === 'string') {
    const chatId = intOf(fallbackChatId);
    const messageId = intOf(raw);
    if (chatId == null || messageId == null) return null;
    return { chatId, messageId };
  }
  return null;
}

// Тексты Telegram про «сообщение уже не правится»: старше 48 часов, удалено
// или недоступно в этом чате. Совпадение по подстроке, регистр не важен.
const TOO_OLD_MARKERS = [
  "message can't be edited",
  'message to edit not found',
  'message is too old',
];

// Ошибка «цель устарела/не найдена». До воркера ошибка Telegram доходит в
// двух формах: тело ответа { ok: false, error_code, description } (tgCall →
// res.json(), см. worker/src/index.ts) либо Error с текстом в message.
// Для формы тела код, если он есть, обязан быть 400.
export function isTooOldError(err: any): boolean {
  if (!err) return false;
  let text: string;
  if (err instanceof Error) {
    text = String(err.message ?? '');
  } else if (typeof err === 'object') {
    if (err.ok === true) return false;
    if (err.error_code !== undefined && Number(err.error_code) !== 400) return false;
    text = String(err.description ?? '');
  } else {
    return false;
  }
  const t = text.toLowerCase();
  return TOO_OLD_MARKERS.some((m) => t.includes(m));
}
