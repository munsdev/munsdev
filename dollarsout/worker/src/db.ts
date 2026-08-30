import type {
  Account,
  Action,
  Badge,
  BadgeChain,
  Category,
  CheckinResult,
  Env,
  UserActionState,
} from "./types";

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToCategory(r: any): Category {
  return {
    id: r.id,
    webflowItemId: r.webflow_item_id,
    name: r.name,
    tagline: r.tagline,
    shortDescription: r.short_description,
    longDescriptionHtml: r.long_description_html,
    disclaimer: r.disclaimer,
    colorKey: r.color_key,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

function rowToAction(r: any): Action {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    shortDescription: r.short_description,
    longDescriptionHtml: r.long_description_html,
    points: r.points,
    recurrence: r.recurrence,
    cooldownDays: r.cooldown_days,
    checkinDays: r.checkin_days,
    scopeRegion: r.scope_region,
    targets: parseJson(r.targets, {}),
    counters: parseJson(r.counters, [] as string[]),
    helpfulLinks: parseJson(r.helpful_links, []),
    effort: r.effort,
    timeEstimate: r.time_estimate,
    isStarter: !!r.is_starter,
    sortOrder: r.sort_order,
    disabled: !!r.disabled,
  };
}

function rowToBadge(r: any): Badge {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon,
    kind: r.kind,
    actionId: r.action_id,
    threshold: r.threshold,
    scope: r.scope,
    sortOrder: r.sort_order,
  };
}

