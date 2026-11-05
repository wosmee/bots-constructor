-- 0009: база данных клиентов бота + коллекции (произвольные таблицы автора)

-- ---------------- профиль клиента ----------------
-- Раньше в sessions лежал только tg_id: автор видел в базе одни цифры и не мог
-- понять, кто это. Telegram присылает first_name/username в каждом апдейте —
-- запоминаем их. first_seen = первый визит, updated_at = последняя активность.
ALTER TABLE sessions ADD COLUMN first_name TEXT;
ALTER TABLE sessions ADD COLUMN username TEXT;
ALTER TABLE sessions ADD COLUMN first_seen INTEGER;
CREATE INDEX IF NOT EXISTS idx_sessions_bot_seen ON sessions(bot_id, updated_at);

-- ---------------- коллекции (таблицы автора бота) ----------------
-- Автор сам описывает таблицу («Заказы»: имя, телефон, сумма) и складывает в
-- неё записи блоком «Данные». Никакого SQL и внешних баз не нужно.
CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  bot_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',   -- JSON array of field names
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_bot ON collections(bot_id);

-- Записи коллекции. Значения лежат в data_json (поле -> значение), чтобы автор
-- мог менять состав полей таблицы без миграций.
CREATE TABLE IF NOT EXISTS collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  bot_id        TEXT NOT NULL,
  user_id       INTEGER,                    -- клиент бота, от которого пришла запись
  data_json     TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_collection ON collection_items(collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_bot ON collection_items(bot_id);
CREATE INDEX IF NOT EXISTS idx_items_user ON collection_items(collection_id, user_id);
