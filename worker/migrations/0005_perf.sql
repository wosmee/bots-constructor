-- 0005: оптимизация hot-path (кэш-флаги, индексы под аналитику) + очередь рассылок

-- Есть ли в сценарии блок «Рефералка». Считается один раз при сохранении,
-- чтобы не искать подстроку в flow_json на каждый входящий апдейт.
ALTER TABLE bots ADD COLUMN has_referral INTEGER NOT NULL DEFAULT 0;

-- Аналитика: stats() считает шаги по маске 'step.%' — обычный индекс (bot_id, ts)
-- здесь не помогает. Частичный индекс по событию убирает полный просмотр логов бота.
CREATE INDEX IF NOT EXISTS idx_logs_step ON logs(bot_id, ts) WHERE event LIKE 'step.%';
CREATE INDEX IF NOT EXISTS idx_logs_event ON logs(bot_id, event, ts);

-- Очередь рассылок: scheduled_sends уже используется для отложенных отправок,
-- но большие рассылки режем на пачки, поэтому нужен индекс по методу.
CREATE INDEX IF NOT EXISTS idx_scheduled_method ON scheduled_sends(method, send_at);
