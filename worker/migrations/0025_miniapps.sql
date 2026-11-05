-- 0025: мини-аппы (WebApp, привязанный к боту).
--
-- Модель: у бота несколько мини-аппов; внутри бота апп опознаётся по slug
-- (UNIQUE(bot_id, slug)) — slug уходит в ссылку открытия WebApp. Апп хранит
-- две схемы: draft_json (черновик редактора, сохраняется как есть) и
-- published_json (то, что рантайм отдаёт Telegram-юзеру). Публикация не
-- затирает историю: каждый publish пишет снапшот в mini_app_versions с
-- revision = max + 1, откат — копирование из снапшота.
--
-- access_rule_json — MiniAccessRule из shared/miniapp.ts ('all' | 'tag' |
-- 'users'): кому разрешено открывать апп. Храним строкой: валидация формы —
-- validateMiniAppShape на стороне воркера, БД схему не парсит.

CREATE TABLE IF NOT EXISTS mini_apps (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  access_rule_json TEXT NOT NULL DEFAULT '{"kind":"all"}',
  draft_json TEXT NOT NULL,
  published_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(bot_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_mini_apps_bot ON mini_apps(bot_id);
CREATE INDEX IF NOT EXISTS idx_mini_apps_owner ON mini_apps(owner_id);

-- Снапшоты публикаций: revision монотонно растёт на каждый publish,
-- строка неизменяема (история не перезаписывается, как у subflow_versions).
CREATE TABLE IF NOT EXISTS mini_app_versions (
  id TEXT PRIMARY KEY,
  mini_app_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(mini_app_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_mini_app_versions_app ON mini_app_versions(mini_app_id);
