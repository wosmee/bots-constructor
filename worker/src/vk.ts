// VK-адаптер: переводит исходящие вызовы движка (Telegram-подобные payload)
// в вызовы VK API, и наоборот — входящие события VK в Telegram-форму апдейта.
// Движок остаётся платформенно-чистым: он эмитит {method:'sendMessage', payload:
// {chat_id, text, reply_markup}} — а этот слой решает, как это уйдёт в VK.
//
// Используется только ботами с platform='vk'; Telegram-боты идут через tgCall
// как раньше — ни один их путь не меняется.

const VK_API_BASE = 'https://api.vk.com/method/';
const VK_API_VERSION = '5.199';
const VK_TIMEOUT_MS = 15_000;

export class VkApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(`vk api error ${code}: ${message}`);
    this.name = 'VkApiError';
    this.code = code;
  }
}

// Один вызов VK API: POST form-encoded, access_token ключа сообщества.
// Возвращает разобранный response; ошибки VK ({error:{error_code,...}}) — VkApiError.
export async function vkCall(
  method: string,
  params: Record<string, unknown>,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ access_token: token, v: VK_API_VERSION });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const res = await fetchImpl(VK_API_BASE + method, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'bots-constructor/1.0' },
    body: body.toString(),
    signal: AbortSignal.timeout(VK_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { response?: Record<string, unknown>; error?: { error_code?: number; error_msg?: string } };
  if (data.error) throw new VkApiError(Number(data.error.error_code) || 0, String(data.error.error_msg || 'unknown'));
  return data.response ?? {};
}

// Перевод Telegram-клавиатуры (reply_markup движка) в VK keyboard JSON.
// Inline-кнопки: action.type='callback', payload = callback_data (VK payload
// ограничен ~255 байтами — режем, длинные payload не поддерживаем).
// Reply-раскладка: VK не имеет аналога persistent reply-клавиатуры — кнопки
// становятся строкой inline (one-time по смыслу).
// F3-103: VK допускает максимум 4 action-кнопки в строке — режем строки по
// 4 кнопки (многострочные меню Telegram сохраняют раскладку, а не
// сваливаются в одну строку).
const VK_ROW_MAX_BUTTONS = 4;
function chunkRows<T>(flat: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < flat.length; i += size) rows.push(flat.slice(i, i + size));
  return rows;
}
export function vkKeyboard(replyMarkup: Record<string, unknown> | undefined): string | undefined {
  if (!replyMarkup) return undefined;
  const inline = replyMarkup.inline_keyboard as { text?: string; callback_data?: string; url?: string }[][] | undefined;
  if (Array.isArray(inline)) {
    const buttons = inline
      .flat()
      .map((b) => {
        if (b?.url) {
          return { action: { type: 'open_link', link: b.url, label: String(b.text ?? '').slice(0, 40) } };
        }
        const payload = String(b?.callback_data ?? '').slice(0, 255);
        return { action: { type: 'callback', label: String(b?.text ?? '').slice(0, 40), payload } };
      })
      .filter((b) => b.action.label || b.action.type === 'callback');
    if (!buttons.length) return undefined;
    return JSON.stringify({ inline: true, buttons: chunkRows(buttons, VK_ROW_MAX_BUTTONS) });
  }
  const reply = replyMarkup.keyboard as { text?: string }[][] | undefined;
  if (Array.isArray(reply)) {
    const buttons = reply
      .flat()
      .map((b) => ({ action: { type: 'text', label: String(b?.text ?? '').slice(0, 40) } }))
      .filter((b) => b.action.label);
    if (!buttons.length) return undefined;
    return JSON.stringify({ inline: true, buttons: chunkRows(buttons, VK_ROW_MAX_BUTTONS) });
  }
  return undefined;
}// random_id — идемпотентность messages.send: уникальный на каждую отправку,
// повтор с тем же random_id VK отклоняет как дубль. Обычные сообщения всегда
// уникальны; правка сообщений идёт другим методом.
export function randomId(): number {
  return Math.floor(Math.random() * 2_147_483_646) + 1;
}

