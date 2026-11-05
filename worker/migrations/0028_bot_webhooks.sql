-- 0028: входящие вебхуки (блок webhook_in, набор 2026-10). Регистрация блока
-- пишет строку в bot_webhooks: публичный адрес хука содержит только token,
-- тело запроса раскладывается в переменные wh.<field> и сценарий продолжается
-- с блока scenario_block_id.
--
-- token — глобально уникальный (UNIQUE в определении таблицы): bot id в URL
-- не участвует, поэтому уникальность на всю таблицу (так же устроен
-- платёжный webhook_token, миграция 0022).
-- scenario_block_id — id блока webhook_in в опубликованной сборке.
-- fields — JSON-массив имён полей тела (webhookFields); '[]' = всё тело
-- целиком уходит в wh.body.
CREATE TABLE IF NOT EXISTS bot_webhooks (
  id                TEXT PRIMARY KEY,
  bot_id            TEXT NOT NULL,
  token             TEXT NOT NULL UNIQUE,
  scenario_block_id TEXT NOT NULL,
  fields            TEXT NOT NULL DEFAULT '[]',
  created_at        INTEGER NOT NULL
);

-- Очистка хуков бота (удаление бота, перепубликация). Поиск по token
-- покрывает UNIQUE-ограничение, отдельный индекс не нужен.
CREATE INDEX IF NOT EXISTS idx_bot_webhooks_bot ON bot_webhooks(bot_id);
