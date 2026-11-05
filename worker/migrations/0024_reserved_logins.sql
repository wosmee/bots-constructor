-- 0024: уникальный индекс на accounts.login + защита зарезервированных логинов.
-- login уже UNIQUE в схеме (0003), но там же создан НЕуникальный индекс с этим
-- именем; CREATE UNIQUE INDEX IF NOT EXISTS при существующем имени — тихий
-- no-op, поэтому старый индекс сначала удаляем и пересоздаём уникальным.
-- Уникальность на уровне БД гарантирует целостность даже при обходе API
-- (зарезервированные логины — admin/moderator/system/support/root/api —
-- отклоняются в POST /api/auth/register).
DROP INDEX IF EXISTS idx_accounts_login;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_login ON accounts(login);
