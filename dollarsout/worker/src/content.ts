import type { Env } from "./types";
import { listActions, listBadgeChains, listBadges, listCategories } from "./db";
import { getPublicStats } from "./aggregate";

// Bumped from v1: the catalog shape changed (points/recurrence/targets/counters on actions,
// chains alongside badges), so a cached v1 payload would be served to a frontend that can no
// longer read it.
const CATALOG_KV_KEY = "catalog:v2";
const CATALOG_CACHE_TTL = 300; // 5 min -- content is static/self-contained, this just keeps D1 load low

export async function getCatalog(env: Env) {
  const cached = await env.COUNTERS.get(CATALOG_KV_KEY);
  if (cached) return JSON.parse(cached);

  const [categories, actions, badges, chains] = await Promise.all([
    listCategories(env),
    listActions(env),
    listBadges(env),
    listBadgeChains(env),
  ]);
  const catalog = { categories, actions, badges, chains };
  await env.COUNTERS.put(CATALOG_KV_KEY, JSON.stringify(catalog), {
    expirationTtl: CATALOG_CACHE_TTL,
  });
  return catalog;
}

export async function getStats(env: Env) {
  return getPublicStats(env);
}
