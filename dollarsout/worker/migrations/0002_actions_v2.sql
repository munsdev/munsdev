-- DollarsOut schema v2.
--
-- Restructures the content layer around per-action points, recurrence and
-- locale-aware targets, and replaces the coupled category/mode badges with
-- counter-driven badge chains.
--
-- The content tables are rebuilt rather than ALTERed. Every action id changes
-- in this pass (the 100-action content replacement), so nothing in the old
-- rows survives to be migrated, and D1 refuses DROP COLUMN on indexed columns
-- anyway. User rows that point at the old action ids are cleared with them --
-- there is no id mapping that could preserve them.

-- ---------------------------------------------------------------------------
-- Meter goal: replaces aggregate_periods.
--
-- The window feeding the meter has been fully rolling (trailing 90 days) since
-- the KV reconcile was removed, so the calendar period row was carrying only a
-- goal and two columns nothing read -- while still needing a manual INSERT every
-- month to keep `is_current = 1` matching a row. Missing that INSERT made the
-- whole `period` object null and blanked the meter. A single settings row has
-- no successor to forget.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('meter_goal', '1000');

DROP TABLE IF EXISTS aggregate_periods;

-- ---------------------------------------------------------------------------
-- Content tables
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS user_action_state;
DROP TABLE IF EXISTS community_goals;
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS actions;
DROP TABLE IF EXISTS categories;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  webflow_item_id TEXT,
  name TEXT NOT NULL,
  tagline TEXT,
  short_description TEXT,
  long_description_html TEXT,
  disclaimer TEXT,               -- e.g. the "not financial advice" line on investments
  color_key TEXT NOT NULL,       -- c1 | c2 | c3 (fixed grn/pur/orn rotation)
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description_html TEXT,

  points INTEGER NOT NULL DEFAULT 25,       -- 5 | 10 | 25 | 50 | 75 | 100
  recurrence TEXT NOT NULL DEFAULT 'once',  -- once | sustained | repeatable
  cooldown_days INTEGER,                    -- repeatable only
  checkin_days INTEGER,                     -- sustained only
  scope_region TEXT NOT NULL DEFAULT 'global', -- global | eu | us

  targets TEXT NOT NULL DEFAULT '{}',       -- JSON {locale: [name, ...]}, see §5
  counters TEXT NOT NULL DEFAULT '[]',      -- JSON array of badge-chain counter keys
  helpful_links TEXT NOT NULL DEFAULT '[]', -- JSON [{label,url}]

  effort TEXT NOT NULL,                     -- Easy | Moderate | Advanced
  time_estimate TEXT NOT NULL,              -- 5 Minutes | 10-30 Minutes | 1-2 Hours | 1 Day | Ongoing | Varies
  is_starter INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_actions_category ON actions(category_id);
CREATE INDEX idx_actions_starter ON actions(is_starter) WHERE is_starter = 1;

-- Marquee one-shots, milestone counters and time-served badges. The category/
-- mode/combo counter badges that used to live here are gone: they were keyed on
-- "N of the actions in this category", so every content edit silently moved the
-- goalposts for anyone mid-progress. Their replacements are in badge_chains.
CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL,
  kind TEXT NOT NULL,            -- one_shot | milestone | time_served | meta
  action_id TEXT REFERENCES actions(id),
  threshold INTEGER,
  scope TEXT,                    -- milestone: 'total'; time_served: 'checkin:3mo'|'checkin:6mo'; meta: rule key
  sort_order INTEGER NOT NULL
);

CREATE TABLE badge_chains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  counter TEXT NOT NULL UNIQUE,  -- matches a key in actions.counters
  icon TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE badge_tiers (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES badge_chains(id),
  tier INTEGER NOT NULL,         -- 1-4
  name TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  UNIQUE(chain_id, tier)
);
CREATE INDEX idx_badge_tiers_chain ON badge_tiers(chain_id);

-- ---------------------------------------------------------------------------
-- User tables
-- ---------------------------------------------------------------------------
CREATE TABLE user_action_state (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  action_id TEXT NOT NULL REFERENCES actions(id),
  status TEXT NOT NULL,          -- claimed | na
  claimed_at TEXT,
  start_date TEXT,
  last_checkin_at TEXT,
  last_checkin_result TEXT,      -- holding | went_back
  next_checkin_due TEXT,
  months_banked INTEGER NOT NULL DEFAULT 0,
  claim_count INTEGER NOT NULL DEFAULT 0,  -- repeatable: how many times logged
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, action_id)
);
CREATE INDEX idx_uas_account ON user_action_state(account_id);
CREATE INDEX idx_uas_action ON user_action_state(action_id);
CREATE INDEX idx_uas_checkin_due ON user_action_state(next_checkin_due) WHERE next_checkin_due IS NOT NULL;

-- One row per claim of a `repeatable` action. These can't live in
-- user_action_state: that table is UNIQUE(account_id, action_id) by design, and
-- a repeatable action needs per-claim history to enforce its cooldown and to
-- let each logging count once toward the rolling meter.
CREATE TABLE user_claims_log (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  action_id TEXT NOT NULL REFERENCES actions(id),
  claimed_at TEXT NOT NULL,
  backdated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_claims_log_account ON user_claims_log(account_id);
CREATE INDEX idx_claims_log_action_time ON user_claims_log(account_id, action_id, claimed_at DESC);
CREATE INDEX idx_claims_log_time ON user_claims_log(claimed_at);

CREATE TABLE user_counters (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  counter TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, counter)
);

CREATE TABLE user_badges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  badge_id TEXT NOT NULL,        -- badges.id, or a badge_tiers.id for chain tiers
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, badge_id)
);
CREATE INDEX idx_user_badges_account ON user_badges(account_id);
CREATE INDEX idx_user_badges_badge ON user_badges(badge_id);

CREATE TABLE community_goals (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  goal INTEGER NOT NULL,
  scope_action_id TEXT REFERENCES actions(id),
  active INTEGER NOT NULL DEFAULT 1
);
