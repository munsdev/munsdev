-- Brand styles, and the render revision that makes restyling possible.

CREATE TABLE IF NOT EXISTS brands (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Roles, not colour names. The renderer asks for "the type on the accent",
  -- never for "gold", so a brand swap cannot silently invert a layout.
  ground      TEXT NOT NULL,   -- the graphic's substrate
  on_ground   TEXT NOT NULL,   -- type on the substrate
  accent      TEXT NOT NULL,   -- second line, rules, bands, slabs
  on_accent   TEXT NOT NULL,   -- type ON the accent: HANDOFF section 4's brand rule
  muted       TEXT NOT NULL,   -- the .ORG of the mark
  bar         TEXT NOT NULL,   -- the mark bar fill
  on_bar      TEXT NOT NULL,   -- ELECTION, in the bar
  accent_on_bar TEXT NOT NULL, -- LOG, in the bar
  display     TEXT NOT NULL,   -- font family; the renderer draws type in this alone
  polarity    TEXT NOT NULL DEFAULT 'dark',
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);

-- A collection is made in one brand; a graphic records the brand it was
-- rendered in, so a part-finished restyle is still legible in the library.
ALTER TABLE collections ADD COLUMN brand_id TEXT;
ALTER TABLE graphics    ADD COLUMN brand_id TEXT;

-- The render revision. R2 keys are renders/<id>/<rev>/<size>.png and are
-- served immutable, so a restyle writes rev+1 and only commits the row once
-- every size has landed. Old renders keep serving until then, which makes a
-- half-finished restyle harmless and a closed tab a no-op.
ALTER TABLE graphics ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
