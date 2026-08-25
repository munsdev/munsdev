import type { Env } from "./types";
import {
  countClaimsInWindow,
  countVerifiedClaimsForAction,
  countVerifiedPeople,
  getMeterGoal,
  listActiveCommunityGoals,
  ROLLING_WINDOW_DAYS,
} from "./db";

export interface PublicPeriodStats {
  goal: number;
  count: number;
  /** Claims are counted over the trailing N days rather than a calendar period. */
  windowDays: number;
}

export interface PublicGoalStats {
  id: string;
  label: string;
  goal: number;
  count: number;
}

export interface PublicStats {
  period: PublicPeriodStats;
  peopleVerified: number;
  communityGoals: PublicGoalStats[];
}

/**
 * Reads the public counters straight from D1 on every request.
 *
 * These used to be precomputed into KV by a ten-minute cron so homepage loads never touched D1.
 * That bought very little and cost the thing the meter is for: a claim did not move the needle
 * until the next reconcile, so the number on screen could be up to ten minutes behind what the
 * user had just done, and withdrawing a claim looked like it had not worked.
 *
 * These are a handful of indexed COUNT(*)s over a small table against a goal in the low
 * thousands, so serving them live is cheap and the meter is honest the moment anything changes.
 *
 * `period` is no longer nullable. It used to depend on a calendar row somebody had to insert
 * every month, and a missing successor row blanked the entire meter -- the goal now comes from
 * a settings row that always exists, with a hardcoded fallback behind it.
 */
export async function getPublicStats(env: Env): Promise<PublicStats> {
  const [goal, count, peopleVerified, goals] = await Promise.all([
    getMeterGoal(env),
    countClaimsInWindow(env),
    countVerifiedPeople(env),
    listActiveCommunityGoals(env),
  ]);

  const communityGoals: PublicGoalStats[] = [];
  for (const g of goals) {
    communityGoals.push({
      id: g.id,
      label: g.label,
      goal: g.goal,
      count: g.scopeActionId ? await countVerifiedClaimsForAction(env, g.scopeActionId) : 0,
    });
  }

  return {
    period: { goal, count, windowDays: ROLLING_WINDOW_DAYS },
    peopleVerified,
    communityGoals,
  };
}
