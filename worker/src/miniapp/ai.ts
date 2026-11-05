// Серверные действия мини-аппов (фаза C/D): AI-генерация картинки и избранное.
//
// Избранное: список id строкой через запятую в переменной юзера 'mini_favs'
// (sessions.vars_json). toggleFavorite — чистая функция; чтение и запись
// сессии делает вызывающий роут (getSession/upsertSession из db.ts).
//
// AI-генерация. Контур воркера (aiComplete) умеет только chat/completions
// (текст). Картинки генерируются через отдельный Tooken images-endpoint
// (OpenAI-совместимый): POST ${TOOKEN_IMAGE_BASE_URL}/images/generations,
// ответ data[0].b64_json. Ключи TOOKEN_IMAGE_* — секреты воркера
// (wrangler secret put), ключи провайдера изображений (OpenAI-совместимый endpoint).
// Байты → mediaPut (Filebase) → url = `/m/img/${key}`.

import { mediaPut, mediaKey } from '../media';

export interface MiniAiEnv {
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  TOOKEN_IMAGE_API_KEY?: string;
  TOOKEN_IMAGE_BASE_URL?: string;
  TOOKEN_IMAGE_MODEL?: string;
  FILEBASE_KEY?: string;
  FILEBASE_SECRET?: string;
}

export interface MiniAiArgs {
  botId: string;
  userId: number;
  prompt: string;
  // Шагнуть дневной счётчик и вернуть НОВОЕ значение (db.bumpMiniAppAiCount).
  // today — 'YYYY-MM-DD' в UTC, как day у bumpBroadcastCounter: смена даты
  // обнуляет счётчик.
  onCount: (today: string) => Promise<number>;
  limit: number;
}

const AI_TIMEOUT_MS = 60_000; // генерация картинки может занять время

export async function generateMiniImage(
  env: MiniAiEnv,
  args: MiniAiArgs
): Promise<{ url: string; key: string }> {
  // Счётчик первым делом: дневной лимит проверяется до всего остального,
  // чтобы перебор не упирался ни в конфиг AI, ни в сеть.
  const today = new Date().toISOString().slice(0, 10);
  const count = await args.onCount(today);
  if (count > args.limit) throw new Error('ai limit');

  const apiKey = env.TOOKEN_IMAGE_API_KEY;
  const baseUrl = env.TOOKEN_IMAGE_BASE_URL;
  const model = env.TOOKEN_IMAGE_MODEL;
  if (!apiKey || !baseUrl || !model) throw new Error('ai not configured');

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'user-agent': 'bots-constructor/1.0',
    },
    body: JSON.stringify({
      model,
      prompt: args.prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ai upstream ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('ai upstream returned no image data');

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = mediaKey(args.botId, 'png');
  await mediaPut(env, key, bytes, 'image/png');
  return { url: `/m/img/${key}`, key };
}

// Добавить/убрать itemId в списке id через запятую (toggle). Порядок
// детерминированный: существующие id сохраняют позиции, новый уходит в конец;
// пустые сегменты и дубликаты вычищаются. Пустой itemId ничего не добавляет.
export function toggleFavorite(list: string, itemId: string): string {
  const ids = String(list || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const id = String(itemId || '').trim();
  const has = id !== '' && ids.includes(id);
  const rest: string[] = [];
  for (const x of ids) {
    if (x === id || rest.includes(x)) continue;
    rest.push(x);
  }
  if (id && !has) rest.push(id);
  return rest.join(',');
}