function rowToState(r: any): UserActionState {
  return {
    id: r.id,
    accountId: r.account_id,
    actionId: r.action_id,
    status: r.status,
    claimedAt: r.claimed_at,
    startDate: r.start_date,
    lastCheckinAt: r.last_checkin_at,
    lastCheckinResult: r.last_checkin_result,
    nextCheckinDue: r.next_checkin_due,
    monthsBanked: r.months_banked ?? 0,
    claimCount: r.claim_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToAccount(r: any): Account {
  return {
    id: r.id,
    email: r.email,
    createdAt: r.created_at,
    quarantineUntil: r.quarantine_until,
    status: r.status,
  };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
export async function listCategories(env: Env): Promise<Category[]> {
  const { results } = await env.DB.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all();
  return (results || []).map(rowToCategory);
}

export async function listActions(env: Env): Promise<Action[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM actions WHERE disabled = 0 ORDER BY category_id, sort_order ASC"
  ).all();
  return (results || []).map(rowToAction);
}

export async function getAction(env: Env, id: string): Promise<Action | null> {
  const row = await env.DB.prepare("SELECT * FROM actions WHERE id = ?").bind(id).first();
  return row ? rowToAction(row) : null;
}

export async function listBadges(env: Env): Promise<Badge[]> {
  const { results } = await env.DB.prepare("SELECT * FROM badges ORDER BY sort_order ASC").all();
  return (results || []).map(rowToBadge);
}

/** Chains with their tiers attached, ordered so tier 1 comes first. */
export async function listBadgeChains(env: Env): Promise<BadgeChain[]> {
  const [chains, tiers] = await Promise.all([
    env.DB.prepare("SELECT * FROM badge_chains ORDER BY sort_order ASC").all(),
    env.DB.prepare("SELECT * FROM badge_tiers ORDER BY chain_id, tier ASC").all(),
  ]);

  const byChain = new Map<string, BadgeChain["tiers"]>();
  for (const t of (tiers.results || []) as any[]) {
    const list = byChain.get(t.chain_id) || [];
    list.push({ id: t.id, chainId: t.chain_id, tier: t.tier, name: t.name, threshold: t.threshold });
    byChain.set(t.chain_id, list);
  }

  return ((chains.results || []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    counter: c.counter,
    icon: c.icon,
    sortOrder: c.sort_order,
    tiers: byChain.get(c.id) || [],
  }));
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export async function getAccountByEmail(env: Env, email: string): Promise<Account | null> {
  const row = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
  return row ? rowToAccount(row) : null;
}

export async function getAccountById(env: Env, id: string): Promise<Account | null> {
  const row = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first();
  return row ? rowToAccount(row) : null;
}

export async function createAccount(
  env: Env,
  email: string,
  signupIp: string | null
): Promise<Account> {
  const id = crypto.randomUUID();
  const now = new Date();
  const quarantineUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO accounts (id, email, quarantine_until, signup_ip) VALUES (?, ?, ?, ?)"
  )
    .bind(id, email, quarantineUntil, signupIp)
    .run();
  return { id, email, createdAt: now.toISOString(), quarantineUntil, status: "active" };
}

/** Rank of this account by signup order, 1-based. Drives the Founder badge. */
export async function getAccountOrdinal(env: Env, accountId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM accounts
     WHERE created_at <= (SELECT created_at FROM accounts WHERE id = ?)`
  )
    .bind(accountId)
    .first();
  return (row?.n as number) || 0;
}

// ---------------------------------------------------------------------------
// Action state
// ---------------------------------------------------------------------------
export async function listUserActionState(env: Env, accountId: string): Promise<UserActionState[]> {
  const { results } = await env.DB.prepare("SELECT * FROM user_action_state WHERE account_id = ?")
    .bind(accountId)
    .all();
  return (results || []).map(rowToState);
}

export async function getUserActionState(
  env: Env,
  accountId: string,
  actionId: string
): Promise<UserActionState | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM user_action_state WHERE account_id = ? AND action_id = ?"
  )
    .bind(accountId, actionId)
    .first();
  return row ? rowToState(row) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Records a claim of a `once` or `sustained` action.
 *
 * `claimedAt` may be backdated -- the claim UI offers "I did this before finding the app",
 * which replaces what used to be a standalone action and badge of its own. A backdated claim
 * outside the rolling window simply doesn't count toward the public meter, which is correct:
 * the meter measures recent activity, not lifetime history.
 */
export async function upsertClaim(
  env: Env,
  accountId: string,
  action: Action,
  claimedAt: string
): Promise<UserActionState> {
  const existing = await getUserActionState(env, accountId, action.id);
  const now = new Date().toISOString();
  const nextCheckinDue =
    action.recurrence === "sustained" && action.checkinDays
      ? new Date(Date.parse(claimedAt) + action.checkinDays * DAY_MS).toISOString()
      : null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE user_action_state SET status='claimed',
       claimed_at=?, start_date=COALESCE(start_date, ?), next_checkin_due=?, updated_at=?
       WHERE id=?`
    )
      .bind(claimedAt, claimedAt, nextCheckinDue, now, existing.id)
      .run();
    return { ...existing, status: "claimed", claimedAt, nextCheckinDue, updatedAt: now };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_action_state
     (id, account_id, action_id, status, claimed_at, start_date, next_checkin_due)
     VALUES (?, ?, ?, 'claimed', ?, ?, ?)`
  )
    .bind(id, accountId, action.id, claimedAt, claimedAt, nextCheckinDue)
    .run();

  return {
    id,
    accountId,
    actionId: action.id,
    status: "claimed",
    claimedAt,
    startDate: claimedAt,
    lastCheckinAt: null,
    lastCheckinResult: null,
    nextCheckinDue,
    monthsBanked: 0,
    claimCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** When a repeatable action was last logged, or null if never. */
export async function lastRepeatableClaimAt(
  env: Env,
  accountId: string,
  actionId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT claimed_at FROM user_claims_log WHERE account_id=? AND action_id=? ORDER BY claimed_at DESC LIMIT 1"
  )
    .bind(accountId, actionId)
    .first();
  return (row?.claimed_at as string) ?? null;
}

/**
 * Logs one occurrence of a `repeatable` action.
 *
 * These can't live in user_action_state -- it is UNIQUE(account_id, action_id) by design, and
 * a repeatable action needs per-claim history to enforce the cooldown and to let each logging
 * count once toward the rolling meter. A summary row is kept in user_action_state alongside so
 * the action still reads as "claimed" in the grid without a second query per tile.
 */
export async function logRepeatableClaim(
  env: Env,
  accountId: string,
  action: Action,
  claimedAt: string,
  backdated: boolean
): Promise<UserActionState> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO user_claims_log (id, account_id, action_id, claimed_at, backdated) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), accountId, action.id, claimedAt, backdated ? 1 : 0)
    .run();

  const existing = await getUserActionState(env, accountId, action.id);
  if (existing) {
    await env.DB.prepare(
      `UPDATE user_action_state SET status='claimed', claimed_at=?,
       claim_count=claim_count+1, updated_at=? WHERE id=?`
    )
      .bind(claimedAt, now, existing.id)
      .run();
    return {
      ...existing,
      status: "claimed",
      claimedAt,
      claimCount: existing.claimCount + 1,
      updatedAt: now,
    };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_action_state
     (id, account_id, action_id, status, claimed_at, start_date, claim_count)
     VALUES (?, ?, ?, 'claimed', ?, ?, 1)`
  )
    .bind(id, accountId, action.id, claimedAt, claimedAt)
    .run();

  return {
    id,
    accountId,
    actionId: action.id,
    status: "claimed",
    claimedAt,
    startDate: claimedAt,
    lastCheckinAt: null,
    lastCheckinResult: null,
    nextCheckinDue: null,
    monthsBanked: 0,
    claimCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Withdraws the most recent logging. For repeatable actions that's the latest log row only. */
export async function undoClaim(env: Env, accountId: string, action: Action): Promise<void> {
  if (action.recurrence === "repeatable") {
    await env.DB.prepare(
      `DELETE FROM user_claims_log WHERE id = (
         SELECT id FROM user_claims_log WHERE account_id=? AND action_id=?
         ORDER BY claimed_at DESC LIMIT 1)`
    )
      .bind(accountId, action.id)
      .run();
    await env.DB.prepare(
      `UPDATE user_action_state SET claim_count = MAX(claim_count - 1, 0), updated_at=?
       WHERE account_id=? AND action_id=?`
    )
      .bind(new Date().toISOString(), accountId, action.id)
      .run();
    await env.DB.prepare(
      "DELETE FROM user_action_state WHERE account_id=? AND action_id=? AND claim_count = 0"
    )
      .bind(accountId, action.id)
      .run();
    return;
  }

  await env.DB.prepare(
    "DELETE FROM user_action_state WHERE account_id=? AND action_id=? AND status='claimed'"
  )
    .bind(accountId, action.id)
    .run();
}

export async function markNA(env: Env, accountId: string, actionId: string): Promise<void> {
  const existing = await getUserActionState(env, accountId, actionId);
  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare("UPDATE user_action_state SET status='na', updated_at=? WHERE id=?")
      .bind(now, existing.id)
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO user_action_state (id, account_id, action_id, status) VALUES (?, ?, ?, 'na')"
  )
    .bind(crypto.randomUUID(), accountId, actionId)
    .run();
}

