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
  colorKey: ColorKey;
  sortOrder: number;
  updatedAt: string;
}

export type ActionMode = "Withdraw" | "Substitute" | "Pressure" | "Build";
export type Effort = "Easy" | "Moderate" | "Advanced";
export type Availability = "Anywhere" | "Outside US" | "US only";

export interface HelpfulLink {
  label: string;
  url: string;
}

export interface Action {
  id: string;
  categoryId: string;
  webflowItemId: string | null;
  name: string;
  shortDescription: string;
  longDescriptionHtml: string | null;
  mode: ActionMode;
  effort: Effort;
  timeEstimate: string;
  availability: Availability;
  moneyPresets: number[]; // whole euros
  helpfulLinks: HelpfulLink[];
  isTimeServed: boolean;
  sortOrder: number;
  disabled: boolean;
}

export type BadgeKind = "one_shot" | "counter" | "time_served";

export interface Badge {
  id: string;
  name: string;
  icon: string;
  kind: BadgeKind;
  categoryId: string | null;
  actionId: string | null;
  threshold: number | null;
  scope: string | null;
  sortOrder: number;
}

export type ActionStateStatus = "claimed" | "na";
export type CheckinResult = "holding" | "went_back";

export interface UserActionState {
  id: string;
  accountId: string;
  actionId: string;
  status: ActionStateStatus;
  moneyRedirectedCents: number | null;
  whatBroke: string | null;
  claimedAt: string | null;
  startDate: string | null;
  lastCheckinAt: string | null;
  lastCheckinResult: CheckinResult | null;
  nextCheckinDue: string | null;
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
