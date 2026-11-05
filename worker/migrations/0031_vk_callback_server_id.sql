-- 0031: VK Callback API v2 — воркер хранит server_id, который вернул
-- groups.addCallbackServer. Старый метод groups.setCallbackServer VK удалил
-- («Unknown method passed», пробы 30.10): публикация VK-бота через него
-- падала 502. Новый цикл: addCallbackServer (url+secret) → setCallbackSettings
-- (server_id) → editCallbackServer (смена url) → deleteCallbackServer (unpublish).
ALTER TABLE bots ADD COLUMN vk_callback_server_id INTEGER;
