// Лимиты мини-аппов (фаза C): квоты схемы при публикации, медиа-квота
// Filebase и минутный rate limit /m/api. Числа — из единого источника
// MINI_LIMITS (shared/miniapp.ts); дневной лимит AI-генераций проверяет
// вызывающий код по bumpMiniAppAiCount (db.ts), здесь ему делать нечего.

import type { KVNamespace } from '@cloudflare/workers-types';
import type { MiniApp } from '../../../shared/miniapp';
import { MINI_LIMITS } from '../../../shared/miniapp';

// Нарушения лимитов схемы при публикации. Возвращает текст нарушения для
// ответа редактору либо null — схема в лимитах. Структуру не проверяем
// (это validateMiniAppShape), только счётчики поверх валидной схемы.
export function checkPublishLimits(app: MiniApp): string | null {
  const pages = app?.pages ?? [];
  if (pages.length > MINI_LIMITS.pages) {
    return `Слишком много страниц: ${pages.length} (лимит ${MINI_LIMITS.pages})`;
  }
  for (const p of pages) {
    const els = p?.els?.length ?? 0;
    if (els > MINI_LIMITS.elsPerPage) {
      return `Страница «${p?.name ?? p?.id}»: слишком много элементов: ${els} (лимит ${MINI_LIMITS.elsPerPage})`;
    }
  }
  return null;
}

// Влезет ли добавление addBytes в медиа-квоту бота. Ровно на границе —
// влезает (<=): квота «не больше N байт», а не «строго меньше».
export function checkMediaQuota(usageMediaBytes: number, addBytes: number): boolean {
  const used = Number(usageMediaBytes);
  const add = Number(addBytes);
  const total = (Number.isFinite(used) ? used : 0) + (Number.isFinite(add) ? add : 0);
  return total <= MINI_LIMITS.mediaBytesPerBot;
}

// TTL ключа rate limit: две минутные метки, чтобы хвост окна доживал до
// перехода на следующий ключ и не требовал ручного удаления.
const RL_TTL_SECONDS = 120;

// Минутный rate limit /m/api на пару (бот, юзер). Ключ — минутная метка из
// now (мс, epoch): get/put с expirationTtl, гонка параллельных запросов
// допустима (лимит оценочный, не платёжный). Сбой KV — fail-open: лучше
// пропустить запрос, чем положить рантайм мини-аппа вместе с KV.
export async function rateLimitMiniApi(kv: KVNamespace, botId: string, userId: number, now: number): Promise<boolean> {
  const minute = Math.floor(Number(now) / 60000);
  const key = `mini_rl:${botId}:${userId}:${minute}`;
  const raw = await kv.get(key).catch(() => null);
  const parsed = Number(raw ?? 0);
  const count = Number.isFinite(parsed) ? parsed : 0;
  if (count >= MINI_LIMITS.apiPerMin) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RL_TTL_SECONDS }).catch(() => {});
  return true;
}