export async function undoNA(env: Env, accountId: string, actionId: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM user_action_state WHERE account_id=? AND action_id=? AND status='na'"
  )
    .bind(accountId, actionId)
    .run();
}

/**
 * Records a check-in on a sustained action.
 *
 * Time held is *banked*, not streaked: "I stopped" credits the months already served and
 * restarts the clock from today rather than zeroing the total. Someone who held a bank switch
 * for five months and then lapsed has still moved money for five months, and the UI should not
 * tell them otherwise.
 */
export async function recordCheckin(
  env: Env,
  accountId: string,
  action: Action,
  result: CheckinResult
): Promise<UserActionState | null> {
  const existing = await getUserActionState(env, accountId, action.id);
  if (!existing || existing.status !== "claimed") return null;

  const now = new Date().toISOString();
  const interval = (action.checkinDays ?? 90) * DAY_MS;
  const since = Date.parse(existing.lastCheckinAt || existing.claimedAt || existing.createdAt);
  const monthsThisPeriod = Math.max(0, Math.round((Date.now() - since) / (30 * DAY_MS)));
  const monthsBanked = existing.monthsBanked + monthsThisPeriod;
  const nextDue = new Date(Date.now() + interval).toISOString();

  await env.DB.prepare(
    `UPDATE user_action_state SET last_checkin_at=?, last_checkin_result=?, next_checkin_due=?,
     months_banked=?, updated_at=? WHERE id=?`
  )
    .bind(now, result, nextDue, monthsBanked, now, existing.id)
    .run();

  return {
    ...existing,
    lastCheckinAt: now,
    lastCheckinResult: result,
    nextCheckinDue: nextDue,
    monthsBanked,
    updatedAt: now,
  };
}

