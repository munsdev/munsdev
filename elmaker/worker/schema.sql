-- socialmaker: one shared workspace for the ElectionLog graphic maker.
-- One project row, many items, a content-addressed image library.

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  caption    TEXT NOT NULL DEFAULT '',
  sizes      TEXT NOT NULL DEFAULT '{}',   -- JSON: {"1080x1080":true,...}
  pv         TEXT NOT NULL DEFAULT '1080x1350',
  guides     INTEGER NOT NULL DEFAULT 0,
  sel        TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  top        TEXT NOT NULL DEFAULT '',
  bot        TEXT NOT NULL DEFAULT '',
  variant    TEXT NOT NULL DEFAULT 'stack',
  align      TEXT NOT NULL DEFAULT 'center',
  image_sha  TEXT,
  zoom       INTEGER NOT NULL DEFAULT 100,
  fx         REAL NOT NULL DEFAULT 50,
  fy         REAL NOT NULL DEFAULT 50,
  scrim      INTEGER NOT NULL DEFAULT 70,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_project_ord ON items(project_id, ord);

-- Content-addressed: the sha256 of the downscaled bytes is the identity, so
-- the same photo dropped on six graphics is one R2 object and one row.
CREATE TABLE IF NOT EXISTS images (
  sha256     TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  w          INTEGER NOT NULL DEFAULT 0,
  h          INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  has_thumb  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
