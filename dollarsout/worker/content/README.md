# Content layer

DollarsOut is fully self-contained — there is no live connection to Webflow
or any other CMS. Everything below describes where content lives and how it
reaches D1.

## Source of truth

| File | Holds |
|---|---|
| `categories.json` | The 8 categories, including per-category `disclaimer` copy |
| `actions/NN-<category-id>.json` | The 100 actions, one file per category |
| `badges.json` | Standalone badges: marquee one-shots, milestones, time-served, meta |
| `badge_chains.json` | The 12 counter-driven chains and their 4 tiers each |

`seed_content.sql` is **generated** — never edit it by hand. The action files
are split per category because a single 100-entry `actions.json` was no longer
reviewable; the filename's category slug (after the sort prefix) is what sets
each action's `categoryId`, and position in the file sets `sortOrder`.

## Workflow

```bash
npm run build:content   # validate + regenerate seed_content.sql
npm run seed:remote     # build, then push into D1
```

`build:content` fails loudly rather than emitting a bad seed. It checks that:

- every `points` value is one of 5 / 10 / 25 / 50 / 75 / 100
- `cooldownDays` appears on repeatable actions and nowhere else, and
  `checkinDays` on sustained actions and nowhere else
- every key in an action's `counters` matches a real chain counter
- every chain counter is incremented by at least one action (a chain nothing
  feeds can never be awarded)
- chain tier thresholds ascend
- one-shot badges point at action ids that exist
- the starter set is exactly 10 actions, all `global` scope

## Field notes

**`points`** are personal progression only and never appear on the public
meter. The six bands are fixed; the build rejects anything else.

**`recurrence`** decides how a claim is stored:
- `once` — one row in `user_action_state`, done and stays done.
- `sustained` — same row, plus `checkinDays` scheduling a check-in. Time is
  *banked*: answering "I stopped" credits the months already served and
  restarts the clock rather than zeroing the total.
- `repeatable` — one row per logging in `user_claims_log`, throttled by
  `cooldownDays`. These can't share `user_action_state`, which is
  `UNIQUE(account_id, action_id)` by design.

**`targets`** is a locale map (`{"default": [...], "de": [...]}`). The
frontend resolves it against the UI locale and falls back to `default`. Action
`name` and `shortDescription` stay locale-neutral so the target names are the
only thing that varies by country.

**`counters`** lists which badge chains an action feeds. One action can feed
several — cancelling a subscription that was also a US service increments both
`subs_cancelled` and `services_swapped_eu`.

## What was removed, and why

- **`mode`** (Withdraw / Substitute / Pressure / Build) — the four buckets
  never divided the actions cleanly, and review found the tagging incoherent.
  `recurrence` plus category carries the same weight without the ambiguity.
- **`availability`** — folded into `scope_region` (`global` / `eu` / `us`),
  which the location filter now drives off directly.
- **`money_presets`** — dead feature, cut from the product earlier.
- **Category / mode / combo counter badges** — keyed on "N actions within
  this category", so every content edit silently moved the goalposts for
  anyone mid-progress. Replaced by `badge_chains`, keyed on counters an action
  increments explicitly, which are stable across content changes.

## Provenance

`categories.json` was originally imported once from the 1STAND Webflow Actions
CMS (collection `69a446acb75c3e74816c32c0`); the `webflowItemId` on each
category is kept for traceability but nothing re-fetches it. The action and
badge lists have always been hand-authored here — the CMS only ever had
campaign-level items ("Shift Your Everyday Spending"), not the individually
claimable line items the UI needs.

GDPR copy in `actions/08-data-rights.json` deliberately links to noyb's and
the EDPB's own published pages rather than reproducing request wording. Do not
replace those links with generated template text.
