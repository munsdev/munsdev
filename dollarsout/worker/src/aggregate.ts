import type { Env } from "./types";
import {
  countClaimsInWindow,
  countVerifiedClaimsForAction,
  countVerifiedPeople,
  getCurrentPeriod,
  listActiveCommunityGoals,
  ROLLING_WINDOW_DAYS,
} from "./db";

export interface PublicPeriodStats {
  periodId: string;
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
  period: PublicPeriodStats | null;
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
 * These are three indexed COUNT(*)s over a small table against a goal in the low thousands, so
 * serving them live is cheap and the meter is now honest the moment anything changes.
 */
export async function getPublicStats(env: Env): Promise<PublicStats> {
  const [periodRow, peopleVerified, goals] = await Promise.all([
    getCurrentPeriod(env),
    countVerifiedPeople(env),
    listActiveCommunityGoals(env),
  ]);

  let period: PublicPeriodStats | null = null;
  if (periodRow) {
    period = {
      periodId: periodRow.id,
      goal: periodRow.goal,
      count: await countClaimsInWindow(env),
      windowDays: ROLLING_WINDOW_DAYS,
    };
  }

  const communityGoals: PublicGoalStats[] = [];
  for (const goal of goals) {
    communityGoals.push({
      id: goal.id,
      label: goal.label,
      goal: goal.goal,
      count: goal.scopeActionId ? await countVerifiedClaimsForAction(env, goal.scopeActionId) : 0,
    });
  }

  return { period, peopleVerified, communityGoals };
}
