import type { Env } from "./types";
import { listActions, listBadges, listCategories } from "./db";
import { getPublicStats } from "./aggregate";

const CATALOG_KV_KEY = "catalog:v1";
const CATALOG_CACHE_TTL = 300; // 5 min -- content changes via scheduled Webflow sync, not live edits

export async function getCatalog(env: Env) {
  const cached = await env.COUNTERS.get(CATALOG_KV_KEY);
  if (cached) return JSON.parse(cached);

  const [categories, actions, badges] = await Promise.all([
    listCategories(env),
    listActions(env),
    listBadges(env),
  ]);
  const catalog = { categories, actions, badges };
  await env.COUNTERS.put(CATALOG_KV_KEY, JSON.stringify(catalog), { expirationTtl: CATALOG_CACHE_TTL });
  return catalog;
}

export async function invalidateCatalogCache(env: Env) {
  await env.COUNTERS.delete(CATALOG_KV_KEY);
}

export async function getStats(env: Env) {
  return getPublicStats(env);
}
