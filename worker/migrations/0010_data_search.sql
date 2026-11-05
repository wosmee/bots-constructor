-- 0010: поиск по клиентам и записям таблиц
-- SQLite сравнивает регистр только для латиницы: LIKE '%пётр%' не находил «Пётр».
-- Поэтому храним отдельную колонку-search_text, приведённую к нижнему регистру
-- в JS (там кириллица понимается), и ищем уже по ней.

ALTER TABLE sessions ADD COLUMN search_text TEXT;
ALTER TABLE collection_items ADD COLUMN search_text TEXT;

-- Старые строки: пересчитываем тем, что умеет SQLite. Он lowering'ом покроет
-- только латиницу — кириллица в этих строках останется в исходном регистре и
-- подтянется при следующем апдейте от пользователя (код пишет search_text уже
-- из JS, где регистр понимается и для кириллицы).
UPDATE sessions SET search_text = LOWER(COALESCE(first_name,'') || ' ' || COALESCE(username,'') || ' ' || COALESCE(vars_json,''));
UPDATE collection_items SET search_text = LOWER(COALESCE(data_json,''));
