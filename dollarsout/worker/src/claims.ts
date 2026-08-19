import type { Account, Env } from "./types";
import {
  getAction,
  getUserActionState,
  listActions,
  listBadges,
  listDueCheckins,
  listEarnedBadgeIds,
  listUserActionState,
  logAnomaly,
  markNA,
  recordCheckin,
  undoClaim,
  undoNA,
  upsertClaim,
} from "./db";
import { computeLevel, evaluateBadgesAfterClaim, evaluateTimeServedBadges } from "./badges";

export interface ClaimRequestBody {
  actionId: string;
}

/** Very light anomaly signal per spec S7.5 -- logged for manual review, never auto-acted on. */
async function flagIfBurstClaiming(env: Env, account: Account) {
  const states = await listUserActionState(env, account.id);
  const recentClaims = states.filter(
    (s) => s.status === "claimed" && s.claimedAt && Date.now() - new Date(s.claimedAt).getTime() < 60_000
  );
  if (recentClaims.length >= 10) {
    await logAnomaly(env, account.id, "burst_claiming", `${recentClaims.length} claims in under a minute`);
  }
}

export async function handleClaim(env: Env, account: Account, body: ClaimRequestBody) {
  const action = await getAction(env, body.actionId);
  if (!action || action.disabled) return { status: 404 as const, error: "action_not_found" };

  const before = await listUserActionState(env, account.id);
  const totalBefore = before.filter((s) => s.status === "claimed").length;
  const levelBefore = computeLevel(totalBefore);

  const state = await upsertClaim(env, account.id, action.id, action.isTimeServed);

  const allActions = await listActions(env);
  const actionsById = new Map(allActions.map((a) => [a.id, a]));
  const newBadges = await evaluateBadgesAfterClaim(env, account.id, action, actionsById);

  const after = await listUserActionState(env, account.id);
  const totalAfter = after.filter((s) => s.status === "claimed").length;
  const levelAfter = computeLevel(totalAfter);

  await flagIfBurstClaiming(env, account);

  return {
    status: 200 as const,
    body: {
      state,
      newBadges,
      levelUp: levelAfter.level > levelBefore.level ? levelAfter : null,
    },
  };
}

export async function handleUndoClaim(env: Env, account: Account, actionId: string) {
  await undoClaim(env, account.id, actionId);
  return { status: 200 as const, body: { ok: true } };
}

export async function handleMarkNA(env: Env, account: Account, actionId: string) {
  const action = await getAction(env, actionId);
  if (!action) return { status: 404 as const, error: "action_not_found" };
  await markNA(env, account.id, actionId);
  return { status: 200 as const, body: { ok: true } };
}

export async function handleUndoNA(env: Env, account: Account, actionId: string) {
  await undoNA(env, account.id, actionId);
  return { status: 200 as const, body: { ok: true } };
}

export interface CheckinRequestBody {
  actionId: string;
  result: "holding" | "went_back";
}

export async function handleCheckin(env: Env, account: Account, body: CheckinRequestBody) {
  const before = await getUserActionState(env, account.id, body.actionId);
  const updated = await recordCheckin(env, account.id, body.actionId, body.result);
  if (!updated) return { status: 404 as const, error: "no_active_claim" };

  let newBadges: Awaited<ReturnType<typeof evaluateTimeServedBadges>> = [];
  if (body.result === "holding") {
    // If next_checkin_due just became null, this check-in cleared the 6-month mark; otherwise it
    // cleared the 3-month mark (see recordCheckin's threshold logic in db.ts).
    const stage = updated.nextCheckinDue === null ? "6mo" : "3mo";
    newBadges = await evaluateTimeServedBadges(env, account.id, stage);
  }

  return { status: 200 as const, body: { state: updated, newBadges } };
}

export async function handleDueCheckins(env: Env, account: Account) {
  const due = await listDueCheckins(env, account.id);
  const actions = await listActions(env);
  const byId = new Map(actions.map((a) => [a.id, a]));
  return {
    status: 200 as const,
    body: due.map((s) => ({ state: s, action: byId.get(s.actionId) ?? null })),
  };
}

export async function handleMe(env: Env, account: Account) {
  const [states, earnedBadgeIds, allBadges, actions] = await Promise.all([
    listUserActionState(env, account.id),
    listEarnedBadgeIds(env, account.id),
    listBadges(env),
    listActions(env),
  ]);
  const actionsById = new Map(actions.map((a) => [a.id, a]));

  const claimed = states.filter((s) => s.status === "claimed");
  const naList = states.filter((s) => s.status === "na");
  const totalClaimed = claimed.length;
  const level = computeLevel(totalClaimed);

  const stillHolding = claimed.filter((s) => {
    const action = actionsById.get(s.actionId);
    return action?.isTimeServed && s.nextCheckinDue !== null;
  }).length;

  const earnedBadges = allBadges.filter((b) => earnedBadgeIds.has(b.id));

  return {
    status: 200 as const,
    body: {
      account: { email: account.email, memberSince: account.createdAt },
      level,
      stats: {
        actionsTaken: totalClaimed,
        badgesEarned: earnedBadges.length,
        stillHolding,
      },
      badges: earnedBadges,
      states: { claimed, na: naList },
    },
  };
}

export async function handleExport(env: Env, account: Account) {
  const me = await handleMe(env, account);
  return {
    status: 200 as const,
    body: { exportedAt: new Date().toISOString(), ...me.body },
  };
}

export async function handleDeleteAccount(env: Env, account: Account) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_badges WHERE account_id = ?").bind(account.id),
    env.DB.prepare("DELETE FROM user_action_state WHERE account_id = ?").bind(account.id),
    env.DB.prepare("DELETE FROM otp_requests WHERE email = ?").bind(account.email),
    env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(account.id),
  ]);
  return { status: 200 as const, body: { ok: true } };
}
