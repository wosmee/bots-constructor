-- 0029: вторая волна фиксов аудита 2026-10-18 (F-013, F-039, F-041, F-010).
--
-- 1) F-013: атомарный захват задач очереди scheduled_sends. CF cron —
--    at-least-once: дублирующий тик или два изолята выбирали одни и те же
--    due-строки и отправляли сообщение дважды. Колонка claimed_at — метка
--    захвата (мс epoch); claimScheduledSend в db.ts ставит её атомарным
--    UPDATE ... WHERE claimed_at IS NULL, dueScheduled возвращает только
--    свободные или зависшие (claimed_at старше 10 минут) строки.
ALTER TABLE scheduled_sends ADD COLUMN claimed_at INTEGER;

-- 2) F-039: дневной AI-лимит мини-аппов считался на бота, а не на
--    пользователя — один посетитель исчерпывал бюджет всему боту. Новый PK
--    (bot_id, user_id, date): счётчик генераций живёт на пару «пользователь +
--    сутки (UTC, 'YYYY-MM-DD')». media_bytes остаётся агрегатом на бота
--    (Filebase-квота общая): пишется в служебную строку user_id = 0,
--    date = '', а проверяется суммой SUM(media_bytes) по боту.
--
--    Пересоздание таблицы (CREATE → INSERT SELECT → DROP → RENAME):
--    ALTER TABLE не умеет менять PRIMARY KEY. Внешних ключей и триггеров на
--    mini_app_usage нет ни в одной миграции (проверено grep REFERENCES /
--    TRIGGER), поэтому DROP TABLE безопасен — «живых детей» у таблицы нет.
--    Данные переносим в служебную строку user_id = 0: старые media_bytes
--    попадают в сумму бота, старый дневной ai_count сохраняется как строка
--    date = ai_count_date (в проде таблица почти пустая).
CREATE TABLE mini_app_usage_new (
  bot_id      TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  date        TEXT NOT NULL DEFAULT '',
  media_bytes INTEGER NOT NULL DEFAULT 0,
  ai_count    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (bot_id, user_id, date)
);
INSERT INTO mini_app_usage_new (bot_id, user_id, date, media_bytes, ai_count, updated_at)
  SELECT bot_id, 0, ai_count_date, media_bytes, ai_count, updated_at FROM mini_app_usage;
DROP TABLE mini_app_usage;
ALTER TABLE mini_app_usage_new RENAME TO mini_app_usage;

-- 3) F-041: журнал платежей мини-аппов (Stars). payload — значение из
--    Telegram pre_checkout/successful_payment (UNIQUE = идемпотентность:
--    повтор вебхука не создаёт вторую запись), charge_id — уникальный id
--    списания Telegram, status — 'pending' | 'paid' | 'failed' | 'refunded'.
CREATE TABLE IF NOT EXISTS mini_payments (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL,
  app_id     TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  amount     INTEGER NOT NULL,
  payload    TEXT NOT NULL UNIQUE,
  charge_id  TEXT UNIQUE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  paid_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mini_payments_bot ON mini_payments(bot_id, app_id, user_id);

-- 4) F-010: списки ботов и тикетов сортировались через TEMP B-TREE
--    (EXPLAIN QUERY PLAN в аудите): одиночные индексы не покрывают порядок
--    ORDER BY created_at. Составные индексы закрывают оба запроса.
CREATE INDEX IF NOT EXISTS idx_bots_owner_created ON bots(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON support_tickets(status, created_at);
