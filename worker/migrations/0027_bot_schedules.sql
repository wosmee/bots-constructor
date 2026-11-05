-- 0027: абсолютные расписания (§4 аудита потолков). Блок schedule регистрирует
-- строку в bot_schedules; крон воркера раз в минуту считает срабатывания
-- (shared/cron.ts: cron_expr + timezone, хранится UTC) и ставит работу в
-- существующую очередь scheduled_sends.
--
-- cron_expr — 5-полевое выражение (минута час день месяц день_недели) либо
-- маркер 'every:<N>' для интервалов, не кратных сетке cron (N минут).
-- timezone — IANA-имя зоны автора (по умолчанию Europe/Moscow): срабатывания
-- вычисляются в локальном времени зоны, в базе хранятся UTC-миллисекунды.
-- audience — кому запускать поток: 'all' (подписчики), 'tag' (тег), 'single'
-- (пользователь, дошедший до блока регистрации).
-- audience_user — для 'single': Telegram user id владельца расписания.
-- last_run_at — якорь анти-дубля: крон обновляет его атомарно
-- (UPDATE ... WHERE last_run_at < ?), поэтому повторный тик в ту же минуту
-- не срабатывает дважды. NULL/0 = ещё ни разу не сработало; created_at —
-- второй якорь: новое расписание никогда не fires задним числом (backfill).
-- enabled — флаг живости: снятие галочки с блока или удаление блока из
-- опубликованной сборки глушит расписание без удаления строки.
CREATE TABLE IF NOT EXISTS bot_schedules (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT NOT NULL,
  block_id      TEXT NOT NULL,
  cron_expr     TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'Europe/Moscow',
  audience      TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','tag','single')),
  audience_tag  TEXT NOT NULL DEFAULT '',
  audience_user INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (bot_id, block_id)
);

-- Основной запрос крона: живые расписания (enabled = 1) пачкой; cron_expr в
-- индексе для будущих выборок по конкретному выражению.
CREATE INDEX IF NOT EXISTS idx_bot_schedules_enabled_cron ON bot_schedules(enabled, cron_expr);
CREATE INDEX IF NOT EXISTS idx_bot_schedules_bot ON bot_schedules(bot_id);
