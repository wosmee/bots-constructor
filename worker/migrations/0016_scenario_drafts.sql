-- 0016: черновики сценария на сервере (F9).
--
-- Несохранённые правки живут на аккаунте, а не в localStorage браузера: автор
-- доводит сценарий до конца, отдаёт аккаунт другому человеку — и всё остаётся
-- на месте. Отдельная таблица (а не запись прямо в scenarios): черновик не
-- должен молча перетирать сохранённую версию.
CREATE TABLE IF NOT EXISTS scenario_drafts (
  bot_id     TEXT PRIMARY KEY,
  flow_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
