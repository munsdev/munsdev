# DollarsOut Worker

Cloudflare Worker backend for DollarsOut — the gamified companion to
[1STAND.org](https://1stand.org)'s economic-pressure action list. See
`../SPEC.md` (copy of the original build spec) and `content/README.md` for
where the category/action/badge content actually comes from.

## How it fits together

- **D1** (`dollarsout-db`) holds accounts, claims (`user_action_state`),
  badges, the content tables (categories/actions/badges — seeded from
  `content/*.json`), and the aggregate period/community-goal config.
- **KV** — `SESSIONS` holds session-token → account-id lookups (OTP auth, no
  passwords anywhere). `COUNTERS` is the fast public-stats path (spec §11):
  reconciled from D1 on a cron rather than read from D1 on every homepage
  load, plus the catalog response cache, the disposable-domain blocklist
  cache, rate-limit counters, and share-card payloads.
- **Webflow** is the source of truth for the 7 category-level copy blocks
  (name/short-description/long-description), synced daily. It is **not**
  the source for the granular actions or badges — see `content/README.md`
  for why.
- **`../web`** (the static frontend) is served straight from this Worker
  via the `[assets]` binding in `wrangler.toml` — one deploy, one domain,
  no separate Pages project. API routes and static files share
  `dollarsout.1stand.org`; anything not matched by an API route or a real
  file falls through to `index.html`.

## One-time setup

Already done for this environment (D1 database, both KV namespaces —
IDs are in `wrangler.toml`, and the schema + content are already loaded).
Still needed before this can go live:

1. **Secrets** (`wrangler secret put <NAME>`):
   - `WEBFLOW_API_TOKEN` — Webflow API token, CMS read scope on 1STAND.org.
   - `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` — from a Turnstile widget
     created for `dollarsout.1stand.org` in the Cloudflare dashboard
     (Turnstile → Add site). Invisible mode per spec §7.1.
   - `OTP_EMAIL_API_KEY` / `OTP_EMAIL_FROM` — transactional email vendor for
     OTP codes. `auth.ts`'s `sendOtpEmail` is written against a
     Postmark-shaped API as a placeholder; spec §11 says to reuse whichever
     EU-resident-friendly sender was set up for 1STAND's Mobilizon instance
     rather than introducing a new vendor — confirm which one that is and
     adjust `sendOtpEmail` if the API shape differs. Until this secret is
     set, OTP codes just log to the Worker console (`wrangler tail`) instead
     of sending — fine for testing, not for real signups.

2. **DNS / route**: `wrangler.toml` already targets `dollarsout.1stand.org`
   with `custom_domain = true`, which auto-creates the DNS record on
   deploy — same mechanism as `api.reflectingpool.us`, just pointed at the
   bare subdomain since this Worker now serves the frontend too. Requires
   `1stand.org`'s zone to be reachable from whatever Cloudflare account
   runs `wrangler deploy` (it already is, per the existing `reverse-proxy`
   Worker on that zone).

3. **Deploy**:
   ```
   npm install
   npm run deploy
   ```

## Content updates

`content/*.json` is hand-authored (see `content/README.md` for why) and
only loaded into D1 once, by hand, via `d1_database_query` during this
build. There's no re-seed script yet — if you edit the JSON files, the
change needs to be pushed into D1 manually (or write a small
`scripts/seed.ts` that diffs and upserts, if this becomes a frequent
edit). Category copy (name/short/long description only) re-syncs
automatically from Webflow daily at 03:00 UTC.

## Anti-abuse (spec §7)

- Turnstile on both OTP endpoints.
- Disposable-email domains blocked at signup, list fetched from
  `DISPOSABLE_DOMAIN_BLOCKLIST_URL` and cached in KV for a day.
- Per-IP (8/day) and per-ASN (40/day) account-creation rate limits —
  loose on purpose so a shared-NAT office or university doesn't get
  blocked; tune `IP_DAILY_LIMIT` / `ASN_DAILY_LIMIT` in `auth.ts` against
  real traffic once there is any.
- 48-hour quarantine: `accounts.quarantine_until` is set at signup; every
  public-aggregate query (`countVerified*` in `db.ts`) filters on it, so a
  fresh account's claims are fully usable to that account immediately but
  invisible in the public dial/goals until quarantine clears.
- Burst-claiming (10+ claims in under a minute) is logged to
  `anomaly_log` for manual review, never auto-banned — see `claims.ts`.

## Known gaps / next steps

- **Money-redirected presets** on each action are a first-pass guess (see
  `content/actions.json`) — spec §12 open decision #3 flags these need
  real, sourced figures.
- **Badge artwork** is emoji placeholders (spec §12 open decision #2).
- **German localization**: the Worker returns raw content strings only —
  translation is entirely a frontend (`web/i18n/`) concern for now, per
  spec §12 open decision #6 (English-first).
- **Share images** are hand-built SVG rasterized via `@resvg/resvg-wasm` —
  no satori/React templating, since the card layout is simple enough to
  generate directly. If the design needs to get fancier, swap
  `buildCardSvg` for a proper templating approach without changing the
  rasterization path.
- No admin UI yet for community-goal values or the monthly dial goal
  (spec §12 open decision #4) — both are plain rows in `aggregate_periods`
  / `community_goals`, edited directly via `d1_database_query` for now.
