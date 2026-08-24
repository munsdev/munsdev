# DollarsOut — Hetzner migration (planning doc)

**Status: nothing has moved. No code has been written, no server has been touched.
This is a discussion, captured as documentation, so a future thread or a human
can pick it up without re-deriving it.** Written to be self-contained — you
should be able to drop this into a fresh conversation and continue planning
without anyone re-reading the repo first.

Live today at **dollarsout.1stand.org**, entirely on Cloudflare. Repo path
`dollarsout/`, branch `claude/dollarsout-deployment-1lbgyh`.

---

## 1. What this is about

DollarsOut tracks per-account, per-action claim history for a boycott/economic-
pressure campaign — things like "I cancelled Amazon Prime," tied to a signed-in
email. That's a more sensitive dataset than it might first look: it's not just
PII (email, signup IP/ASN), it's PII linked to a person's participation in a
politically-charged campaign.

The owner wants to move the sensitive parts of that data onto a personally-
controlled server in Germany (Hetzner), "to keep it further from American
reach in these odd times." That phrase matters for the design: the goal is
**jurisdiction**, not just **geography**.

---

## 2. The core distinction driving every decision here

There are two different problems that look similar and have different fixes:

| Problem | Fix | Does it satisfy "further from American reach"? |
|---|---|---|
| Data is physically stored outside the EU | Cloudflare D1 has an EU-jurisdiction option; Workers has a regional-restriction mode | Only for GDPR-style "data residency" purposes |
| Data is held by a company subject to US legal process (CLOUD Act etc.), regardless of where the servers physically sit | Actually move the data off that company's infrastructure, onto infrastructure owned by a non-US company | **Yes** — this is the one that matters here |

Cloudflare Inc. is a US company. Flipping on their EU jurisdiction setting for
D1 keeps bytes in EU datacenters but does not change who can be legally
compelled to hand them over. That's why "just enable EU jurisdiction" was
considered and set aside as not actually addressing the stated concern — it's
real, it's cheap, but it's solving a different problem than the one raised.

Conclusion reached: **a genuine move to self-hosted infrastructure on Hetzner**
is the option that matches the actual goal. It's also a meaningful practical
win beyond the "vibes" of German hosting — it simplifies GDPR compliance,
since nothing crosses borders and there's no international-transfer mechanism
(SCCs etc.) to maintain.

---

## 3. Current architecture (Cloudflare, live today)

- **Compute**: Cloudflare Workers (`worker/src/*.ts`, ~1700 lines total),
  serving both the API and the static frontend (`web/` via the Workers
  `[assets]` binding) from one deploy, one domain.
- **Database**: Cloudflare D1 (`dollarsout-db`) — SQLite under the hood,
  accessed through D1's async `.prepare(sql).bind(...).all()/.first()/.run()`
  client.
- **KV**: two namespaces — `SESSIONS` (auth sessions) and `COUNTERS` (rate
  limiting / anomaly counters).
- **CAPTCHA**: Cloudflare Turnstile (site key + secret).
- **OTP email**: sent through a transactional email vendor, not yet confirmed
  (see `worker/wrangler.toml` — `OTP_EMAIL_API_KEY` / `OTP_EMAIL_FROM` are
  secrets, vendor TBD).
- **Domain**: `dollarsout.1stand.org`, a Cloudflare-managed zone. Wrangler's
  `custom_domain = true` auto-creates the DNS record + cert.

## 4. What's actually sensitive (this is what would move)

From `worker/migrations/0001_init.sql`:

| Table | Contains | Move? |
|---|---|---|
| `accounts` | email, signup IP, signup ASN | **Yes** |
| `otp_requests` | email, OTP code hash, request IP | **Yes** |
| `user_action_state` | per-account claim history — *the sensitive core* | **Yes** |
| `user_badges` | per-account badge history | **Yes** |
| `anomaly_log` | per-account abuse signals | **Yes** |
| `categories`, `actions`, `badges` | public content | No — stays wherever's convenient |
| `aggregate_periods`, `community_goals` | public config | No |

The public ledger already only ever exposes action name + timestamp, never
the account — so the anonymized/public surface of the app doesn't need to
move at all. This is really about the account-linked tables.

---

## 5. Target architecture on Hetzner

