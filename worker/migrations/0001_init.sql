CREATE TABLE IF NOT EXISTS bots (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  token_enc     TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  shard_id      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id);

CREATE TABLE IF NOT EXISTS scenarios (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  flow_json  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenarios_bot ON scenarios(bot_id);

CREATE TABLE IF NOT EXISTS sessions (
  bot_id       TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  current_block TEXT,
  vars_json    TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (bot_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_bot ON sessions(bot_id);

CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  tg_id   INTEGER UNIQUE,
  role    TEXT NOT NULL DEFAULT 'owner'
);

CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id  TEXT NOT NULL,
  user_id INTEGER,
  event   TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_bot_ts ON logs(bot_id, ts);

CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id      TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
);
