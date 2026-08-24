# DollarsOut — content reference

Working doc for refining the **items** in the app: categories, actions, and
badges. Written to be self-contained — you should be able to drop this into a
fresh conversation and work on the content without anyone re-reading the repo.

Live at **dollarsout.1stand.org**. Repo path `dollarsout/`, branch
`claude/dollarsout-deployment-1lbgyh`.

---

## 1. What the app does (just enough context)

Companion to 1STAND's economic-pressure action list. You browse **actions**
(concrete things like "Cancel Amazon Prime"), tap one to open its detail, and
hit **I did this** to log it. Logging is per-account and requires sign-in
(email + one-time code, no passwords). A claim can be **removed at any time**,
not just right after logging.

Three tabs:

- **Home** — the *Impact-O-Meter*, a dial showing everyone's combined claims
  over a **rolling 90 days** against a goal of **1,000**. Plus a live global
  activity ledger (action name + timestamp, never who did it).
- **Actions** — intro line, search, and entry tiles: *All actions* (opens the
  category list), *Surprise me*, and quick filters.
- **Achievements** — badge grid; tapping a badge opens a detail sheet with
  progress or a check-in countdown.

Content is **fully self-contained** — no live CMS sync. Categories were a
one-time import from the 1STAND Webflow Actions CMS; actions and badges were
authored here because the CMS only ever had campaign-level items, not
individually-claimable ones.

---

## 2. Where content lives, and how to change it

```
dollarsout/worker/content/
  categories.json      7 items
  actions.json        41 items
  badges.json         61 items
  seed_categories.sql  generated from the JSON
  seed_actions.sql
  seed_badges.sql
  README.md            provenance notes
```

**The JSON files are the source of truth for authoring. D1 is what the app
actually serves.** They're currently in sync (verified: 7 / 41 / 61 in both).

### Four gotchas when editing content

1. **The seed files are plain `INSERT`, not upserts.** Re-running them against
   a populated D1 fails on primary-key conflict. To change existing content you
   need `UPDATE` statements, or `DELETE` + re-`INSERT`, not a re-seed.

2. **The catalog is KV-cached for 5 minutes** (`catalog:v1`,
   `CATALOG_CACHE_TTL = 300` in `worker/src/content.ts`). A content edit in D1
   won't show up in the app for up to 5 min. Don't conclude an edit failed —
   wait it out or delete the KV key.

3. **Deleting an action orphans data.** `user_action_state` and `user_badges`
   reference action/badge ids. Prefer the `disabled` column on `actions`
   (already in the schema, currently 0 for all 41) over deletion — it hides an
   action from the catalog without breaking anyone's history or badges.

4. **Content is English-only.** The UI chrome is translated into en/de/es/fr
   via `web/i18n/*.json`, but action and badge names/descriptions come straight
   from D1 with no locale columns. A Spanish user sees Spanish buttons and
   English action names. Worth deciding on before the item list grows.

---

## 3. Action schema

```jsonc
{
  "id": "everyday-cancel-amazon-prime",  // slug, stable, referenced by badges
  "categoryId": "everyday-spending",
  "webflowItemId": "6a8578266d00107b3bf3f481",  // provenance only, unused at runtime
  "name": "Cancel Amazon Prime",
  "shortDescription": "One account, six companies you're also funding.",
  "longDescription": "…",                // shown on the detail screen
  "mode": "Withdraw",                    // Withdraw | Substitute | Pressure | Build
  "effort": "Easy",                      // Easy | Moderate | Advanced
  "timeEstimate": "5 Minutes",           // see below
  "availability": "Anywhere",            // Anywhere | US only  (see mismatch note)
  "moneyPresets": [0, 70, 140],          // INERT — money tracking was cut from the product
  "helpfulLinks": [{ "label": "…", "url": "…" }],
  "isTimeServed": true,                  // enrolls in the 3-/6-month check-in cycle
  "sortOrder": 1                         // within its category
}
```

**`timeEstimate`** values in use: `5 Minutes`, `10-30 Minutes`, `1-2 Hours`,
`1 Day`, `Ongoing`, `Varies`. The Actions filter only offers four buckets —
`5 Minutes` → *5 min*, `10-30 Minutes` → *10–30 min*, `Ongoing` → *Ongoing*,
and **everything else falls into *1hr+***, so `1 Day` and `Varies` are both
filed there.

**`isTimeServed`** (13 of 41) means the action is something you *keep* doing
rather than finish once — a cancelled subscription, a switched bank. Claiming
it schedules a check-in at 3 months, then 6. It's what drives the *Still Going*
/ *The Long Haul* badges. Cancellations and switches are time-served;
research/one-off actions aren't.

**`helpfulLinks`** — only 14 of 41 actions have any (13 have one, 1 has two).
27 have none. Links open in a new tab.

### Known mismatch worth fixing

The location filter offers **"Outside US"**, but **no action uses it** — only
`Anywhere` and `US only` appear in the content. Selecting that filter always
returns nothing. Either add non-US actions or drop the filter option.

---

## 4. Current inventory — 41 actions across 7 categories

