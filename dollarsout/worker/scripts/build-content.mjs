#!/usr/bin/env node
/**
 * Builds content/seed_content.sql from the authored JSON in content/.
 *
 * The JSON is the source of truth; the SQL is generated and should never be
 * hand-edited. Run `npm run build:content` after changing anything under
 * content/, then `npm run seed:remote` to push it into D1.
 *
 * Validation runs first and is fatal: a typo in a counter key or a badge
 * pointing at an action id that no longer exists would otherwise seed cleanly
 * and then silently never award anything.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "content");

const read = (p) => JSON.parse(readFileSync(join(contentDir, p), "utf8"));

const categories = read("categories.json");
const chains = read("badge_chains.json");
const badges = read("badges.json");

const actionFiles = readdirSync(join(contentDir, "actions")).filter((f) => f.endsWith(".json")).sort();
const actions = [];
for (const file of actionFiles) {
  const categoryId = file.replace(/^\d+-/, "").replace(/\.json$/, "");
  const rows = read(join("actions", file));
  rows.forEach((a, i) => actions.push({ ...a, categoryId, sortOrder: i + 1 }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const POINTS_BANDS = [5, 10, 25, 50, 75, 100];
const RECURRENCES = ["once", "sustained", "repeatable"];
const REGIONS = ["global", "eu", "us"];
const EFFORTS = ["Easy", "Moderate", "Advanced"];
const TIMES = ["5 Minutes", "10-30 Minutes", "1-2 Hours", "1 Day", "Ongoing", "Varies"];

const errors = [];
const categoryIds = new Set(categories.map((c) => c.id));
const counterKeys = new Set(chains.map((c) => c.counter));
const actionIds = new Set(actions.map((a) => a.id));

const seenActionIds = new Set();
for (const a of actions) {
  const where = `action ${a.id}`;
  if (seenActionIds.has(a.id)) errors.push(`${where}: duplicate id`);
  seenActionIds.add(a.id);
  if (!categoryIds.has(a.categoryId)) errors.push(`${where}: unknown category ${a.categoryId}`);
  if (!POINTS_BANDS.includes(a.points)) errors.push(`${where}: points ${a.points} not in ${POINTS_BANDS.join("/")}`);
  if (!RECURRENCES.includes(a.recurrence)) errors.push(`${where}: bad recurrence ${a.recurrence}`);
  if (!REGIONS.includes(a.scopeRegion)) errors.push(`${where}: bad scopeRegion ${a.scopeRegion}`);
  if (!EFFORTS.includes(a.effort)) errors.push(`${where}: bad effort ${a.effort}`);
  if (!TIMES.includes(a.timeEstimate)) errors.push(`${where}: bad timeEstimate ${a.timeEstimate}`);
  if (a.recurrence === "repeatable" && a.cooldownDays == null) errors.push(`${where}: repeatable needs cooldownDays`);
  if (a.recurrence === "sustained" && a.checkinDays == null) errors.push(`${where}: sustained needs checkinDays`);
  if (a.recurrence !== "repeatable" && a.cooldownDays != null) errors.push(`${where}: cooldownDays only valid on repeatable`);
  if (a.recurrence !== "sustained" && a.checkinDays != null) errors.push(`${where}: checkinDays only valid on sustained`);
  for (const c of a.counters || []) {
    if (!counterKeys.has(c)) errors.push(`${where}: unknown counter key "${c}"`);
  }
  if (!a.shortDescription) errors.push(`${where}: missing shortDescription`);
}

const starters = actions.filter((a) => a.isStarter);
if (starters.length !== 10) errors.push(`starter set is ${starters.length} actions, expected 10`);
for (const s of starters) {
  if (s.scopeRegion !== "global") errors.push(`starter ${s.id}: must be global scope`);
}

for (const b of badges) {
  if (b.kind === "one_shot" && !actionIds.has(b.actionId)) {
    errors.push(`badge ${b.id}: actionId ${b.actionId} does not exist`);
  }
}

const seenCounters = new Set();
for (const ch of chains) {
  if (seenCounters.has(ch.counter)) errors.push(`chain ${ch.id}: duplicate counter ${ch.counter}`);
  seenCounters.add(ch.counter);
  if (ch.tiers.length !== 4) errors.push(`chain ${ch.id}: expected 4 tiers, got ${ch.tiers.length}`);
  let prev = 0;
  for (const t of ch.tiers) {
    if (t.threshold <= prev) errors.push(`chain ${ch.id} tier ${t.tier}: thresholds must ascend`);
    prev = t.threshold;
  }
}

// A counter nothing increments can never award its chain.
for (const key of counterKeys) {
  if (!actions.some((a) => (a.counters || []).includes(key))) {
    errors.push(`counter "${key}" has a chain but no action increments it`);
  }
}

if (errors.length) {
  console.error("Content validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null ? "NULL" : String(v));
const j = (v) => q(JSON.stringify(v ?? null));

const out = [];
out.push("-- GENERATED by scripts/build-content.mjs -- do not edit by hand.");
out.push("-- Source of truth: content/categories.json, content/actions/*.json,");
out.push("-- content/badges.json, content/badge_chains.json");
out.push("");
out.push("DELETE FROM badge_tiers;");
out.push("DELETE FROM badge_chains;");
out.push("DELETE FROM badges;");
out.push("DELETE FROM actions;");
out.push("DELETE FROM categories;");
out.push("");

for (const c of categories) {
  out.push(
    `INSERT INTO categories (id, webflow_item_id, name, tagline, short_description, long_description_html, disclaimer, color_key, sort_order) VALUES (${q(c.id)}, ${q(c.webflowItemId)}, ${q(c.name)}, ${q(c.tagline)}, ${q(c.shortDescription)}, ${q(c.longDescriptionHtml)}, ${q(c.disclaimer)}, ${q(c.colorKey)}, ${n(c.sortOrder)});`
  );
}
out.push("");

for (const a of actions) {
  out.push(
    `INSERT INTO actions (id, category_id, name, short_description, long_description_html, points, recurrence, cooldown_days, checkin_days, scope_region, targets, counters, helpful_links, effort, time_estimate, is_starter, sort_order) VALUES (${q(a.id)}, ${q(a.categoryId)}, ${q(a.name)}, ${q(a.shortDescription)}, ${q(a.longDescription)}, ${n(a.points)}, ${q(a.recurrence)}, ${n(a.cooldownDays)}, ${n(a.checkinDays)}, ${q(a.scopeRegion)}, ${j(a.targets ?? {})}, ${j(a.counters ?? [])}, ${j(a.helpfulLinks ?? [])}, ${q(a.effort)}, ${q(a.timeEstimate)}, ${a.isStarter ? 1 : 0}, ${n(a.sortOrder)});`
  );
}
out.push("");

for (const b of badges) {
  out.push(
    `INSERT INTO badges (id, name, description, icon, kind, action_id, threshold, scope, sort_order) VALUES (${q(b.id)}, ${q(b.name)}, ${q(b.description)}, ${q(b.icon)}, ${q(b.kind)}, ${q(b.actionId)}, ${n(b.threshold)}, ${q(b.scope)}, ${n(b.sortOrder)});`
  );
}
out.push("");

for (const ch of chains) {
  out.push(
    `INSERT INTO badge_chains (id, name, description, counter, icon, sort_order) VALUES (${q(ch.id)}, ${q(ch.name)}, ${q(ch.description)}, ${q(ch.counter)}, ${q(ch.icon)}, ${n(ch.sortOrder)});`
  );
  for (const t of ch.tiers) {
    out.push(
      `INSERT INTO badge_tiers (id, chain_id, tier, name, threshold) VALUES (${q(`${ch.id}-t${t.tier}`)}, ${q(ch.id)}, ${n(t.tier)}, ${q(t.name)}, ${n(t.threshold)});`
    );
  }
}
out.push("");

writeFileSync(join(contentDir, "seed_content.sql"), out.join("\n"));

const byCategory = categories.map((c) => `${c.id}=${actions.filter((a) => a.categoryId === c.id).length}`);
console.log(`OK  ${actions.length} actions, ${categories.length} categories, ${badges.length} badges, ${chains.length} chains (${chains.length * 4} tiers)`);
console.log(`    ${byCategory.join("  ")}`);
console.log(`    starters=${starters.length}  grid entries=${badges.length + chains.length}`);