export async function listDueCheckins(env: Env, accountId: string): Promise<UserActionState[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM user_action_state WHERE account_id=? AND status='claimed'
     AND next_checkin_due IS NOT NULL AND next_checkin_due <= ?`
  )
    .bind(accountId, new Date().toISOString())
    .all();
  return (results || []).map(rowToState);
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------
export async function listUserCounters(env: Env, accountId: string): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    "SELECT counter, value FROM user_counters WHERE account_id=?"
  )
    .bind(accountId)
    .all();
  return new Map((results || []).map((r: any) => [r.counter, r.value as number]));
}

/** Moves every counter an action carries by `delta`, clamped at zero so undo can't go negative. */
export async function bumpCounters(
  env: Env,
  accountId: string,
  counters: string[],
  delta: number
): Promise<void> {
  if (!counters.length) return;
  await env.DB.batch(
    counters.map((c) =>
      env.DB.prepare(
        `INSERT INTO user_counters (account_id, counter, value) VALUES (?, ?, MAX(?, 0))
         ON CONFLICT(account_id, counter) DO UPDATE SET value = MAX(value + ?, 0)`
      ).bind(accountId, c, delta, delta)
    )
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
export async function listEarnedBadgeIds(env: Env, accountId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare("SELECT badge_id FROM user_badges WHERE account_id=?")
    .bind(accountId)
    .all();
  return new Set((results || []).map((r: any) => r.badge_id));
}

/** badgeId -> when it was earned, for the achievement sheet's "Unlocked N ago" line. */
export async function listEarnedBadgeDates(
  env: Env,
  accountId: string
): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare(
    "SELECT badge_id, earned_at FROM user_badges WHERE account_id=?"
  )
    .bind(accountId)
    .all();
  return new Map((results || []).map((r: any) => [r.badge_id, r.earned_at]));
}

export async function awardBadge(env: Env, accountId: string, badgeId: string): Promise<boolean> {
  try {
    await env.DB.prepare("INSERT INTO user_badges (id, account_id, badge_id) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), accountId, badgeId)
      .run();
    return true;
  } catch {
    return false; // already earned (UNIQUE constraint)
  }
}

/**
 * How many active accounts hold each badge, and how many accounts there are.
 *
 * Rarity is derived from this at read time rather than stored per badge: a stored percentage
 * is wrong the moment anyone else earns one, and this is a single grouped count over a small
 * table.
 */
export async function badgeEarnedCounts(
  env: Env
): Promise<{ counts: Map<string, number>; activeAccounts: number }> {
  const [earned, accounts] = await Promise.all([
    env.DB.prepare(
      `SELECT ub.badge_id, COUNT(*) as n FROM user_badges ub
       JOIN accounts a ON a.id = ub.account_id
       WHERE a.status = 'active' GROUP BY ub.badge_id`
    ).all(),
    env.DB.prepare("SELECT COUNT(*) as n FROM accounts WHERE status = 'active'").first(),
  ]);
  return {
    counts: new Map((earned.results || []).map((r: any) => [r.badge_id, r.n as number])),
    activeAccounts: (accounts?.n as number) || 0,
  };
}

// ---------------------------------------------------------------------------
// Public meter
// ---------------------------------------------------------------------------
/** How far back the public meter looks. Claims older than this roll off it on their own. */
export const ROLLING_WINDOW_DAYS = 90;
const WINDOW_START_SQL = `datetime('now', '-${ROLLING_WINDOW_DAYS} days')`;

/**
 * The meter's target.
 *
 * This used to be a column on a calendar `aggregate_periods` row that had to be replaced by
 * hand every month; forgetting made `getCurrentPeriod()` return nothing and blanked the whole
 * meter. The window has been fully rolling for a while, so the period boundaries weren't doing
 * anything -- a single settings row has no successor to forget.
 */
export async function getMeterGoal(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'meter_goal'").first();
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

/**
 * Counts loggings inside the rolling window that feeds the public meter.
 *
 * Both halves count: `once`/`sustained` actions contribute their single user_action_state row,
 * and each logging of a `repeatable` action contributes its own user_claims_log row -- otherwise
 * taking the train ten times would move the needle exactly as much as taking it once.
 */
export async function countClaimsInWindow(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT (
       SELECT COUNT(*) FROM user_action_state uas
       JOIN accounts a ON a.id = uas.account_id
       JOIN actions act ON act.id = uas.action_id
       WHERE uas.status = 'claimed' AND uas.claimed_at >= ${WINDOW_START_SQL}
         AND a.status = 'active' AND act.recurrence != 'repeatable'
     ) + (
       SELECT COUNT(*) FROM user_claims_log ucl
       JOIN accounts a2 ON a2.id = ucl.account_id
       WHERE ucl.claimed_at >= ${WINDOW_START_SQL} AND a2.status = 'active'
     ) as n`
  ).first();
  return (row?.n as number) || 0;
}

