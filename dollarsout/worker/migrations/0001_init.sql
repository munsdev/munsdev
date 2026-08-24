-- DollarsOut D1 schema.
-- Content-side tables (categories/actions/badges) are populated by
-- scripts/seed-content.ts from ../content/*.json, itself synced from the
-- 1STAND Webflow Actions CMS (source of truth for campaign-level copy).

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  quarantine_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | flagged | banned
  signup_ip TEXT,
  signup_asn TEXT
);

CREATE TABLE otp_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  request_ip TEXT
);
CREATE INDEX idx_otp_requests_email ON otp_requests(email);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  webflow_item_id TEXT,
  name TEXT NOT NULL,
  tagline TEXT,
  short_description TEXT,
  long_description_html TEXT,
  color_key TEXT NOT NULL, -- c1 | c2 | c3 (fixed grn/pur/orn rotation)
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  webflow_item_id TEXT,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description_html TEXT,
  mode TEXT NOT NULL, -- Withdraw | Substitute | Pressure | Build
  effort TEXT NOT NULL, -- Easy | Moderate | Advanced
  time_estimate TEXT NOT NULL, -- 5 Minutes | 10-30 Minutes | 1-2 Hours | 1 Day | Ongoing | Varies
  availability TEXT NOT NULL DEFAULT 'Anywhere', -- Anywhere | Outside US | US only
  money_presets TEXT NOT NULL DEFAULT '[]', -- JSON int array, euros
  helpful_links TEXT NOT NULL DEFAULT '[]', -- JSON [{label,url}]
  is_time_served INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_actions_category ON actions(category_id);

CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  kind TEXT NOT NULL, -- one_shot | counter | time_served
  category_id TEXT REFERENCES categories(id),
  action_id TEXT REFERENCES actions(id),
  threshold INTEGER,
  scope TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE user_action_state (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  action_id TEXT NOT NULL REFERENCES actions(id),
  status TEXT NOT NULL, -- claimed | na
  money_redirected INTEGER, -- cents
  what_broke TEXT,
  claimed_at TEXT,
  start_date TEXT,
  last_checkin_at TEXT,
  last_checkin_result TEXT, -- holding | went_back
  next_checkin_due TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, action_id)
);
CREATE INDEX idx_uas_account ON user_action_state(account_id);
CREATE INDEX idx_uas_action ON user_action_state(action_id);
CREATE INDEX idx_uas_checkin_due ON user_action_state(next_checkin_due) WHERE next_checkin_due IS NOT NULL;

CREATE TABLE user_badges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  badge_id TEXT NOT NULL REFERENCES badges(id),
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, badge_id)
);
CREATE INDEX idx_user_badges_account ON user_badges(account_id);

CREATE TABLE aggregate_periods (
  id TEXT PRIMARY KEY, -- e.g. '2026-08'
  goal INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE community_goals (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  goal INTEGER NOT NULL,
  scope_action_id TEXT REFERENCES actions(id), -- what counts toward this bar
  active INTEGER NOT NULL DEFAULT 1
);

-- Anomaly log for manual review (spec S7.5) -- never auto-bans.
CREATE TABLE anomaly_log (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  signal TEXT NOT NULL, -- e.g. 'burst_claiming', 'duplicate_what_broke'
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
