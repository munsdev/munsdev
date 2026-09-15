-- Library schema: collections of finished graphics.
--
-- The editor's tables (projects, items, images) stay as they are. This is
-- additive so the live tool keeps working while the new flow is built.
--
-- A graphic here is finished. It is never edited again, which is why there
-- is no version history, no staleness tracking and no renders table: every
-- graphic renders every size, so its R2 key is derivable from its id.

CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS graphics (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  -- What it was made from. Not live state -- nothing reads this back into an
  -- editor -- but it powers library search, the alt text, and knowing what a
  -- graphic actually says without decoding a PNG.
  top           TEXT NOT NULL DEFAULT '',
  bot           TEXT NOT NULL DEFAULT '',
  variant       TEXT NOT NULL DEFAULT 'stack',
  align         TEXT NOT NULL DEFAULT 'center',
  photo_sha     TEXT,
  scrim         INTEGER NOT NULL DEFAULT 70,
  -- Per-size crop overrides, {"1080x1350":{"zoom":120,"fx":40,"fy":60}}.
  -- A size absent here used the graphic's default crop.
  per_size      TEXT NOT NULL DEFAULT '{}',
  -- Which sizes actually rendered, ["1080x1080",...]. Saves listing R2 to
  -- find out what a graphic has.
  sizes         TEXT NOT NULL DEFAULT '[]',
  -- Written once at save. Accessibility copy for whoever posts it.
  alt           TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS graphics_collection ON graphics(collection_id, created_at DESC);
