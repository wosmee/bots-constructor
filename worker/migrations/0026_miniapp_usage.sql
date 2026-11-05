-- 0026: usage мини-аппов (лимиты фазы C).
--
-- Filebase-бакет общий на аккаунт, поэтому медиа-байты мини-аппов считаем
-- своим счётчиком на бота (media_bytes, квота MINI_LIMITS.mediaBytesPerBot из
-- shared/miniapp.ts). Счётчик AI-генераций дневной: ai_count_date хранит сутки
-- 'YYYY-MM-DD' (UTC), при смене даты ai_count сбрасывается — оба перехода
-- делает один атомарный UPSERT (bumpMiniAppAiCount в db.ts).
--
-- Частота /m/api здесь НЕ хранится: минутный rate limit живёт в KV
-- (mini_rl:<bot_id>:<user_id>:<минута>, см. worker/src/miniapp/limits.ts) —
-- счётчик на 2 минуты в D1 был бы мусором.

CREATE TABLE IF NOT EXISTS mini_app_usage (
  bot_id TEXT PRIMARY KEY,
  media_bytes INTEGER NOT NULL DEFAULT 0,
  ai_count_date TEXT NOT NULL DEFAULT '',
  ai_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
