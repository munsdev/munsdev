# DollarsOut

Gamified companion to [1STAND.org](https://1stand.org)'s economic-pressure
action list. Full build spec: `SPEC.md`. Original mockup (visual reference
only, not shipped): `MOCKUP-REFERENCE.html`.

- `worker/` — Cloudflare Worker backend (D1 + KV + OTP auth + share-card
  rendering + anti-abuse), which **also serves `web/` directly** via a
  `[assets]` binding — one deploy, one domain, no separate static host to
  stand up. See `worker/README.md`.
- `web/` — static frontend, works fully unauthenticated. See `web/README.md`.

## Status

**Live at [dollarsout.1stand.org](https://dollarsout.1stand.org).** Guest
mode (browse, claim actions, earn badges, see your ledger) works end to end
right now — no account needed.

Content is fully self-contained: no live connection to Webflow or any other
CMS. The 7 categories were drawn from the 1STAND Webflow Actions CMS as a
one-time import when this was built (see `worker/content/README.md` for the
lineage), but there's no ongoing sync, no scheduled job, and no API token
involved — editing content here never touches Webflow and vice versa.

What's still needed, in order of what it unlocks:

1. **Turnstile widget** — create one for this domain in the Cloudflare
   dashboard, then `wrangler secret put TURNSTILE_SITE_KEY` /
   `TURNSTILE_SECRET_KEY` and update `web/js/config.js`'s placeholder.
   Needed for sign-in to actually work; guest mode doesn't need it.
2. **Transactional email vendor** for OTP codes — confirm which
   EU-resident-friendly sender was used for 1STAND's Mobilizon setup (spec
   says to reuse it), then `wrangler secret put OTP_EMAIL_API_KEY` /
   `OTP_EMAIL_FROM` and check `auth.ts`'s `sendOtpEmail` matches that
   vendor's API shape. Also only needed for sign-in.
3. Content is a first-pass draft, not final: badge artwork is emoji
   placeholders, money-redirected presets are estimates, and the granular
   action list (41 items) was authored as a companion dataset since the
   live Webflow CMS only ever had 9 campaign-level items — see
   `worker/content/README.md` for the full explanation and `SPEC.md` §12
   for the other open decisions.

## Repo layout note

This lives alongside an unrelated existing Worker (`../worker/`, the
`poolman-worker` for reflectingpool.us) in the same repo — `dollarsout/` is
a new, independent top-level directory, nothing shared between the two.