**Porting strategy: port the edges, keep the middle.** D1's client API
(`.prepare().bind().all()/.first()/.run()`) is a thin async wrapper that maps
almost 1:1 onto `better-sqlite3` (or Node's built-in `node:sqlite`) behind one
adapter shim matching the same method signatures. That means the actual
business logic — `auth.ts`, `claims.ts`, `badges.ts`, `aggregate.ts`,
`ledger.ts` (~830 of the ~1700 lines) — barely changes. What genuinely needs
rewriting is `db.ts` (the D1 client itself), `index.ts` (routing + static
serving + KV-backed sessions/counters), and the whole ops/deploy layer. This
is "port the edges, keep the middle," not a ground-up rewrite.

Proposed shape:

- **Node (or Bun) process** running the ported routes.
- **Caddy** in front — free automatic Let's Encrypt TLS, and Caddy serves
  `web/` directly as static files so Node only handles `/auth`, `/claims`,
  `/stats`, etc. — mirrors the current split between the Workers Assets
  binding and the Worker itself.
- **SQLite file on disk** replaces D1 — the easy part, since D1 already *is*
  SQLite. The thing newly owned that Cloudflare owned before: **backups**.
  One file, no replication, means a cron pushing `sqlite3 .backup` snapshots
  somewhere off-box (Hetzner Storage Box, restic to a second location,
  whatever) is required, not optional — skipping it is the standard way
  self-hosted-SQLite projects lose everything.
- **KV → same SQLite DB or in-memory.** No need for a distributed store with
  one process on one box; sessions/counters become a table or a `Map`.
- **systemd unit** for the Node process — auto-restart on crash/reboot. This
  is the availability story now, replacing Cloudflare's edge.

### Two Cloudflare touchpoints easy to miss

Even a "full" move leaves these unless deliberately swapped:

- **Turnstile** is a Cloudflare service. Keeping it means Cloudflare still
  sees signup traffic even with data stored elsewhere. If the point is "not
  Cloudflare," swap to something EU-based — **Friendly Captcha** (German,
  privacy-by-design) or hCaptcha are candidates.
- **OTP email vendor** — whatever gets picked needs to actually be non-US
  too. SES/SendGrid/Postmark are all US companies regardless of which region
  their servers run in. **Mailjet** or **Brevo** (both French/EU) are
  candidates if jurisdiction is the point, not just server location.

### DNS

Cloudflare can stay purely as DNS with the proxy off ("grey-clouded") — no
data or traffic touches Cloudflare's network, it just resolves the name — or
DNS can move elsewhere entirely. Doesn't affect the rewrite either way; it's
a free knob to decide later.

---

## 6. The open question this doc exists to capture: which server?

The owner has an **existing Hetzner server already running other things**,
on a **legacy pricing plan** no longer offered to new customers. Two options:

1. **Reuse the existing legacy box.** Free (no new monthly cost), but adding
   this workload might force a plan/spec upgrade — which could mean losing
   the legacy pricing on the *whole* server, not just paying more for the
   extra capacity. Needs checking against Hetzner's current plans before
   assuming this is viable. Also couples this project's operational risk
   (an outage, a security incident, a resource spike) to whatever else
   already runs there.
2. **Spin up a new, separate small server just for this.** New monthly cost,
   but preserves the legacy pricing untouched, and isolates blast radius —
   if DollarsOut has a bad day, it doesn't take the existing legacy setup
   down with it, and vice versa. Given the resource footprint here (Node +
   SQLite + Caddy idle comfortably well under 2GB RAM for this app's likely
   traffic), a small/cheap new instance is plausible.

**Not yet decided.** Leaning toward option 2 (new server) to avoid touching
the legacy pricing, but this needs the owner to actually check current
Hetzner pricing/specs against what the legacy plan offers before committing.

---

## 7. Honest limits (so expectations stay calibrated)

- A single small Hetzner box — legacy or new — is a **real single point of
  failure**: no redundancy, no auto-scaling. Resource-wise this app fits
  comfortably; "fits comfortably" and "someone is watching if it falls over"
  are different things, and that someone is now the owner, not Cloudflare.
- Germany/Hetzner is a **genuine, meaningful improvement** — data physically
  in the EU, held by a German company subject to German/EU law, simpler
  GDPR story — but it is **not an absolute shield**. It's "materially harder
  to reach," not "unreachable." Don't oversell it as the latter.
- This is the kind of change worth building and testing end-to-end (new
  server, migration, cutover) before touching the live domain — not one to
  iterate on live against real user data.

---

## 8. Useful facts for a new thread

- Nothing has moved. This is planning only, captured 2026-08-24.
- The goal is jurisdiction (who can be legally compelled), not just physical
  data location — that distinction should drive every option evaluated here.
- Sensitive tables: `accounts`, `otp_requests`, `user_action_state`,
  `user_badges`, `anomaly_log`. Content and aggregate tables are public and
  don't need to move.
- Porting strategy: write one adapter shim so D1's `.prepare/.bind/.all/
  .first/.run` interface is matched by `better-sqlite3` (or `node:sqlite`),
  which keeps `auth.ts`/`claims.ts`/`badges.ts`/`aggregate.ts`/`ledger.ts`
  nearly untouched. Only `db.ts`, `index.ts`, and the ops layer need real
  rewriting.
- Two other Cloudflare-owned pieces need non-US replacements if the goal is
  taken seriously end to end: Turnstile (→ Friendly Captcha / hCaptcha) and
  the OTP email vendor (→ Mailjet / Brevo, not SES/SendGrid/Postmark).
- Open decision blocking a start: reuse the existing legacy Hetzner box
  (risk: losing legacy pricing on an upgrade, coupling this project's risk
  to existing services) vs. a new dedicated small server (new monthly cost,
  isolated blast radius). Needs current Hetzner pricing checked before
  deciding.
- See `CONTENT.md` in this same repo for the app's content model
  (categories/actions/badges) — unrelated to this doc, but the other
  standing reference doc for this project.
