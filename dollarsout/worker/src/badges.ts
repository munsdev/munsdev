import type { Action, Badge, BadgeChain, EarnedBadge, Env, UserActionState } from "./types";
import { LEVEL_LADDER } from "./types";
import {
  awardBadge,
  badgeEarnedCounts,
  getAccountOrdinal,
  listBadgeChains,
  listBadges,
  listEarnedBadgeDates,
  listEarnedBadgeIds,
  listUserCounters,
} from "./db";

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

/** A badge is "rare" below this share of active accounts. Drives the Rare Bird meta badge. */
const RARE_THRESHOLD_PCT = 5;

/** Anything awarded in one pass, flattened for the "you just earned" toast. */
export interface AwardedThing {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  kind: EarnedBadge["kind"];
  chainId?: string;
  tier?: number;
}

/** Four tiers only, so a lookup beats a general Roman-numeral routine (and "IIII" is not four). */
const TIER_NUMERALS = ["", "I", "II", "III", "IV"];

function tierAward(chain: BadgeChain, tier: BadgeChain["tiers"][number]): AwardedThing {
  return {
    id: tier.id,
    name: tier.name,
    description: `${chain.name} ${TIER_NUMERALS[tier.tier] ?? tier.tier} — ${chain.description ?? ""}`.trim(),
    icon: chain.icon,
    kind: "chain_tier",
    chainId: chain.id,
    tier: tier.tier,
  };
}

function badgeAward(b: Badge): AwardedThing {
  return { id: b.id, name: b.name, description: b.description, icon: b.icon, kind: b.kind };
}

/**
 * Re-evaluates everything a logging could have unlocked: the action's own one-shot badge, any
 * chain tiers its counters just crossed, total-claim milestones, and the meta badges.
 *
 * Counters have already been incremented by the caller before this runs, so the values read
 * here are post-claim.
 */
export async function evaluateAfterClaim(
  env: Env,
  accountId: string,
  justClaimed: Action,
  allActions: Action[],
  states: UserActionState[]
): Promise<AwardedThing[]> {
  const [allBadges, chains, earned, counters] = await Promise.all([
    listBadges(env),
    listBadgeChains(env),
    listEarnedBadgeIds(env, accountId),
    listUserCounters(env, accountId),
  ]);

  const awarded: AwardedThing[] = [];
  const claimed = states.filter((s) => s.status === "claimed");
  const claimedIds = new Set(claimed.map((s) => s.actionId));

  // Total loggings, counting each repeat of a repeatable action.
  const totalClaimed = claimed.reduce((n, s) => n + Math.max(1, s.claimCount), 0);

  // --- chain tiers ---
  const chainsStarted = new Set<string>();
  let hasTier4 = false;
  for (const chain of chains) {
    const value = counters.get(chain.counter) ?? 0;
    for (const tier of chain.tiers) {
      if (value >= tier.threshold) {
        if (tier.tier === 1) chainsStarted.add(chain.id);
        if (tier.tier === 4) hasTier4 = true;
        if (!earned.has(tier.id) && (await awardBadge(env, accountId, tier.id))) {
          awarded.push(tierAward(chain, tier));
        }
      }
    }
  }

  // --- standalone badges ---
  const byCategory = new Map<string, number>();
  for (const s of claimed) {
    const a = allActions.find((x) => x.id === s.actionId);
    if (a) byCategory.set(a.categoryId, (byCategory.get(a.categoryId) || 0) + 1);
  }
  const allCategoryIds = new Set(allActions.map((a) => a.categoryId));

  const sweptACategory = [...allCategoryIds].some((cat) => {
    const inCat = allActions.filter((a) => a.categoryId === cat);
    return inCat.length > 0 && inCat.every((a) => claimedIds.has(a.id));
  });

  for (const badge of allBadges) {
    if (earned.has(badge.id)) continue;
    let qualifies = false;

    switch (badge.kind) {
      case "one_shot":
        qualifies = badge.actionId === justClaimed.id;
        break;
      case "milestone":
        qualifies = badge.scope === "total" && totalClaimed >= (badge.threshold ?? Infinity);
        break;
      case "meta":
        qualifies = await metaQualifies(env, accountId, badge, {
          byCategory,
          allCategoryIds,
          sweptACategory,
          chainsStarted: chainsStarted.size,
          hasTier4,
        });
        break;
      default:
        qualifies = false; // time_served is driven by the check-in flow, not by claiming
    }

    if (qualifies && (await awardBadge(env, accountId, badge.id))) awarded.push(badgeAward(badge));
  }

  // Rare Bird has to run last: it looks at what is already held, including anything
  // awarded a moment ago in this same pass.
  const rareBird = allBadges.find((b) => b.scope === "meta:rare_badge");
  if (rareBird && !earned.has(rareBird.id)) {
    if (await holdsRareBadge(env, accountId)) {
      if (await awardBadge(env, accountId, rareBird.id)) awarded.push(badgeAward(rareBird));
    }
  }

  return awarded;
}