// ---------------- загрузка медиа (photos/docs) ----------------
//
// VK не принимает внешние URL вложений: файл нужно скачать, загрузить на
// upload-сервер VK и сохранить (photos.saveMessagesPhoto / docs.save),
// получив attachment вида photo<owner>_<id>_<access_key>. Пробы на реальной
// группе (tmp/vk-upload-probe.mjs, 29.10): фото работает с ключом сообщества
// без peer_id; docs.getMessagesUploadServer у части групп даёт 901 (нет
// права) — там отправляем ссылку текстом (фолбэк в translateOutgoing).

// Скачивание внешнего файла для загрузки в VK. Только https, лимит 5 МБ
// (максимум VK для фото в сообщениях — 50 МБ, но Workers-память дороже),
// проверка content-type по расширению загрузки. Кэша нет: один блок —
// одна загрузка (публика редко повторяет один URL; кэш по хешу URL —
// кандидат на оптимизацию, см. findings).
// F3-113: ручные редиректы с проверкой хоста на каждом шаге (тот же
// SSRF-принцип, что safeFetch http-блока) — redirect:'follow' уводил fetch
// по Location в закрытые адреса в обход блэклиста.
const VK_DOWNLOAD_MAX_REDIRECTS = 3;
function vkBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    h === 'localhost' ||
    h === 'metadata' ||
    h === 'metadata.google.internal' ||
    h === '169.254.169.254' ||
    ['.localhost', '.local', '.internal', '.arpa'].some((s) => h.endsWith(s))
  ) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]?:/i.test(h)) return true;
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  const mapped = h.match(/^::ffff:(.+)$/i);
  if (mapped) {
    const hex = mapped[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return vkBlockedHost(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    return vkBlockedHost(mapped[1]);
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return true;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && (b === 0 || b === 2 || b === 168)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

export async function vkDownloadMedia(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; bytes: Uint8Array; type: string } | { ok: false; reason: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, reason: 'bad url' };
  }
  for (let hop = 0; ; hop++) {
    if (target.protocol !== 'https:') return { ok: false, reason: 'https only' };
    if (vkBlockedHost(target.hostname)) return { ok: false, reason: 'blocked host' };
    let res: Response;
    try {
      res = await fetchImpl(target.toString(), {
        headers: { 'user-agent': 'bots-constructor/1.0' },
        signal: AbortSignal.timeout(VK_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch {
      return { ok: false, reason: 'fetch failed' };
    }
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get('location');
    if (!isRedirect || !location || hop >= VK_DOWNLOAD_MAX_REDIRECTS) {
      if (!res.ok) return { ok: false, reason: `source ${res.status}` };
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > VK_MAX_MEDIA_BYTES) return { ok: false, reason: 'too large' };
      const buf = await res.arrayBuffer().catch(() => null);
      if (!buf || buf.byteLength === 0 || buf.byteLength > VK_MAX_MEDIA_BYTES) {
        return { ok: false, reason: 'too large' };
      }
      const type = String(res.headers.get('content-type') ?? '').toLowerCase();
      return { ok: true, bytes: new Uint8Array(buf), type };
    }
    try {
      target = new URL(location, target);
    } catch {
      return { ok: false, reason: 'bad redirect' };
    }
  }
}

export const VK_MAX_MEDIA_BYTES = 5 * 1024 * 1024;

// Полная цепочка фото: upload-server → multipart 'photo' → save → attachment.
// Возвращает attachment-строку или причину отказа (фолбэк ссылкой).
export async function vkUploadPhoto(
  bytes: Uint8Array,
  groupVkId: number,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; attachment: string } | { ok: false; reason: string }> {
  const srv = await vkCall('photos.getMessagesUploadServer', { group_id: groupVkId }, token, fetchImpl);
  const uploadUrl = String(srv.upload_url ?? '');
  if (!uploadUrl) return { ok: false, reason: 'no upload_url' };
  const form = new FormData();
  form.append('photo', new Blob([bytes as unknown as ArrayBuffer], { type: 'image/jpeg' }), 'photo.jpg');
  const up = await fetchImpl(uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(VK_TIMEOUT_MS) });
  const upData = (await up.json().catch(() => ({}))) as { server?: number; photo?: string; hash?: string };
  if (!upData.server || !upData.photo || !upData.hash) return { ok: false, reason: 'upload rejected' };
  const saved = await vkCall(
    'photos.saveMessagesPhoto',
    { server: upData.server, photo: upData.photo, hash: upData.hash },
    token,
    fetchImpl
  );
  const p = Array.isArray(saved) ? (saved[0] as Record<string, unknown>) : (saved as Record<string, unknown>);
  const ownerId = Number(p?.owner_id);
  const photoId = Number(p?.id);
  if (!Number.isFinite(ownerId) || !Number.isFinite(photoId)) return { ok: false, reason: 'save failed' };
  const accessKey = p?.access_key ? `_${String(p.access_key)}` : '';
  return { ok: true, attachment: `photo${ownerId}_${photoId}${accessKey}` };
}

// Цепочка документа: docs.getMessagesUploadServer (peer_id получателя) →
// multipart 'file' → docs.save. 901 «without permission» — частый случай
// для ключей без docs-права: вызывающий фолбэчит ссылкой.
export async function vkUploadDoc(
  bytes: Uint8Array,
  peerId: number,
  filename: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; attachment: string } | { ok: false; reason: string }> {
  const srv = await vkCall('docs.getMessagesUploadServer', { type: 'doc', peer_id: peerId }, token, fetchImpl);
  const uploadUrl = String(srv.upload_url ?? '');
  if (!uploadUrl) return { ok: false, reason: 'no upload_url' };
  const form = new FormData();
  form.append('file', new Blob([bytes as unknown as ArrayBuffer], { type: 'application/octet-stream' }), filename.slice(0, 64));
  const up = await fetchImpl(uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(VK_TIMEOUT_MS) });
  const upData = (await up.json().catch(() => ({}))) as { file?: string };
  if (!upData.file) return { ok: false, reason: 'upload rejected' };
  const saved = await vkCall('docs.save', { file: upData.file, title: filename.slice(0, 64) }, token, fetchImpl);
  const d = Array.isArray(saved) ? (saved[0] as Record<string, unknown>) : (saved as Record<string, unknown>);
  const ownerId = Number(d?.owner_id);
  const docId = Number(d?.id);
  if (!Number.isFinite(ownerId) || !Number.isFinite(docId)) return { ok: false, reason: 'save failed' };
  const accessKey = d?.access_key ? `_${String(d.access_key)}` : '';
  return { ok: true, attachment: `doc${ownerId}_${docId}${accessKey}` };
}

// ---------------- входящие сообщения с вложениями ----------------

// message_new с фото: VK кладёт attachments[] (photo/video/doc). Извлекаем
// прямые URL крупнейших размеров фото — движку хватит text+photoUrl в
// Telegram-форме (локация VK — object.geo → location-форма TG).
export function vkExtractAttachments(object: Record<string, unknown>): {
  photos: string[];
  geo?: { latitude: number; longitude: number };
} {
  const out: { photos: string[]; geo?: { latitude: number; longitude: number } } = { photos: [] };
  const atts = Array.isArray(object.attachments) ? (object.attachments as Record<string, unknown>[]) : [];
  for (const a of atts) {
    if (a?.type === 'photo') {
      const photo = a.photo as Record<string, unknown> | undefined;
      const sizes = Array.isArray(photo?.sizes) ? (photo!.sizes as Record<string, unknown>[]) : [];
      // Крупный размер: w > z > y > x. VK отдаёт массив с type-метками.
      const pick = (types: string[]) => {
        for (const t of types) {
          const s = sizes.find((x) => x?.type === t);
          if (s && typeof s.url === 'string' && s.url) return s.url as string;
        }
        return null;
      };
      const url = pick(['w', 'z', 'y', 'x', 'm']);
      if (url) out.photos.push(url);
    }
  }
  const geo = object.geo as { coordinates?: string; lat?: number; long?: number } | undefined;
  if (geo) {
    // Два формата: geo.coordinates "lat long" (строка) или geo.lat/long.
    const coords = typeof geo.coordinates === 'string' ? geo.coordinates.split(' ').map(Number) : [];
    const lat = Number.isFinite(coords[0]) ? coords[0] : Number(geo.lat);
    const long = Number.isFinite(coords[1]) ? coords[1] : Number(geo.long);
    if (Number.isFinite(lat) && Number.isFinite(long)) out.geo = { latitude: lat, longitude: long };
  }
  return out;
}

// Перевод исходящего вызова (метод Telegram + payload движка) в вызов VK API.
// Возвращает { method, params } для vkCall, либо null, если на VK вызов
// не имеет смысла (например, answerCallbackQuery обрабатывается отдельно —
// ему нужен event_id из входящего события).
export function translateOutgoing(
  method: string,
  payload: Record<string, unknown>
): { method: string; params: Record<string, unknown> } | null {
  const peerId = Number(payload.chat_id);
  switch (method) {
    case 'sendMessage': {
      const params: Record<string, unknown> = {
        peer_id: peerId,
        message: String(payload.text ?? '').slice(0, 4096),
        random_id: randomId(),
      };
      const kb = vkKeyboard(payload.reply_markup as Record<string, unknown> | undefined);
      if (kb) params.keyboard = kb;
      // VK не поддерживает parse_mode Telegram: текст уходит как есть (плоский).
      return { method: 'messages.send', params };
    }
    case 'editMessageText':
    case 'editMessageReplyMarkup': {
      const params: Record<string, unknown> = {
        peer_id: peerId,
        conversation_message_id: Number(payload.message_id),
        message: String(payload.text ?? ''),
      };
      const kb = vkKeyboard(payload.reply_markup as Record<string, unknown> | undefined);
      if (kb) params.keyboard = kb;
      return { method: 'messages.edit', params };
    }
    // Обычная правка сообщений (в ветке edit_message из engine): VK-клиент
    // шлёт {chatId, messageId, text} (camelCase от движка). Параметр VK — cmid.
    case 'editMessage':
      return {
        method: 'messages.edit',
        params: {
          peer_id: Number(payload.chatId ?? payload.chat_id),
          cmid: Number(payload.messageId ?? payload.message_id),
          message: String(payload.text ?? ''),
          ...(vkKeyboard(payload.reply_markup as Record<string, unknown> | undefined)
            ? { keyboard: vkKeyboard(payload.reply_markup as Record<string, unknown> | undefined) }
            : {}),
        },
      };
    case 'deleteMessage': {
      // VK-клиент delete_message из engine: {chatId, messageId}; прямой
      // deleteMessage: {chat_id, message_id}. message_id VK — conversation_message_id.
      const peer = Number(payload.chatId ?? payload.chat_id);
      const cmid = Number(payload.messageId ?? payload.message_id);
      return {
        method: 'messages.delete',
        params: { peer_id: peer, cmids: String(cmid), delete_for_all: 1 },
      };
    }
    case 'forwardMessage':
    case 'copyMessage': {
      // Пересылка VK: параметр forward (JSON) у messages.send. Движок шлёт
      // {chat_id (куда), from_chat_id (откуда), message_id}. VK различает
      // «переслать» и «копию» одинаково — оба через forward.
      const params: Record<string, unknown> = {
        peer_id: peerId,
        forward: JSON.stringify({
          peer_id: Number(payload.from_chat_id),
          conversation_message_ids: [Number(payload.message_id)],
        }),
        random_id: randomId(),
      };
      return { method: 'messages.send', params };
    }
    case 'sendChatAction':
      // «Печатает…» в VK: setActivity. Не критично — ошибки глотаются вызывающим.
      return { method: 'messages.setActivity', params: { peer_id: peerId, type: 'typing' } };
    default: {
      // sendPhoto/sendVideo/sendDocument (caption) и sendMediaGroup —
      // обрабатываются ДО translateOutgoing в воркере (platformCall:
      // upload-цепочка vkUploadPhoto/vkUploadDoc). Сюда они попадают,
      // только если воркер не смог загрузить (фолбэк текстом с ссылкой).
      // sendPoll, sendInvoice и прочее Telegram-специфичное: текстовый
      // фолбэк при наличии читаемого текста; валидация publish уже не
      // пропускает эти блоки на VK-боте — это страховка рантайма.
      const url = typeof payload.photo === 'string' ? payload.photo : typeof payload.document === 'string' ? payload.document : typeof payload.video === 'string' ? payload.video : '';
      const fallbackText = typeof payload.caption === 'string' ? payload.caption : typeof payload.text === 'string' ? payload.text : '';
      if (url && /^https:\/\//i.test(url)) {
        const text = (fallbackText ? fallbackText + '\n' : '') + url;
        return {
          method: 'messages.send',
          params: { peer_id: peerId, message: text.slice(0, 4096), random_id: randomId() },
        };
      }
      if (fallbackText.trim()) {
        return {
          method: 'messages.send',
          params: { peer_id: peerId, message: fallbackText.slice(0, 4096), random_id: randomId() },
        };
      }
      return null;
    }
  }
}
// Ответ на нажатие callback-кнопки (message_event): showToast — короткое
// уведомление снизу, как answerCallbackQuery у Telegram.
export function vkEventAnswerParams(eventId: string, userId: number, toast?: string): Record<string, unknown> {
  return {
    event_id: eventId,
    user_id: userId,
    peer_id: userId,
    ...(toast ? { flash: 0, tooltip_text: toast.slice(0, 100) } : {}),
  };
}

// ---------------- входящие события VK → Telegram-форма апдейта ----------------

export interface VkEvent {
  type?: string;
  group_id?: number;
  secret?: string;
  object?: Record<string, unknown>;
}

// Новое сообщение (message_new) → Telegram-подобный message-апдейт.
// peer_id в ЛС сообщества = from_id; бот отвечает пользователю тем же peer_id.
// Принимает и вложенную форму api_version 5.131 ({object:{message:{...}}}),
// и плоскую (object передан уже «развернутым» — см. index.ts /vk-роут).
export function vkMessageToTelegramUpdate(object: Record<string, unknown>): Record<string, unknown> {
  const src = object.message && typeof object.message === 'object'
    ? (object.message as Record<string, unknown>)
    : object;
  const fromId = Number(src.from_id ?? src.peer_id ?? 0);
  const messageId = Number(src.conversation_message_id ?? src.id ?? 0);
  const text = typeof src.text === 'string' ? src.text : '';
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      from: { id: fromId },
      chat: { id: fromId },
      text: text || undefined,
      date: Number(src.date ?? 0) * 1000,
    },
  };
}

// Нажатие callback-кнопки (message_event) → Telegram-подобный callback_query.
// payload VK — строка (мы кладём туда callback_data) или объект.
export function vkEventToTelegramUpdate(object: Record<string, unknown>): Record<string, unknown> {
  const userId = Number(object.user_id ?? 0);
  const messageId = Number(object.conversation_message_id ?? 0);
  const raw = object.payload;
  const data = typeof raw === 'string' ? raw : raw != null ? JSON.stringify(raw) : '';
  return {
    update_id: messageId,
    callback_query: {
      id: String(object.event_id ?? ''),
      from: { id: userId },
      data,
      message: { chat: { id: userId }, message_id: messageId },
    },
  };
}