export async function countVerifiedClaimsForAction(env: Env, actionId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT (
       SELECT COUNT(*) FROM user_action_state uas
       JOIN accounts a ON a.id = uas.account_id
       JOIN actions act ON act.id = uas.action_id
       WHERE uas.status = 'claimed' AND uas.action_id = ?1
         AND uas.claimed_at >= ${WINDOW_START_SQL} AND a.status = 'active'
         AND act.recurrence != 'repeatable'
     ) + (
       SELECT COUNT(*) FROM user_claims_log ucl
       JOIN accounts a2 ON a2.id = ucl.account_id
       WHERE ucl.action_id = ?1 AND ucl.claimed_at >= ${WINDOW_START_SQL}
         AND a2.status = 'active'
     ) as n`
  )
    .bind(actionId)
    .first();
  return (row?.n as number) || 0;
}

export async function countVerifiedPeople(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM accounts WHERE status = 'active'"
  ).first();
  return (row?.n as number) || 0;
}

export async function listActiveCommunityGoals(
  env: Env
): Promise<{ id: string; label: string; goal: number; scopeActionId: string | null }[]> {
  const { results } = await env.DB.prepare("SELECT * FROM community_goals WHERE active = 1").all();
  return (results || []).map((r: any) => ({
    id: r.id,
    label: r.label,
    goal: r.goal,
    scopeActionId: r.scope_action_id,
  }));
}

export async function logAnomaly(
  env: Env,
  accountId: string | null,
  signal: string,
  detail: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO anomaly_log (id, account_id, signal, detail) VALUES (?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), accountId, signal, detail)
    .run();
}

export interface LedgerEntry {
  actionName: string;
  claimedAt: string;
}

/**
 * Global, fully anonymized activity feed -- action name and timestamp only, never an account id,
 * email, or anything else that could identify who did it. Repeatable loggings appear here too,
 * so an active user shows up as repeated activity rather than one entry forever.
 */
export async function listRecentClaimsGlobal(
  env: Env,
  limit: number,
  offset: number
): Promise<LedgerEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT action_name, claimed_at FROM (
       SELECT a.name as action_name, uas.claimed_at as claimed_at
       FROM user_action_state uas
       JOIN actions a ON a.id = uas.action_id
       JOIN accounts acc ON acc.id = uas.account_id
       WHERE uas.status = 'claimed' AND acc.status = 'active' AND a.recurrence != 'repeatable'
       UNION ALL
       SELECT a2.name as action_name, ucl.claimed_at as claimed_at
       FROM user_claims_log ucl
       JOIN actions a2 ON a2.id = ucl.action_id
       JOIN accounts acc2 ON acc2.id = ucl.account_id
       WHERE acc2.status = 'active'
     ) ORDER BY claimed_at DESC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();
  return (results || []).map((r: any) => ({ actionName: r.action_name, claimedAt: r.claimed_at }));
}
