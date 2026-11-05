-- 0004: рефералки + настройки пользователя + каталог шаблонов + роли

-- @username бота нужен для сбора реферальной ссылки t.me/<bot>?start=ref_<id>.
ALTER TABLE bots ADD COLUMN bot_username TEXT;

-- Роли: user (по умолчанию) / moderator / admin.
-- admin выставляется владельцем вручную (UPDATE accounts SET role='admin' WHERE login=...).
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- ---------------- рефералы ----------------
-- Один приглашённый засчитывается один раз на бота: уникальность (bot_id, invited_user_id).
CREATE TABLE IF NOT EXISTS referrals (
  id               TEXT PRIMARY KEY,
  bot_id           TEXT NOT NULL,
  inviter_user_id  TEXT NOT NULL,
  invited_user_id  TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  depth            INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_unique ON referrals(bot_id, invited_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(bot_id, inviter_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_bot ON referrals(bot_id);

-- ---------------- настройки интерфейса (per-user, синхронизация между устройствами) ----------------
CREATE TABLE IF NOT EXISTS user_settings (
  user_id          TEXT PRIMARY KEY,
  theme            TEXT NOT NULL DEFAULT 'dark',   -- 'dark' | 'light'
  hints_enabled    INTEGER NOT NULL DEFAULT 1,     -- 0 | 1
  language         TEXT NOT NULL DEFAULT 'ru',     -- 'ru' | 'en'
  feature_whatif   INTEGER NOT NULL DEFAULT 1,
  feature_conflicts INTEGER NOT NULL DEFAULT 1,
  feature_sleep    INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL
);

-- ---------------- каталог шаблонов (глобальный, видят все) ----------------
CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  author_user_id  TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  scenario_json   TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  uses_count      INTEGER NOT NULL DEFAULT 0,
  likes_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_popularity ON templates(uses_count DESC, likes_count DESC);
CREATE INDEX IF NOT EXISTS idx_templates_author ON templates(author_user_id);
