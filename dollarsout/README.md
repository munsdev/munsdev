# DollarsOut

Gamified companion to [1STAND.org](https://1stand.org)'s economic-pressure
action list. Full build spec: `SPEC.md`. Original mockup (visual reference
only, not shipped): `MOCKUP-REFERENCE.html`.

- `worker/` — Cloudflare Worker backend (D1 + KV + OTP auth + Webflow CMS
  sync + share-card rendering + anti-abuse). See `worker/README.md`.
- `web/` — static frontend, works fully unauthenticated. See `web/README.md`.

## Status

Both halves are built and internally consistent (schema, D1 content,
Worker routes, and frontend all typecheck / dry-run bundle cleanly). What's
still needed before this is actually live at `dollarsout.1stand.org`:

1. **Cloudflare deploy access** — `wrangler` isn't authenticated in this
   environment. Run `npm install && npm run deploy` from `worker/` with an
   authenticated `wrangler` (or a `CLOUDFLARE_API_TOKEN`) to push the Worker
   and create the `api.dollarsout.1stand.org` DNS record.
2. **Turnstile widget** — create one for this domain in the Cloudflare
   dashboard, then `wrangler secret put TURNSTILE_SITE_KEY` /
   `TURNSTILE_SECRET_KEY` and update `web/js/config.js`'s placeholder.
3. **Transactional email vendor** for OTP codes — confirm which
   EU-resident-friendly sender was used for 1STAND's Mobilizon setup (spec
   says to reuse it), then `wrangler secret put OTP_EMAIL_API_KEY` /
   `OTP_EMAIL_FROM` and check `auth.ts`'s `sendOtpEmail` matches that
   vendor's API shape.
4. **`WEBFLOW_API_TOKEN` secret** — a Webflow API token scoped to CMS read
   on 1STAND.org, for the daily category-copy sync.
5. **Static hosting for `web/`** — e.g. a Cloudflare Pages project or
   another Worker serving static assets, pointed at `dollarsout.1stand.org`
   itself (the `api.` subdomain in `wrangler.toml` is the backend only).
6. Content is a first-pass draft, not final: badge artwork is emoji
   placeholders, money-redirected presets are estimates, and the granular
   action list (41 items) was authored as a companion dataset since the
   live Webflow CMS only has 9 campaign-level items — see
   `worker/content/README.md` for the full explanation of that gap and
   `SPEC.md` §12 for the other open decisions.

## Repo layout note

This lives alongside an unrelated existing Worker (`../worker/`, the
`poolman-worker` for reflectingpool.us) in the same repo — `dollarsout/` is
a new, independent top-level directory, nothing shared between the two.
