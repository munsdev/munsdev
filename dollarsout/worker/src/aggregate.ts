import type { Env } from "./types";
import {
  countVerifiedClaimsForAction,
  countVerifiedClaimsInPeriod,
  countVerifiedPeople,
  getCurrentPeriod,
  listActiveCommunityGoals,
} from "./db";

const KV_PERIOD_KEY = "agg:period:current";
const KV_PEOPLE_KEY = "agg:people";
const KV_GOAL_PREFIX = "agg:goal:";

export interface PublicPeriodStats {
  periodId: string;
  goal: number;
  count: number;
  startsAt: string;
  endsAt: string;
}

export interface PublicGoalStats {
  id: string;
  label: string;
  goal: number;
  count: number;
}

export interface PublicStats {
  period: PublicPeriodStats | null;
  peopleVerified: number;
  communityGoals: PublicGoalStats[];
}

/**
 * Recomputes the fast-path public counters from D1 (source of truth) into KV.
 * Run on a schedule (see index.ts scheduled()) so homepage reads never hit D1 directly --
 * spec S11 calls this out explicitly to avoid hammering D1 on every load.
 */
export async function reconcileAggregates(env: Env): Promise<void> {
  const period = await getCurrentPeriod(env);
  if (period) {
    const count = await countVerifiedClaimsInPeriod(env, period.startsAt, period.endsAt);
    const stats: PublicPeriodStats = {
      periodId: period.id,
      goal: period.goal,
      count,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
    };
    await env.COUNTERS.put(KV_PERIOD_KEY, JSON.stringify(stats));
  }

  const people = await countVerifiedPeople(env);
  await env.COUNTERS.put(KV_PEOPLE_KEY, String(people));

  const goals = await listActiveCommunityGoals(env);
  for (const goal of goals) {
    const count = goal.scopeActionId ? await countVerifiedClaimsForAction(env, goal.scopeActionId) : 0;
    const stats: PublicGoalStats = { id: goal.id, label: goal.label, goal: goal.goal, count };
    await env.COUNTERS.put(`${KV_GOAL_PREFIX}${goal.id}`, JSON.stringify(stats));
  }
}

export async function getPublicStats(env: Env): Promise<PublicStats> {
  const [periodRaw, peopleRaw] = await Promise.all([
    env.COUNTERS.get(KV_PERIOD_KEY),
    env.COUNTERS.get(KV_PEOPLE_KEY),
  ]);

  let period: PublicPeriodStats | null = periodRaw ? JSON.parse(periodRaw) : null;
  let peopleVerified = peopleRaw ? parseInt(peopleRaw, 10) : 0;

  if (!period) {
    // Cold start (first request before any scheduled reconcile has run) -- compute once and cache.
    await reconcileAggregates(env);
    const [p2, ppl2] = await Promise.all([env.COUNTERS.get(KV_PERIOD_KEY), env.COUNTERS.get(KV_PEOPLE_KEY)]);
    period = p2 ? JSON.parse(p2) : null;
    peopleVerified = ppl2 ? parseInt(ppl2, 10) : 0;
  }

  const goals = await listActiveCommunityGoals(env);
  const communityGoals: PublicGoalStats[] = [];
  for (const goal of goals) {
    const raw = await env.COUNTERS.get(`${KV_GOAL_PREFIX}${goal.id}`);
    communityGoals.push(raw ? JSON.parse(raw) : { id: goal.id, label: goal.label, goal: goal.goal, count: 0 });
  }

  return { period, peopleVerified, communityGoals };
}
