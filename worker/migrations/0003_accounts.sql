-- 0003: аккаунты платформы (логин + пароль)
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  login      TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_login ON accounts(login);
