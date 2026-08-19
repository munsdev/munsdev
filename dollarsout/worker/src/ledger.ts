import type { Env } from "./types";
import { listRecentClaimsGlobal } from "./db";

const RECENT_LIMIT = 10;
const PAGE_SIZE = 50;
const MAX_OFFSET = 5000; // guard against someone paging forever into an unbounded OFFSET scan

export async function getRecentLedger(env: Env) {
  return listRecentClaimsGlobal(env, RECENT_LIMIT, 0);
}

export async function getLedgerPage(env: Env, offset: number) {
  const safeOffset = Math.max(0, Math.min(MAX_OFFSET, offset | 0));
  const items = await listRecentClaimsGlobal(env, PAGE_SIZE + 1, safeOffset);
  const hasMore = items.length > PAGE_SIZE;
  return {
    items: items.slice(0, PAGE_SIZE),
    nextOffset: hasMore ? safeOffset + PAGE_SIZE : null,
  };
}
