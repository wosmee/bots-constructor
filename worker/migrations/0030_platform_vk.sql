-- 0030: мультиплатформенность — VK-боты (платформа бота).
--
-- bots.platform: 'telegram' (дефолт для всех существующих строк) | 'vk'.
-- Один бот = одна платформа: сущность «бот» не делится между мессенджерами,
-- токен всегда платформенный (Telegram-токен бота либо ключ сообщества VK).
-- VK-специфика:
--   vk_group_id     — id группы VK (из groups.getById при создании);
--   vk_confirmation — строка подтверждения Callback API (VK шлёт её в ответ
--                     на наш URL при setCallbackServer; храним, чтобы отдать
--                     в теле ответа на событие confirmation);
--   vk_screen_name  — короткое имя группы (vk.me/<screen_name>), аналог
--                     bot_username у Telegram.
-- webhook_secret у VK используется иначе (поле secret в событии), но
-- генерация/хранение общие — отдельной колонки не нужно.

ALTER TABLE bots ADD COLUMN platform TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE bots ADD COLUMN vk_group_id INTEGER;
ALTER TABLE bots ADD COLUMN vk_confirmation TEXT;
ALTER TABLE bots ADD COLUMN vk_screen_name TEXT;
