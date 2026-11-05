-- 0021: подсценарии (библиотека переиспользуемых фрагментов) и билды.
--
-- Модель: подсценарий — АВТОРСКАЯ конструкция. scenarios.flow_json хранит
-- авторский вид (с блоками subflow); scenario_builds — раскрытый артефакт,
-- который реально исполняет вебхук. Бот без строки билда (все существующие)
-- грузится ровно как раньше — поведение не меняется.
--
-- Владелец: один подсценарий принадлежит одному аккаунту; бот может вызывать
-- ТОЛЬКО подсценарии своего владельца (проверяется на каждом чтении в воркере).

-- Текущее состояние фрагмента. revision растёт на каждое сохранение.
CREATE TABLE IF NOT EXISTS subflows (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  flow_json TEXT NOT NULL,
  -- [{ name, description?, required? }] — объявленные входы/выходы.
  inputs_json TEXT NOT NULL DEFAULT '[]',
  outputs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subflows_owner ON subflows(owner_id);

-- История ревизий фрагмента: сохранение пишет строку и поднимает revision.
-- Восстановление старой ревизии — поддерживаемая операция (копирует flow_json
-- обратно в subflows новой ревизией, история не перезаписывается).
CREATE TABLE IF NOT EXISTS subflow_versions (
  id TEXT PRIMARY KEY,
  subflow_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  flow_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '[]',
  outputs_json TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(subflow_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_subflow_versions ON subflow_versions(subflow_id, revision DESC);

-- Раскрытый (скомпилированный) артефакт публикации: РОВНО тот JSON, который
-- исполняет вебхук. (bot_id, version) повторяет ключ scenarios, поэтому
-- rollback на версию N берёт билд N. Детерминизм: живой бот не меняет
-- поведение, если автор позже отредактировал фрагмент в библиотеке.
CREATE TABLE IF NOT EXISTS scenario_builds (
  bot_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  flow_json TEXT NOT NULL,
  built_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, version)
);
