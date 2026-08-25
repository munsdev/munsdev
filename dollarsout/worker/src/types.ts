export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  COUNTERS: KVNamespace;
  ASSETS: Fetcher;

  ALLOWED_ORIGIN: string;
  SESSION_COOKIE_DOMAIN: string;

  // Secrets -- set with `wrangler secret put <NAME>`, never in wrangler.toml.
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string; // public, but kept as a secret so it's one less thing to sync by hand
  OTP_EMAIL_API_KEY: string;
  OTP_EMAIL_FROM: string;
  DISPOSABLE_DOMAIN_BLOCKLIST_URL: string; // remote list, fetched + cached in KV
}

export type ColorKey = "c1" | "c2" | "c3";

export interface Category {
  id: string;
  webflowItemId: string | null;
  name: string;
  tagline: string | null;
  shortDescription: string | null;
  longDescriptionHtml: string | null;
  /** Standing caveat shown above the category's actions -- e.g. "not financial advice". */
  disclaimer: string | null;
  colorKey: ColorKey;
  sortOrder: number;
  updatedAt: string;
}

export type Effort = "Easy" | "Moderate" | "Advanced";

/**
 * How an action is logged.
 *
 * - `once`      -- done and stays done. One row in user_action_state.
 * - `sustained` -- a standing change that can lapse, so it's checked in on.
 * - `repeatable` -- an act you can do again. Each logging is its own row in
 *                   user_claims_log, throttled by cooldownDays.
 */
export type Recurrence = "once" | "sustained" | "repeatable";

/** Where the action applies. Replaces the old free-text `availability`. */
export type ScopeRegion = "global" | "eu" | "us";

/** Fixed bands. Points are personal progression only -- never shown on the public meter. */
export const POINTS_BANDS = [5, 10, 25, 50, 75, 100] as const;

export interface HelpfulLink {
  label: string;
  url: string;
}

/** Locale code -> suggested target names, with `default` as the fallback. */
export type Targets = Record<string, string[]>;

export interface Action {
  id: string;
  categoryId: string;
  name: string;
  shortDescription: string;
  longDescriptionHtml: string | null;

  points: number;
  recurrence: Recurrence;
  cooldownDays: number | null;
  checkinDays: number | null;
  scopeRegion: ScopeRegion;

  targets: Targets;
  /** Badge-chain counter keys this action increments when logged. */
  counters: string[];
  helpfulLinks: HelpfulLink[];

  effort: Effort;
  timeEstimate: string;
  isStarter: boolean;
  sortOrder: number;
  disabled: boolean;
}

/**
 * Standalone badges. The category/mode counter badges are gone -- they were keyed on
 * "N actions within this category", so editing the content silently moved the goalposts
 * for anyone mid-progress. Their replacement is BadgeChain, keyed on counters that an
 * action increments explicitly.
 */
export type BadgeKind = "one_shot" | "milestone" | "time_served" | "meta";

export interface Badge {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  kind: BadgeKind;
  actionId: string | null;
  threshold: number | null;
  scope: string | null;
  sortOrder: number;
}

export interface BadgeTier {
  id: string;
  chainId: string;
  tier: number; // 1-4
  name: string;
  threshold: number;
}

export interface BadgeChain {
  id: string;
  name: string;
  description: string | null;
  counter: string;
  icon: string;
  sortOrder: number;
  tiers: BadgeTier[];
}

/** One earned thing, whether it came from `badges` or from a chain tier. */
export interface EarnedBadge {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  kind: BadgeKind | "chain_tier";
  chainId?: string;
  tier?: number;
  earnedAt: string | null;
  /** Share of active accounts holding this, 0-100. Computed at read time, never stored. */
  rarityPct?: number;
}

export type ActionStateStatus = "claimed" | "na";
export type CheckinResult = "holding" | "went_back";

export interface UserActionState {
  id: string;
  accountId: string;
  actionId: string;
  status: ActionStateStatus;
  claimedAt: string | null;
  startDate: string | null;
  lastCheckinAt: string | null;
  lastCheckinResult: CheckinResult | null;
  nextCheckinDue: string | null;
  /** Months already banked on a sustained action. Lapsing does not zero this. */
  monthsBanked: number;
  /** How many times a repeatable action has been logged. */
  claimCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  email: string;
  createdAt: string;
  quarantineUntil: string;
  status: "active" | "flagged" | "banned";
}

export const LEVEL_LADDER = [
  { level: 0, name: "Bystander", min: 0 },
  { level: 1, name: "Rookie", min: 1 },
  { level: 2, name: "Starter", min: 3 },
  { level: 3, name: "Mover", min: 6 },
  { level: 4, name: "Switcher", min: 10 },
  { level: 5, name: "Divester", min: 15 },
  { level: 6, name: "Legend", min: 25 },
  { level: 7, name: "Untouchable", min: 40 },
] as const;
