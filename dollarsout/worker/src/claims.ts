import type { Account, Action, Env } from "./types";
import {
  bumpCounters,
  getAction,
  getUserActionState,
  lastRepeatableClaimAt,
  listActions,
  listDueCheckins,
  listUserActionState,
  listUserCounters,
  logAnomaly,
  logRepeatableClaim,
  markNA,
  recordCheckin,
  undoClaim,
  undoNA,
  upsertClaim,
} from "./db";
import {
  buildBadgeGrid,
  computeLevel,
  evaluateAfterClaim,
  evaluateTimeServedBadges,
} from "./badges";

export interface ClaimRequestBody {
  actionId: string;
  /**
   * "I did this before finding the app" -- an ISO date the user picks on the claim sheet.
   * This replaces what used to be a standalone action and badge, and applies to every action
   * rather than being a one-off thing to log once.
   */
  claimedAt?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a backdated claim may reach. Two years is generous; beyond it is noise. */
const MAX_BACKDATE_DAYS = 730;

/**
 * Validates a user-supplied claim date.
 *
 * Returns the resolved timestamp, or null if the input was present but unusable -- the caller
 * turns that into a 400 rather than silently falling back to now, since silently ignoring the
 * date would record the wrong thing.
 */
function resolveClaimedAt(raw: string | undefined): { at: string; backdated: boolean } | null {
  if (!raw) return { at: new Date().toISOString(), backdated: false };

  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  const now = Date.now();
  if (ts > now + 60_000) return null; // no claiming the future
  if (ts < now - MAX_BACKDATE_DAYS * DAY_MS) return null;

  return { at: new Date(ts).toISOString(), backdated: ts < now - 60_000 };
}

/** Very light anomaly signal per spec S7.5 -- logged for manual review, never auto-acted on. */
async function flagIfBurstClaiming(env: Env, account: Account) {
  const states = await listUserActionState(env, account.id);
  const recent = states.filter(
    (s) => s.status === "claimed" && s.claimedAt && Date.now() - Date.parse(s.claimedAt) < 60_000
  );
  if (recent.length >= 10) {
    await logAnomaly(env, account.id, "burst_claiming", `${recent.length} claims in under a minute`);
  }
}

export async function handleClaim(env: Env, account: Account, body: ClaimRequestBody) {
  const action = await getAction(env, body.actionId);
  if (!action || action.disabled) return { status: 404 as const, error: "action_not_found" };

  const resolved = resolveClaimedAt(body.claimedAt);
  if (!resolved) return { status: 400 as const, error: "invalid_claim_date" };

  const before = await listUserActionState(env, account.id);
  const levelBefore = computeLevel(totalLoggings(before));

  if (action.recurrence === "repeatable") {
    const last = await lastRepeatableClaimAt(env, account.id, action.id);
    const cooldownMs = (action.cooldownDays ?? 0) * DAY_MS;
    if (last && cooldownMs > 0 && Date.parse(resolved.at) - Date.parse(last) < cooldownMs) {
      return {
        status: 409 as const,
        error: "cooldown_active",
        retryAfter: new Date(Date.parse(last) + cooldownMs).toISOString(),
      };
    }
  } else {
    const existing = await getUserActionState(env, account.id, action.id);
    if (existing?.status === "claimed") return { status: 409 as const, error: "already_claimed" };
  }

  const state =
    action.recurrence === "repeatable"
      ? await logRepeatableClaim(env, account.id, action, resolved.at, resolved.backdated)
      : await upsertClaim(env, account.id, action, resolved.at);

  // Counters move before badges are evaluated, so chain tiers see the post-claim value.
  await bumpCounters(env, account.id, action.counters, 1);

  const [allActions, after] = await Promise.all([
    listActions(env),
    listUserActionState(env, account.id),
  ]);
  const newBadges = await evaluateAfterClaim(env, account.id, action, allActions, after);
  const levelAfter = computeLevel(totalLoggings(after));

  await flagIfBurstClaiming(env, account);

  return {
    status: 200 as const,
    body: {
      state,
      newBadges,
      pointsEarned: action.points,
      levelUp: levelAfter.level > levelBefore.level ? levelAfter : null,
    },
  };
}

export async function handleUndoClaim(env: Env, account: Account, actionId: string) {
  const action = await getAction(env, actionId);
  if (!action) return { status: 404 as const, error: "action_not_found" };

  await undoClaim(env, account.id, action);
  // Badges already earned are kept: withdrawing one logging shouldn't retract an unlock the
  // user has already been told about. The counter comes back down so the next tier still
  // needs the work.
  await bumpCounters(env, account.id, action.counters, -1);

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
  const action = await getAction(env, body.actionId);
  if (!action) return { status: 404 as const, error: "action_not_found" };

  const updated = await recordCheckin(env, account.id, action, body.result);
  if (!updated) return { status: 404 as const, error: "no_active_claim" };

  // Months are banked either way -- see recordCheckin. Time already served counts even if
  // the user has since stopped, so time-served badges are evaluated on both answers.
  const newBadges = await evaluateTimeServedBadges(env, account.id, updated.monthsBanked);

  return { status: 200 as const, body: { state: updated, newBadges } };
}

export async function handleDueCheckins(env: Env, account: Account) {
  const [due, actions] = await Promise.all([listDueCheckins(env, account.id), listActions(env)]);
  const byId = new Map(actions.map((a) => [a.id, a]));
  return {
    status: 200 as const,
    body: due.map((s) => ({ state: s, action: byId.get(s.actionId) ?? null })),
  };
}

/** Each repeat of a repeatable action counts. A single claim_count of 0 still means one. */
function totalLoggings(states: { status: string; claimCount: number }[]): number {
  return states
    .filter((s) => s.status === "claimed")
    .reduce((n, s) => n + Math.max(1, s.claimCount), 0);
}

export async function handleMe(env: Env, account: Account) {
  const [states, actions, grid, counters] = await Promise.all([
    listUserActionState(env, account.id),
    listActions(env),
    buildBadgeGrid(env, account.id),
    listUserCounters(env, account.id),
  ]);
  const actionsById = new Map(actions.map((a) => [a.id, a]));

  const claimed = states.filter((s) => s.status === "claimed");
  const naList = states.filter((s) => s.status === "na");
  const total = totalLoggings(states);
  const level = computeLevel(total);

  const points = claimed.reduce((sum, s) => {
    const a = actionsById.get(s.actionId);
    return a ? sum + a.points * Math.max(1, s.claimCount) : sum;
  }, 0);

  const stillHolding = claimed.filter((s) => {
    const a = actionsById.get(s.actionId);
    return a?.recurrence === "sustained" && s.lastCheckinResult !== "went_back";
  }).length;

  const monthsBanked = claimed.reduce((n, s) => n + s.monthsBanked, 0);

  return {
    status: 200 as const,
    body: {
      account: { email: account.email, memberSince: account.createdAt },
      level,
      stats: {
        actionsTaken: total,
        points,
        badgesEarned:
          grid.badges.filter((b) => b.earnedAt).length +
          grid.chains.filter((c) => c.currentTier > 0).length,
        stillHolding,
        monthsBanked,
      },
      badges: grid.badges,
      chains: grid.chains,
      counters: Object.fromEntries(counters),
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
    env.DB.prepare("DELETE FROM user_claims_log WHERE account_id = ?").bind(account.id),
    env.DB.prepare("DELETE FROM user_counters WHERE account_id = ?").bind(account.id),
    env.DB.prepare("DELETE FROM user_action_state WHERE account_id = ?").bind(account.id),
    env.DB.prepare("DELETE FROM otp_requests WHERE email = ?").bind(account.email),
    env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(account.id),
  ]);
  return { status: 200 as const, body: { ok: true } };
}
