# DollarsOut

Gamified companion to [1STAND.org](https://1stand.org)'s economic-pressure
action list. Full build spec: `SPEC.md`. Original mockup (visual reference
only, not shipped): `MOCKUP-REFERENCE.html`.

- `worker/` — Cloudflare Worker backend (D1 + KV + OTP auth + Webflow CMS
  sync + share-card rendering + anti-abuse), which **also serves `web/`
  directly** via a `[assets]` binding — one deploy, one domain, no separate
  static host to stand up. See `worker/README.md`.
- `web/` — static frontend, works fully unauthenticated. See `web/README.md`.

## Status

Both halves are built and internally consistent (schema, D1 content, and
Worker+frontend bundle together and dry-run cleanly under `wrangler deploy
--dry-run`, confirmed against the real config). What's still needed before
this is actually live at `dollarsout.1stand.org`:

1. **Cloudflare deploy access** — `wrangler` isn't authenticated in this
   environment. One `npm install && npm run deploy` from `worker/`, once
   authenticated, pushes both the Worker and the static site and creates
   the `dollarsout.1stand.org` DNS record in one shot.
2. **Turnstile widget** — create one for this domain in the Cloudflare
   dashboard, then `wrangler secret put TURNSTILE_SITE_KEY` /
   `TURNSTILE_SECRET_KEY` and update `web/js/config.js`'s placeholder.
   Not required to deploy or browse/claim as a guest — only signing in
   needs it, so this can follow after the first deploy.
3. **Transactional email vendor** for OTP codes — confirm which
   EU-resident-friendly sender was used for 1STAND's Mobilizon setup (spec
   says to reuse it), then `wrangler secret put OTP_EMAIL_API_KEY` /
   `OTP_EMAIL_FROM` and check `auth.ts`'s `sendOtpEmail` matches that
   vendor's API shape. Same as Turnstile: not required to deploy or test
   guest mode.
4. **`WEBFLOW_API_TOKEN` secret** — a Webflow API token scoped to CMS read
   on 1STAND.org, for the daily category-copy sync. Not required to deploy
   either — content already lives in D1 from the initial seed.
5. Content is a first-pass draft, not final: badge artwork is emoji
   placeholders, money-redirected presets are estimates, and the granular
   action list (41 items) was authored as a companion dataset since the
   live Webflow CMS only has 9 campaign-level items — see
   `worker/content/README.md` for the full explanation of that gap and
   `SPEC.md` §12 for the other open decisions.

**In short: step 1 (a Cloudflare API token) is the only thing blocking a
testable, guest-mode-functional deploy right now.** Steps 2-4 only affect
sign-in and content freshness, not whether the app loads and works.

## Repo layout note

This lives alongside an unrelated existing Worker (`../worker/`, the
`poolman-worker` for reflectingpool.us) in the same repo — `dollarsout/` is
a new, independent top-level directory, nothing shared between the two.
