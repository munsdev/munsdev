import type {
  Account,
  Action,
  Badge,
  Category,
  CheckinResult,
  Env,
  UserActionState,
} from "./types";

function rowToCategory(r: any): Category {
  return {
    id: r.id,
    webflowItemId: r.webflow_item_id,
    name: r.name,
    tagline: r.tagline,
    shortDescription: r.short_description,
    longDescriptionHtml: r.long_description_html,
    colorKey: r.color_key,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

function rowToAction(r: any): Action {
  return {
    id: r.id,
    categoryId: r.category_id,
    webflowItemId: r.webflow_item_id,
    name: r.name,
    shortDescription: r.short_description,
    longDescriptionHtml: r.long_description_html,
    mode: r.mode,
    effort: r.effort,
    timeEstimate: r.time_estimate,
    availability: r.availability,
    moneyPresets: JSON.parse(r.money_presets || "[]"),
    helpfulLinks: JSON.parse(r.helpful_links || "[]"),
    isTimeServed: !!r.is_time_served,
    sortOrder: r.sort_order,
    disabled: !!r.disabled,
  };
}

function rowToBadge(r: any): Badge {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    kind: r.kind,
    categoryId: r.category_id,
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
    moneyRedirectedCents: r.money_redirected,
    whatBroke: r.what_broke,
    claimedAt: r.claimed_at,
    startDate: r.start_date,
    lastCheckinAt: r.last_checkin_at,
    lastCheckinResult: r.last_checkin_result,
    nextCheckinDue: r.next_checkin_due,
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

export async function listCategories(env: Env): Promise<Category[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM categories ORDER BY sort_order ASC"
  ).all();
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
  const { results } = await env.DB.prepare(
    "SELECT * FROM badges ORDER BY sort_order ASC"
  ).all();
  return (results || []).map(rowToBadge);
}

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

export async function listUserActionState(
  env: Env,
  accountId: string
): Promise<UserActionState[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM user_action_state WHERE account_id = ?"
  )
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

/** Money/what-broke tracking was removed from the product -- money_redirected and what_broke stay
 *  in the schema as inert legacy columns (always null going forward) rather than risking a
 *  migration for a pre-launch table. */
export async function upsertClaim(
  env: Env,
  accountId: string,
  actionId: string,
  isTimeServed: boolean
): Promise<UserActionState> {
  const existing = await getUserActionState(env, accountId, actionId);
  const now = new Date().toISOString();
  const nextCheckinDue = isTimeServed
    ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 3-month first check-in
    : null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE user_action_state SET status='claimed',
       claimed_at=?, start_date=COALESCE(start_date, ?), next_checkin_due=?, updated_at=?
       WHERE id=?`
    )
      .bind(now, now, nextCheckinDue, now, existing.id)
      .run();
    return { ...existing, status: "claimed", claimedAt: now, updatedAt: now };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_action_state
     (id, account_id, action_id, status, claimed_at, start_date, next_checkin_due)
     VALUES (?, ?, ?, 'claimed', ?, ?, ?)`
  )
    .bind(id, accountId, actionId, now, now, nextCheckinDue)
    .run();

  return {
    id,
    accountId,
    actionId,
    status: "claimed",
    moneyRedirectedCents: null,
    whatBroke: null,
    claimedAt: now,
    startDate: now,
    lastCheckinAt: null,
    lastCheckinResult: null,
    nextCheckinDue,
    createdAt: now,
    updatedAt: now,
  };
}

export async function undoClaim(env: Env, accountId: string, actionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM user_action_state WHERE account_id=? AND action_id=? AND status='claimed'")
    .bind(accountId, actionId)
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
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user_action_state (id, account_id, action_id, status) VALUES (?, ?, ?, 'na')"
  )
    .bind(id, accountId, actionId)
    .run();
}

export async function undoNA(env: Env, accountId: string, actionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM user_action_state WHERE account_id=? AND action_id=? AND status='na'")
    .bind(accountId, actionId)
    .run();
}

