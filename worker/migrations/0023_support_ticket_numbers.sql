-- 0023: сквозные человекочитаемые номера обращений (#1, #2, #3 …).
--
-- number NULLable: существующие обращения номеров НЕ получают и не
-- перенумеровываются — UI показывает для них короткий id (fallback).
-- Номер выдаётся атомарно внутри INSERT (подзапрос MAX+1) и защищён от
-- гонки уникальным индексом.
ALTER TABLE support_tickets ADD COLUMN number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_number ON support_tickets(number);
