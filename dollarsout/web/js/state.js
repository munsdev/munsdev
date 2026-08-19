// Guest (signed-out) state engine. Spec §1: the app must work completely, immediately,
// unauthenticated -- so claims, badges, and levels all have to be computable entirely client-side
// here, mirroring worker/src/badges.ts + db.ts's logic. Keep the two in sync if either changes.

const STORAGE_KEY = "dollarsout:guestState";
const DAY_MS = 24 * 60 * 60 * 1000;

export const LEVEL_LADDER = [
  { level: 0, name: "Bystander", min: 0 },
  { level: 1, name: "Rookie", min: 1 },
  { level: 2, name: "Starter", min: 3 },
  { level: 3, name: "Mover", min: 6 },
  { level: 4, name: "Switcher", min: 10 },
  { level: 5, name: "Divester", min: 15 },
  { level: 6, name: "Legend", min: 25 },
  { level: 7, name: "Untouchable", min: 40 },
];

export function computeLevel(totalClaimed) {
  let current = LEVEL_LADDER[0];
  for (const l of LEVEL_LADDER) if (totalClaimed >= l.min) current = l;
  const next = LEVEL_LADDER.find((l) => l.min > totalClaimed);
  return {
    level: current.level,
    name: current.name,
    actionsToNext: next ? next.min - totalClaimed : 0,
    nextName: next?.name ?? null,
  };
}

function blank() {
  return { states: {}, earnedBadgeIds: [] };
}

export function loadGuestState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : blank();
  } catch {
    return blank();
  }
}

function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearGuestState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasGuestProgress() {
  const s = loadGuestState();
  return Object.keys(s.states).length > 0;
}

function claimedStates(state) {
  return Object.entries(state.states)
    .filter(([, s]) => s.status === "claimed")
    .map(([actionId, s]) => ({ actionId, ...s }));
}

function evaluateBadges(state, catalog, justClaimedActionId) {
  const actionsById = new Map(catalog.actions.map((a) => [a.id, a]));
  const claimed = claimedStates(state);
  const totalClaimed = claimed.length;

  const byCategory = new Map();
  const byMode = new Map();
  const byCategoryMode = new Map();
  for (const s of claimed) {
    const action = actionsById.get(s.actionId);
    if (!action) continue;
    byCategory.set(action.categoryId, (byCategory.get(action.categoryId) || 0) + 1);
    byMode.set(action.mode, (byMode.get(action.mode) || 0) + 1);
    const key = `${action.categoryId}:${action.mode}`;
    byCategoryMode.set(key, (byCategoryMode.get(key) || 0) + 1);
  }

  const earned = new Set(state.earnedBadgeIds);
  const newlyEarned = [];

  for (const badge of catalog.badges) {
    if (earned.has(badge.id)) continue;

    if (badge.kind === "one_shot") {
      if (badge.actionId === justClaimedActionId) {
        earned.add(badge.id);
        newlyEarned.push(badge);
      }
      continue;
    }

    if (badge.kind === "counter" && badge.scope && badge.threshold != null) {
      let count = 0;
      if (badge.scope === "total") count = totalClaimed;
      else if (badge.scope.startsWith("category:") && badge.scope.includes(":mode:")) {
        const [, categoryId, , mode] = badge.scope.split(":");
        count = byCategoryMode.get(`${categoryId}:${mode}`) || 0;
      } else if (badge.scope.startsWith("category:")) {
        count = byCategory.get(badge.scope.split(":")[1]) || 0;
      } else if (badge.scope.startsWith("mode:")) {
        count = byMode.get(badge.scope.split(":")[1]) || 0;
      } else {
        continue; // checkin:* scopes handled in evaluateTimeServedBadges
      }
      if (count >= badge.threshold) {
        earned.add(badge.id);
        newlyEarned.push(badge);
      }
    }
  }

  state.earnedBadgeIds = [...earned];
  return newlyEarned;
}

function evaluateTimeServedBadges(state, catalog, stage) {
  const earned = new Set(state.earnedBadgeIds);
  const newlyEarned = [];
  const scope = `checkin:${stage}`;
  const relevant = catalog.badges.filter((b) => b.scope === scope && !earned.has(b.id));

  if (stage === "6mo") {
    const heldTo6mo = claimedStates(state).filter(
      (s) => s.lastCheckinResult === "holding" && s.nextCheckinDue === null
    ).length;
    for (const badge of relevant) {
      if (heldTo6mo >= (badge.threshold ?? 1)) {
        earned.add(badge.id);
        newlyEarned.push(badge);
      }
    }
  } else {
    for (const badge of relevant) {
      earned.add(badge.id);
      newlyEarned.push(badge);
    }
  }

  state.earnedBadgeIds = [...earned];
  return newlyEarned;
}