Format: `mode / effort / time / availability` · `[TS]` = time-served

### Everyday Spending (`everyday-spending`) — 6
*"Groceries, brands, leaving Amazon"*

1. Cancel Amazon Prime — Withdraw/Easy/5min/Anywhere `[TS]`
2. Swap the household aisle — Substitute/Easy/10-30min/Anywhere
3. Learn who owns your brands — Withdraw/Easy/10-30min/Anywhere
4. Research a company before you spend — Build/Easy/Ongoing/Anywhere
5. Switch your regular grocery retailer — Substitute/Moderate/10-30min/Anywhere `[TS]`
6. Redirect one purchase to a local business — Substitute/Easy/10-30min/Anywhere

### Subscriptions (`subscriptions`) — 6
*"What's quietly billing you monthly"*

1. Audit every recurring subscription — Build/Moderate/10-30min/Anywhere
2. Cancel Netflix — Withdraw/Easy/5min/Anywhere `[TS]`
3. Cancel Disney+ — Withdraw/Easy/5min/Anywhere `[TS]`
4. Cancel another streaming service — Withdraw/Easy/5min/Anywhere `[TS]`
5. Move your cloud storage — Substitute/Moderate/1-2hr/Anywhere `[TS]`
6. Switch your music subscription — Substitute/Moderate/10-30min/Anywhere `[TS]`

### Money & Banking (`money-banking`) — 6
*"Where your money sleeps at night"*

1. Open an account at a credit union — Substitute/Moderate/10-30min/Anywhere
2. Move your primary checking account — Withdraw/Moderate/1-2hr/Anywhere `[TS]`
3. Switch to a credit-union-issued card — Substitute/Moderate/10-30min/Anywhere `[TS]`
4. Ask your bank one direct question — Pressure/Easy/10-30min/Anywhere
5. Review and cut your bank fees — Withdraw/Easy/10-30min/Anywhere
6. Check who finances ICE detention — Withdraw/Moderate/10-30min/**US only**

### Investments (`investments`) — 5
*"You may own what you're boycotting"*

1. Ask what your pension holds — Build/Moderate/10-30min/Anywhere
2. Request your plan's fund lineup in writing — Build/Easy/10-30min/Anywhere
3. Move a discretionary investment account — Withdraw/Advanced/1-2hr/Anywhere `[TS]`
4. Learn what your index funds actually hold — Build/Easy/10-30min/Anywhere
5. Ask your employer about the plan provider — Pressure/Easy/10-30min/Anywhere

### Travel (`travel`) — 5
*"The one with a public scoreboard"*

1. Redirect one booking — Withdraw/Moderate/1-2hr/Anywhere
2. Switch your rental car provider — Substitute/Easy/10-30min/Anywhere
3. Choose rail or transit over a flagged airline — Substitute/Moderate/1-2hr/Anywhere
4. Delay a discretionary vehicle purchase — Withdraw/Advanced/**Varies**/Anywhere
5. Log a trip you already redirected — Build/Easy/5min/Anywhere

### Institutions (`institutions`) — 7
*"Highest impact, most effort"*

1. Ask what your workplace buys — Pressure/Moderate/1-2hr/Anywhere
2. Propose one procurement change — Pressure/Advanced/**1 Day**/Anywhere
3. Ask your local government one procurement question — Pressure/Moderate/1-2hr/Anywhere
4. Attend one institutional or shareholder meeting — Pressure/Advanced/**1 Day**/Anywhere
5. Submit a public comment on a purchasing decision — Pressure/Moderate/1-2hr/Anywhere
6. Register to vote, or confirm you're still registered — Build/Easy/5min/**US only**
7. Share brand-ownership research with a coworker — Build/Easy/5min/Anywhere

### Attention (`attention`) — 6
*"You're the inventory. Stop supplying it."*

1. Delete or deactivate one attention platform — Withdraw/Easy/5min/Anywhere `[TS]`
2. Switch to a chronological feed — Withdraw/Easy/5min/Anywhere
3. Move your news reading to a source you pay directly — Substitute/Moderate/10-30min/Anywhere `[TS]`
4. Set a hard daily limit on one platform — Withdraw/Easy/5min/Anywhere
5. Unfollow one advertiser-funded feed — Withdraw/Easy/5min/Anywhere
6. Delete one attention app for a week — Withdraw/Moderate/**1 Day**/Anywhere `[TS]`

### Distribution snapshot

| Mode | Count | | Effort | Count |
|---|---|---|---|---|
| Withdraw | 16 | | Easy | 21 |
| Substitute | 10 | | Moderate | 16 |
| Build | 8 | | Advanced | 4 |
| Pressure | 7 | | | |

Categories are 5–7 actions each. Everything is `Anywhere` except two `US only`
actions (ICE financing, voter registration).

---

## 5. Badges — 61 total

Three kinds, evaluated server-side in `worker/src/badges.ts`.

### `one_shot` — 41 (one per action)

Fires the moment you log its specific action. `actionId` points at the action;
`id` is `badge-<actionId>`. **Adding an action means adding its badge**, or that
action is the only one with no badge.

