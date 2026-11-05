-- Раскрытие групп палитры: 'accordion' (открыта максимум одна) или 'free'.
-- Пользовательская настройка, поэтому живёт рядом с остальными в user_settings,
-- а не в localStorage предпросмотра.
ALTER TABLE user_settings ADD COLUMN palette_mode TEXT NOT NULL DEFAULT 'accordion';
