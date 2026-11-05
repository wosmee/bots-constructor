-- 0017: full referral system (Phase 3.2).
--
-- The base attribution table `referrals` already exists (0004): inviter_user_id
-- is the referrer, invited_user_id is the referee, unique per (bot, referee).
-- We extend it instead of creating a duplicate table:
--   source   — where the referral came from (start param payload, default 'link')
--   verified — the referee passed the verification gate (paid / subscribed / goal)

ALTER TABLE referrals ADD COLUMN source TEXT NOT NULL DEFAULT 'link';
ALTER TABLE referrals ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;

-- Granted bonuses: one row per (referrer, referee, kind) when one_per_user is on.
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id      TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  referee_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,          -- 'send_message' | 'increment_variable' | 'grant_subscription_days' | 'revenue_share'
  amount      INTEGER NOT NULL DEFAULT 0,
  level       INTEGER NOT NULL DEFAULT 1,  -- hierarchy level: 1 = direct referrer
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refbonuses_bot_referrer ON referral_bonuses(bot_id, referrer_id);
CREATE INDEX IF NOT EXISTS idx_refbonuses_pair ON referral_bonuses(bot_id, referrer_id, referee_id);
CREATE INDEX IF NOT EXISTS idx_refbonuses_created ON referral_bonuses(bot_id, created_at);

-- Time-boxed leaderboards configured by referral_tournament blocks.
CREATE TABLE IF NOT EXISTS referral_tournaments (
  id          TEXT PRIMARY KEY,
  bot_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  metric      TEXT NOT NULL DEFAULT 'count',   -- 'count' | 'revenue'
  config_json TEXT NOT NULL DEFAULT '{}'       -- prize pool, split, extras
);
CREATE INDEX IF NOT EXISTS idx_reftournaments_bot ON referral_tournaments(bot_id, starts_at, ends_at);

-- Successful Telegram Payments, denormalised with the payer's referrer:
-- the 'revenue' metric and the 'first_payment' / 'paid_min_amount' gates
-- read this table instead of scanning logs.
CREATE TABLE IF NOT EXISTS referral_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id      TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  referrer_id TEXT,                      -- null when the payer has no referrer
  amount      INTEGER NOT NULL,          -- minor units (kopecks for RUB)
  currency    TEXT NOT NULL DEFAULT 'RUB',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refpayments_bot_user ON referral_payments(bot_id, user_id);
CREATE INDEX IF NOT EXISTS idx_refpayments_bot_referrer ON referral_payments(bot_id, referrer_id);

CREATE TABLE IF NOT EXISTS referral_tournament_entries (
  tournament_id TEXT NOT NULL,
  bot_id        TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  score         INTEGER NOT NULL DEFAULT 0,
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reftournament_entries_score ON referral_tournament_entries(tournament_id, score DESC);
