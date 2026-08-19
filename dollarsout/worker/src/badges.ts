import type { Action, Badge, Env } from "./types";
import { LEVEL_LADDER } from "./types";
import { awardBadge, listBadges, listEarnedBadgeIds, listUserActionState } from "./db";

export function computeLevel(totalClaimed: number) {
  let current: (typeof LEVEL_LADDER)[number] = LEVEL_LADDER[0];
  for (const l of LEVEL_LADDER) {
    if (totalClaimed >= l.min) current = l;
  }
  const next = LEVEL_LADDER.find((l) => l.min > totalClaimed);
  return {
    level: current.level,
    name: current.name,
    actionsToNext: next ? next.min - totalClaimed : 0,
    nextName: next?.name ?? null,
  };
}

/**
 * Re-evaluates one-shot and counter badges after a claim. Time-served badges are evaluated
 * separately from the check-in flow (see checkins.ts) since they're keyed on holding behavior,
 * not the claim event itself.
 */
export async function evaluateBadgesAfterClaim(
  env: Env,
  accountId: string,
  justClaimedAction: Action,
  actionsById: Map<string, Action>
): Promise<Badge[]> {
  const [allBadges, earned, states] = await Promise.all([
    listBadges(env),
    listEarnedBadgeIds(env, accountId),
    listUserActionState(env, accountId),
  ]);

  const claimed = states.filter((s) => s.status === "claimed");
  const totalClaimed = claimed.length;

  const byCategory = new Map<string, number>();
  const byMode = new Map<string, number>();
  const byCategoryMode = new Map<string, number>();

  for (const s of claimed) {
    const action = actionsById.get(s.actionId);
    if (!action) continue;
    byCategory.set(action.categoryId, (byCategory.get(action.categoryId) || 0) + 1);
    byMode.set(action.mode, (byMode.get(action.mode) || 0) + 1);
    const comboKey = `${action.categoryId}:${action.mode}`;
    byCategoryMode.set(comboKey, (byCategoryMode.get(comboKey) || 0) + 1);
  }

  const newlyEarned: Badge[] = [];

  for (const badge of allBadges) {
    if (earned.has(badge.id)) continue;

    if (badge.kind === "one_shot") {
      if (badge.actionId === justClaimedAction.id) {
        if (await awardBadge(env, accountId, badge.id)) newlyEarned.push(badge);
      }
      continue;
    }

    if (badge.kind === "counter" && badge.scope && badge.threshold != null) {
      let count = 0;
      if (badge.scope === "total") {
        count = totalClaimed;
      } else if (badge.scope.startsWith("category:") && badge.scope.includes(":mode:")) {
        const [, categoryId, , mode] = badge.scope.split(":");
        count = byCategoryMode.get(`${categoryId}:${mode}`) || 0;
      } else if (badge.scope.startsWith("category:")) {
        const categoryId = badge.scope.split(":")[1];
        count = byCategory.get(categoryId) || 0;
      } else if (badge.scope.startsWith("mode:")) {
        const mode = badge.scope.split(":")[1];
        count = byMode.get(mode) || 0;
      } else {
        continue; // checkin:* counter scopes are handled in checkins.ts
      }

      if (count >= badge.threshold) {
        if (await awardBadge(env, accountId, badge.id)) newlyEarned.push(badge);
      }
    }
  }

  return newlyEarned;
}

/** Evaluates the time-served badges (Still Going / The Long Haul / Long Haul x3) after a check-in. */
export async function evaluateTimeServedBadges(
  env: Env,
  accountId: string,
  checkinStage: "3mo" | "6mo"
): Promise<Badge[]> {
  const [allBadges, earned] = await Promise.all([listBadges(env), listEarnedBadgeIds(env, accountId)]);
  const newlyEarned: Badge[] = [];

  const scope = `checkin:${checkinStage}`;
  const relevant = allBadges.filter((b) => b.scope === scope && !earned.has(b.id));

  if (checkinStage === "6mo") {
    const states = await listUserActionState(env, accountId);
    const heldTo6mo = states.filter(
      (s) => s.status === "claimed" && s.lastCheckinResult === "holding" && s.nextCheckinDue === null
    ).length;

    for (const badge of relevant) {
      const threshold = badge.threshold ?? 1;
      if (heldTo6mo >= threshold) {
        if (await awardBadge(env, accountId, badge.id)) newlyEarned.push(badge);
      }
    }
  } else {
    for (const badge of relevant) {
      if (await awardBadge(env, accountId, badge.id)) newlyEarned.push(badge);
    }
  }

  return newlyEarned;
}