export function claimGuest(catalog, actionId, moneyRedirectedEuros, whatBroke) {
  const state = loadGuestState();
  const action = catalog.actions.find((a) => a.id === actionId);
  if (!action) throw new Error("unknown_action");

  const totalBefore = claimedStates(state).length;
  const levelBefore = computeLevel(totalBefore);

  const now = new Date().toISOString();
  const existing = state.states[actionId];
  const moneyCents = moneyRedirectedEuros != null ? Math.round(moneyRedirectedEuros * 100) : null;
  const nextCheckinDue = action.isTimeServed ? new Date(Date.now() + 90 * DAY_MS).toISOString() : null;

  state.states[actionId] = {
    status: "claimed",
    moneyRedirectedCents: moneyCents,
    whatBroke: whatBroke?.trim() ? whatBroke.trim().slice(0, 500) : null,
    claimedAt: now,
    startDate: existing?.startDate || now,
    lastCheckinAt: existing?.lastCheckinAt || null,
    lastCheckinResult: existing?.lastCheckinResult || null,
    nextCheckinDue: existing?.nextCheckinDue ?? nextCheckinDue,
  };

  const newBadges = evaluateBadges(state, catalog, actionId);
  const totalAfter = claimedStates(state).length;
  const levelAfter = computeLevel(totalAfter);
  save(state);

  return {
    state: { actionId, ...state.states[actionId] },
    newBadges,
    levelUp: levelAfter.level > levelBefore.level ? levelAfter : null,
  };
}

export function undoClaimGuest(actionId) {
  const state = loadGuestState();
  if (state.states[actionId]?.status === "claimed") delete state.states[actionId];
  save(state);
}

export function markNAGuest(actionId) {
  const state = loadGuestState();
  state.states[actionId] = { status: "na" };
  save(state);
}

export function undoNAGuest(actionId) {
  const state = loadGuestState();
  if (state.states[actionId]?.status === "na") delete state.states[actionId];
  save(state);
}

export function checkinGuest(catalog, actionId, result) {
  const state = loadGuestState();
  const existing = state.states[actionId];
  if (!existing || existing.status !== "claimed") return null;

  const now = new Date().toISOString();
  let nextDue;
  let stage = null;
  if (result === "went_back") {
    nextDue = new Date(Date.now() + 90 * DAY_MS).toISOString();
  } else {
    const claimedAt = new Date(existing.claimedAt).getTime();
    const monthsHeld = (Date.now() - claimedAt) / (30 * DAY_MS);
    if (monthsHeld < 5.5) {
      nextDue = new Date(Date.now() + 90 * DAY_MS).toISOString();
      stage = "3mo";
    } else {
      nextDue = null;
      stage = "6mo";
    }
  }

  existing.lastCheckinAt = now;
  existing.lastCheckinResult = result;
  existing.nextCheckinDue = nextDue;

  let newBadges = [];
  if (stage) newBadges = evaluateTimeServedBadges(state, catalog, stage);

  save(state);
  return { state: { actionId, ...existing }, newBadges };
}

export function listDueCheckinsGuest() {
  const state = loadGuestState();
  const nowIso = new Date().toISOString();
  return Object.entries(state.states)
    .filter(([, s]) => s.status === "claimed" && s.nextCheckinDue && s.nextCheckinDue <= nowIso)
    .map(([actionId, s]) => ({ actionId, ...s }));
}

export function guestSummary(catalog) {
  const state = loadGuestState();
  const claimed = claimedStates(state);
  const naList = Object.entries(state.states)
    .filter(([, s]) => s.status === "na")
    .map(([actionId]) => actionId);
  const level = computeLevel(claimed.length);
  const actionsById = new Map(catalog.actions.map((a) => [a.id, a]));

  const stillHolding = claimed.filter((s) => {
    const action = actionsById.get(s.actionId);
    return action?.isTimeServed && s.nextCheckinDue !== null;
  }).length;

  const ledgerEntries = claimed
    .filter((s) => s.moneyRedirectedCents != null && s.moneyRedirectedCents > 0)
    .map((s) => ({
      actionId: s.actionId,
      actionName: actionsById.get(s.actionId)?.name ?? s.actionId,
      cents: s.moneyRedirectedCents,
    }));
  const totalRedirectedCents = ledgerEntries.reduce((sum, e) => sum + e.cents, 0);
  const earnedBadges = catalog.badges.filter((b) => state.earnedBadgeIds.includes(b.id));

  return {
    level,
    stats: {
      actionsTaken: claimed.length,
      redirectedCents: totalRedirectedCents,
      badgesEarned: earnedBadges.length,
      stillHolding,
    },
    ledger: ledgerEntries,
    badges: earnedBadges,
    states: { claimed, na: naList },
  };
}

/** Replays local guest claims/NA marks into a freshly signed-in account, then clears local state. */
export async function migrateGuestStateToAccount(api) {
  const state = loadGuestState();
  const entries = Object.entries(state.states);
  for (const [actionId, s] of entries) {
    try {
      if (s.status === "claimed") {
        const euros = s.moneyRedirectedCents != null ? s.moneyRedirectedCents / 100 : null;
        await api.claim(actionId, euros, s.whatBroke);
      } else if (s.status === "na") {
        await api.markNA(actionId);
      }
    } catch {
      // best-effort replay -- one failed item shouldn't block the rest
    }
  }
  clearGuestState();
}
