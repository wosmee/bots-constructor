-- 0002: subscribers + scheduled (delayed) sends
CREATE TABLE IF NOT EXISTS subscribers (
  bot_id   TEXT NOT NULL,
  user_id  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_subscribers_bot ON subscribers(bot_id);

CREATE TABLE IF NOT EXISTS scheduled_sends (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id     TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  send_at    INTEGER NOT NULL,
  method     TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_sends(send_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_bot ON scheduled_sends(bot_id);
