-- 0014: теги пользователей (F2).
--
-- Тег — это метка на конкретного человека у конкретного бота: «VIP», «купил»,
-- «из рассылки X». Хранится отдельной таблицей, а не в vars_json сессии:
-- по тегу нужно искать (сегменты, рассылки), а JSON-поле для этого неудобно.
CREATE TABLE IF NOT EXISTS user_tags (
  bot_id     TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  tag        TEXT NOT NULL,   -- уже нормализованный (см. normalizeTag в shared/types.ts)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, user_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_user_tags_bot_tag ON user_tags(bot_id, tag);
