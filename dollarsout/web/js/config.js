// Frontend-only config. Turnstile's SITE key is meant to be public (unlike the SECRET key, which
// only ever lives as a Worker secret) -- this placeholder needs swapping for the real one once a
// Turnstile widget exists for dollarsout.1stand.org (Cloudflare dashboard -> Turnstile -> Add
// site). Until then, auth will reach the Worker but fail verification server-side -- see
// worker/README.md.
export const TURNSTILE_SITE_KEY = "1x00000000000000000000AA"; // Cloudflare's always-passes test key

export const API_BASE = "https://api.dollarsout.1stand.org";
