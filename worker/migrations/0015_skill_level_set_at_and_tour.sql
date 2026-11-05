-- 0015: уровень подготовки спрашивается один раз (F8a) + флаг показа тура (F9).
--
-- skill_level_set_at: время, когда уровень реально выбрали. Пусто (NULL) —
-- уровень ещё никогда не выбирали, значит можно показать стартовый экран.
-- Раньше фронт смотрел на пустой skill_level, и модалка мигала, пока настройки
-- ещё грузились.
ALTER TABLE user_settings ADD COLUMN skill_level_set_at INTEGER;

-- Существующие аккаунты: уровень уже выбран — иначе им покажут экран повторно.
UPDATE user_settings SET skill_level_set_at = updated_at
 WHERE skill_level IS NOT NULL AND skill_level != '';

-- tour_done_at: тур «соберите первого бота» показывается, пока это поле пусто.
-- Раньше флаг жил в localStorage, то есть был привязан к устройству, а не к
-- аккаунту: на новом устройстве тур показывался заново (F9).
ALTER TABLE user_settings ADD COLUMN tour_done_at INTEGER;
