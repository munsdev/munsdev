// Frontend-only config. Turnstile's SITE key is meant to be public (unlike the SECRET key, which
// only ever lives as a Worker secret, set via `wrangler secret put TURNSTILE_SECRET_KEY`).
// This is the managed-mode widget scoped to dollarsout.1stand.org -- Turnstile enforces that
// hostname, so this key is useless anywhere else.
export const TURNSTILE_SITE_KEY = "0x4AAAAAAEXDfy5zc6uoQIkQ";

// Same origin as the frontend -- the Worker serves both the static site and the API from one
// deploy, one domain (see worker/wrangler.toml's [assets] block).
export const API_BASE = "";
