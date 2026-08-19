# DollarsOut frontend

Static, vanilla-JS rebuild of the mockup (spec §11: keep it light, no heavy
SPA framework, load fast on old phones over bad connections). No build
step — open `index.html` through any static file server and it runs.

## Local dev

The Worker serves this directory directly (`worker/wrangler.toml`'s
`[assets]` binding), so the real way to run this locally is from `worker/`:

```
cd ../worker && npm install && npm run dev
```

That serves both the API and this static site from one local origin.
`js/config.js`'s `API_BASE` is `""` (same-origin) to match how it's
actually deployed — running `web/` on its own via a plain static server
will load the page but every API call will 404 against that server.

## Tracking requires sign-in

This is a deliberate product decision, not the original spec's default:
browsing (Home meter, Actions, category drill-down, action detail) works
for anyone, but tapping "I did this" or "Doesn't apply to me" while signed
out opens the sign-in sheet instead of tracking anything locally. There is
no local/offline tracking mode — `js/state.js` is just level-ladder math
now, not a client-side data store. If you tap a claim button while signed
out, `app.js`'s `pendingAction` stashes which action you meant and
auto-completes it the moment sign-in succeeds, so it doesn't feel like a
dead end.

**Placeholder**: `js/config.js`'s `TURNSTILE_SITE_KEY` is Cloudflare's
public always-passes test key — swap it for the real site key once a
Turnstile widget exists for this domain (see `worker/README.md`). Until
then, the auth *flow* works end-to-end in dev, but real signups will fail
Turnstile verification server-side.

## Accessibility (spec §5 — hard requirements)

Rebuilt from scratch against the mockup, not copied, specifically to fix
this: minimum 16px body text / 14px any text throughout, ≥44×44px tap
targets (including the badge grid tiles and action-title buttons, which the
spec calls out as a known gap in the mockup), every status shown with an
icon *and* text *and* not by color alone (✓ / – / blank + label), real
`<button>` elements wherever something is clickable (the mockup used a
clickable `<h3>` with no keyboard handler for action titles — fixed to a
real focusable button here), visible focus rings, and
`prefers-reduced-motion` respected (needle sweep, popup pop-in, and toast
slide are all covered by the media query in `styles.css`). Not yet manually
verified with a screen reader — do that before shipping.

## i18n

`js/i18n.js` is a minimal key-based loader — static markup uses
`data-i18n="key"` / `data-i18n-placeholder="key"` attributes, dynamic
strings call `t("key", {vars})`. Four locales ship: `en` (canonical), `de`,
`es`, `fr` — all real first-pass translations, not machine output, but none
have been reviewed by a native speaker yet; do that before treating any of
them as launch-ready copy. The top-bar language button cycles through all
four; missing keys in any locale fall back to English automatically.

## Known gaps

- Filters/search are client-side over the ~41-item catalog (spec §12 open
  decision #5 says this is likely sufficient given catalog size).
- Share cards call the Worker's `/share` endpoint and open the native share
  sheet where available (`navigator.share`), falling back to per-platform
  web-intent links or clipboard copy otherwise.
- No screen-reader or full keyboard-only pass has been done yet — the
  building blocks are there (semantic buttons, `aria-pressed`,
  `aria-current`, `role="status"` on the toast, `role="dialog"` on the badge
  popup) but this needs a real accessibility QA pass before launch.