Examples: Prime Cut 📦, Ghosted 👻 (Netflix), Off The Ride 🎢 (Disney+),
Cloud Mover ☁️, New Playlist 🎵.

### `counter` — 18

Fires at a threshold. `scope` selects what's counted:

| Badge | Scope | Threshold | Available |
|---|---|---:|---:|
| Getting Started | `total` | 3 | 41 |
| Building Momentum | `total` | 8 | 41 |
| Follow the Money | `total` | 15 | 41 |
| All In | `total` | 25 | 41 |
| Untouchable | `total` | 40 | 41 |
| Aisle Cleared | `category:everyday-spending` | 6 | **6** |
| Fully Unsubscribed | `category:subscriptions` | 6 | **6** |
| All In (On the Credit Union) | `category:money-banking` | 6 | **6** |
| Divested | `category:investments` | 5 | **5** |
| Grounded | `category:travel` | 5 | **5** |
| Institution Builder | `category:institutions` | 7 | **7** |
| Attention Reclaimed | `category:attention` | 6 | **6** |
| Withdrawn | `mode:Withdraw` | 5 | 16 |
| Substituted | `mode:Substitute` | 4 | 10 |
| Applied Pressure | `mode:Pressure` | 3 | 7 |
| Built Something | `mode:Build` | 3 | 8 |
| Cord Cutter ×3 | `category:subscriptions:mode:Withdraw` | 3 | **3** |
| Long Haul ×3 | `checkin:6mo` | 3 | — |

All thresholds are currently achievable.

> **⚠ The single most important content constraint.** Every
> `category:*` badge threshold **exactly equals its category's action count** —
> they're "clear the whole category" badges. So **adding an action to a category
> silently demotes its badge** from "complete the category" to "do most of it,"
> and **removing one makes the badge unearnable**. If you change any category's
> size, update that category's threshold in the same pass. `Cord Cutter ×3`
> (3 of 3 Withdraw-mode subscription actions) has the same coupling.
>
> `Untouchable` at 40 of 41 is also tight — one deletion breaks it.

### `time_served` — 2

- **Still Going** ⏳ — `checkin:3mo`, first 3-month check-in you confirm
- **The Long Haul** — `checkin:6mo`, first 6-month check-in

These key off the check-in cycle that `isTimeServed` actions enroll in, not off
claiming. `Long Haul ×3` (counter, above) needs 3 actions held to 6 months.

### Naming style

Short, punny, two-or-three words: *Prime Cut*, *Ghosted*, *Aisle Be Damned*,
*Know Your Owner*, *Cord Cutter*, *New Regular*. Icons are single emoji —
**explicitly placeholder art**, per the original build notes.

### Name collision to be aware of

**Untouchable** is both a *level* (level 7, at 40 claims) and a *badge*
(counter, threshold 40). They fire together and mean the same thing, but the
duplicate name reads like a bug if you see both at once.

---

## 6. Level ladder

Separate from badges. Driven purely by total claims, shown on Achievements.

| Level | Name | Claims |
|---:|---|---:|
| 0 | Bystander | 0 |
| 1 | Rookie | 1 |
| 2 | Starter | 3 |
| 3 | Mover | 6 |
| 4 | Switcher | 10 |
| 5 | Divester | 15 |
| 6 | Legend | 25 |
| 7 | Untouchable | 40 |

Note *Divester* is also a category-badge name (Investments), same as the
Untouchable collision.

---

## 7. Open questions / provisional bits

Things flagged as unfinished, in rough priority order:

1. **Badge art is emoji placeholders.** 61 of them. Real icons were always the
   plan.
2. **The action list is a first-pass draft.** 41 items authored in one go to
   fill out the 7 categories — not researched line-by-line, and never reviewed
   against the live 1STAND campaign copy.
3. **English-only content** (see §2.4).
4. **"Outside US" filter matches nothing** (see §3).
5. **Category badges are size-coupled** (see §5) — brittle by construction.
6. **`moneyPresets` is dead weight** — 13 actions still carry values, but money
   tracking was cut. Harmless, but it'll confuse the next person.
7. **Untouchable / Divester name collisions** between levels and badges.
8. **Copy tone is uneven in places** — some `shortDescription`s are sharp
   ("One account, six companies you're also funding"), others are flat.

---

## 8. Useful facts for a new thread

- 7 categories, 41 actions, 61 badges, 0 disabled. D1 matches the JSON.
- Meter: rolling 90-day window, goal 1,000, counted live from D1 per request.
- No quarantine — a new account's first action counts immediately.
- The public ledger shows action name + timestamp only, never the account.
- Category `colorKey` cycles `c1`/`c2`/`c3` (green/purple/orange) by sort order.
- Action ids use a short category prefix: `everyday-`, `subs-`, `banking-`,
  `attn-`, etc. Badge ids are `badge-<actionId>` for one-shots,
  `badge-champion-<categoryId>` for category counters.
- Editing checklist: update JSON → write `UPDATE`/`INSERT` SQL against D1 →
  wait 5 min for the KV catalog cache → verify at `/catalog`.