export async function recordCheckin(
  env: Env,
  accountId: string,
  actionId: string,
  result: CheckinResult
): Promise<UserActionState | null> {
  const existing = await getUserActionState(env, accountId, actionId);
  if (!existing || existing.status !== "claimed") return null;
  const now = new Date().toISOString();

  let nextDue: string | null;
  if (result === "went_back") {
    // No penalty, no history deletion -- just reset the clock from today.
    nextDue = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    const claimedAt = new Date(existing.claimedAt || existing.createdAt).getTime();
    const monthsHeld = (Date.now() - claimedAt) / (30 * 24 * 60 * 60 * 1000);
    nextDue =
      monthsHeld < 5.5
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // -> 6mo check-in next
        : null; // 6-month mark reached, no further scheduled check-in for now
  }

  await env.DB.prepare(
    "UPDATE user_action_state SET last_checkin_at=?, last_checkin_result=?, next_checkin_due=?, updated_at=? WHERE id=?"
  )
    .bind(now, result, nextDue, now, existing.id)
    .run();

  return { ...existing, lastCheckinAt: now, lastCheckinResult: result, nextCheckinDue: nextDue, updatedAt: now };
}

export async function listDueCheckins(env: Env, accountId: string): Promise<UserActionState[]> {
  const nowIso = new Date().toISOString();
  const { results } = await env.DB.prepare(
    "SELECT * FROM user_action_state WHERE account_id=? AND status='claimed' AND next_checkin_due IS NOT NULL AND next_checkin_due <= ?"
  )
    .bind(accountId, nowIso)
    .all();
  return (results || []).map(rowToState);
}

export async function listEarnedBadgeIds(env: Env, accountId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare("SELECT badge_id FROM user_badges WHERE account_id=?")
    .bind(accountId)
    .all();
  return new Set((results || []).map((r: any) => r.badge_id));
}

export async function awardBadge(env: Env, accountId: string, badgeId: string): Promise<boolean> {
  try {
    await env.DB.prepare(
      "INSERT INTO user_badges (id, account_id, badge_id) VALUES (?, ?, ?)"
    )
      .bind(crypto.randomUUID(), accountId, badgeId)
      .run();
    return true;
  } catch {
    return false; // already earned (UNIQUE constraint)
  }
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

export async function getCurrentPeriod(env: Env): Promise<{ id: string; goal: number; startsAt: string; endsAt: string } | null> {
  const row = await env.DB.prepare("SELECT * FROM aggregate_periods WHERE is_current = 1 LIMIT 1").first();
  if (!row) return null;
  return { id: row.id as string, goal: row.goal as number, startsAt: row.starts_at as string, endsAt: row.ends_at as string };
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

/**
 * Counts claimed actions from accounts past their 48h quarantine window (spec S7.4) --
 * this is the number that feeds public aggregate stats, never the raw claim count.
 */
export async function countVerifiedClaimsInPeriod(
  env: Env,
  startsAt: string,
  endsAt: string
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM user_action_state uas
     JOIN accounts a ON a.id = uas.account_id
     WHERE uas.status = 'claimed' AND uas.claimed_at BETWEEN ? AND ?
       AND a.quarantine_until <= datetime('now') AND a.status = 'active'`
  )
    .bind(startsAt, endsAt)
    .first();
  return (row?.n as number) || 0;
}

export async function countVerifiedClaimsForAction(env: Env, actionId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM user_action_state uas
     JOIN accounts a ON a.id = uas.account_id
     WHERE uas.status = 'claimed' AND uas.action_id = ?
       AND a.quarantine_until <= datetime('now') AND a.status = 'active'`
  )
    .bind(actionId)
    .first();
  return (row?.n as number) || 0;
}

export async function countVerifiedPeople(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM accounts WHERE quarantine_until <= datetime('now') AND status = 'active'"
  ).first();
  return (row?.n as number) || 0;
}

export interface LedgerEntry {
  actionName: string;
  claimedAt: string;
}

/**
 * Global, fully anonymized activity feed -- action name and timestamp only, never an account id,
 * email, or anything else that could identify who did it. Filtered by the same 48h quarantine
 * window as every other public number (spec S7.4), so this can't be used to watch a fresh batch
 * of fake accounts claim things in real time.
 */
export async function listRecentClaimsGlobal(
  env: Env,
  limit: number,
  offset: number
): Promise<LedgerEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.name as action_name, uas.claimed_at as claimed_at
     FROM user_action_state uas
     JOIN actions a ON a.id = uas.action_id
     JOIN accounts acc ON acc.id = uas.account_id
     WHERE uas.status = 'claimed' AND acc.quarantine_until <= datetime('now') AND acc.status = 'active'
     ORDER BY uas.claimed_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();
  return (results || []).map((r: any) => ({ actionName: r.action_name, claimedAt: r.claimed_at }));
}