async function metaQualifies(
  env: Env,
  accountId: string,
  badge: Badge,
  ctx: {
    byCategory: Map<string, number>;
    allCategoryIds: Set<string>;
    sweptACategory: boolean;
    chainsStarted: number;
    hasTier4: boolean;
  }
): Promise<boolean> {
  switch (badge.scope) {
    case "meta:all_categories":
      return [...ctx.allCategoryIds].every((c) => (ctx.byCategory.get(c) || 0) > 0);
    case "meta:category_sweep":
      return ctx.sweptACategory;
    case "meta:chains_started":
      return ctx.chainsStarted >= (badge.threshold ?? Infinity);
    case "meta:chain_tier4":
      return ctx.hasTier4;
    case "meta:founder": {
      // Retires itself: once the hundredth account exists, nobody new can qualify.
      const ordinal = await getAccountOrdinal(env, accountId);
      return ordinal > 0 && ordinal <= (badge.threshold ?? 100);
    }
    default:
      return false; // meta:rare_badge is handled separately, after the rest are awarded
  }
}

async function holdsRareBadge(env: Env, accountId: string): Promise<boolean> {
  const [{ counts, activeAccounts }, held] = await Promise.all([
    badgeEarnedCounts(env),
    listEarnedBadgeIds(env, accountId),
  ]);
  // With almost nobody signed up, everything looks rare. Require a real denominator.
  if (activeAccounts < 20) return false;
  for (const id of held) {
    const pct = ((counts.get(id) || 0) / activeAccounts) * 100;
    if (pct > 0 && pct < RARE_THRESHOLD_PCT) return true;
  }
  return false;
}

/** Evaluates the time-served badges after a check-in that reported "still holding". */
export async function evaluateTimeServedBadges(
  env: Env,
  accountId: string,
  monthsBanked: number
): Promise<AwardedThing[]> {
  const [allBadges, earned] = await Promise.all([
    listBadges(env),
    listEarnedBadgeIds(env, accountId),
  ]);
  const awarded: AwardedThing[] = [];

  for (const badge of allBadges) {
    if (badge.kind !== "time_served" || earned.has(badge.id)) continue;
    const required = badge.scope === "checkin:6mo" ? 6 : 3;
    if (monthsBanked >= required && (await awardBadge(env, accountId, badge.id))) {
      awarded.push(badgeAward(badge));
    }
  }
  return awarded;
}

/**
 * The full achievement grid: every standalone badge plus every chain, with what the account
 * holds and how rare each one is.
 *
 * A chain is one grid entry showing its highest unlocked tier, not four separate entries --
 * 12 chains read as 12 things to collect rather than 48.
 */
export async function buildBadgeGrid(env: Env, accountId: string) {
  const [allBadges, chains, earnedDates, { counts, activeAccounts }, counters] = await Promise.all([
    listBadges(env),
    listBadgeChains(env),
    listEarnedBadgeDates(env, accountId),
    badgeEarnedCounts(env),
    listUserCounters(env, accountId),
  ]);

  const rarity = (id: string) =>
    activeAccounts > 0 ? Math.round(((counts.get(id) || 0) / activeAccounts) * 1000) / 10 : 0;

  const badges: EarnedBadge[] = allBadges.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    icon: b.icon,
    kind: b.kind,
    earnedAt: earnedDates.get(b.id) ?? null,
    rarityPct: rarity(b.id),
  }));

  const chainEntries = chains.map((chain) => {
    const value = counters.get(chain.counter) ?? 0;
    const unlocked = chain.tiers.filter((t) => earnedDates.has(t.id));
    const highest = unlocked.length ? unlocked[unlocked.length - 1] : null;
    const next = chain.tiers.find((t) => value < t.threshold) ?? null;
    return {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      icon: chain.icon,
      counter: chain.counter,
      value,
      tiers: chain.tiers.map((t) => ({
        id: t.id,
        tier: t.tier,
        name: t.name,
        threshold: t.threshold,
        earnedAt: earnedDates.get(t.id) ?? null,
        rarityPct: rarity(t.id),
      })),
      currentTier: highest?.tier ?? 0,
      currentTierName: highest?.name ?? null,
      nextThreshold: next?.threshold ?? null,
      nextTierName: next?.name ?? null,
      earnedAt: highest ? earnedDates.get(highest.id) ?? null : null,
    };
  });

  return { badges, chains: chainEntries, activeAccounts };
}
