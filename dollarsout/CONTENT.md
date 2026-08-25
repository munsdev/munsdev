# DollarsOut — content reference

Working doc for the **items** in the app: categories, actions, and badges.
Self-contained — you should be able to drop this into a fresh conversation and
work on content without re-reading the repo.

Live at **dollarsout.1stand.org**. Repo path `dollarsout/`.

---

## 1. What the app does

Companion to 1STAND's economic-pressure action list. You browse **actions**
(concrete things like "Cancel Amazon Prime"), tap one to open its detail, and
hit **I did this** to log it. Logging is per-account and requires sign-in
(email + one-time code, no passwords). A claim can be removed at any time.

Three tabs:

- **Home** — the *Impact-O-Meter*, a dial showing everyone's combined loggings
  over a **rolling 90 days** against a goal of **1,000**. Plus a live global
  activity ledger (action name + timestamp, never who did it).
- **Actions** — search, entry tiles, and (for new accounts) the **starter set**.
- **Achievements** — 12 badge chains plus 27 standalone badges, each showing
  how rare it is.

Content is fully self-contained — no live CMS sync.

---

## 2. Where content lives

See `worker/content/README.md` for the authoring workflow and the full list of
validation rules. In short: JSON under `worker/content/` is the source of
truth, `npm run build:content` validates it and regenerates
`seed_content.sql`, `npm run seed:remote` pushes that into D1.

Content edits are safe to make freely — the build refuses to emit a seed that
would break badge awarding.

---

## 3. Action schema

| Field | Notes |
|---|---|
| `points` | One of **5 / 10 / 25 / 50 / 75 / 100**. Personal progression only — never shown on the public meter. |
| `recurrence` | `once` \| `sustained` \| `repeatable`. Decides how the claim is stored. |
| `cooldownDays` | Repeatable only. How long before it can be logged again. |
| `checkinDays` | Sustained only. Check-in interval, 90 throughout. |
| `scopeRegion` | `global` \| `eu` \| `us`. Drives the location filter. |
| `targets` | Locale map of suggested alternatives; falls back to `default`. |
| `counters` | Which badge chains this action feeds. |
| `isStarter` | Part of the 10-action onboarding set. |
| `effort`, `timeEstimate` | Filter facets, unchanged. |

Points bands, in words: 5 micro, 10 easy, 25 standard, 50 significant,
75 heavy, 100 flagship.

### How recurrence behaves

- **`once`** — done and stays done.
- **`sustained`** — checked in on every 90 days. Time is **banked, not
  streaked**: answering "I stopped" credits the months already served and
  restarts the clock. Someone who held a bank switch for five months has moved
  money for five months, and the UI says so.
- **`repeatable`** — each logging is its own row and counts separately toward
  the meter and its chains, throttled by `cooldownDays`.

### Backdating

Every action's claim sheet carries an **"I did this before finding the app"**
checkbox with a date picker (up to two years back). This replaced a standalone
"log a past redirect" action, which only worked once and had no completion
moment. A backdated claim outside the 90-day window simply doesn't count
toward the public meter — which is correct; the meter measures recent activity.

---

## 4. Inventory — 100 actions across 8 categories

`R` = recurrence (`1` once, `S` sustained, `R` repeatable). ★ = starter set.

### Everyday Spending (`everyday-spending`) — 14

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| Cancel Amazon Prime ★ | 1 | 25 | global | subs_cancelled |
| Delete the Amazon app from your phone ★ | 1 | 10 | global | — |
| Remove your saved card from one online retailer ★ | R | 10 | global | — |
| Buy your next book from an independent bookshop | R | 10 | global | local_purchases, purchases_redirected |
| Switch one cleaning brand off P&G or Unilever | S | 25 | global | purchases_redirected |
| Switch your personal care brand | 1 | 10 | global | purchases_redirected |
| Move your regular shop to a cooperative grocer | S | 50 | global | purchases_redirected, local_purchases |
| Buy your next device refurbished instead of new | R | 25 | global | purchases_redirected |
| Replace one US soft drink brand for good | S | 10 | global | purchases_redirected |
| Buy it secondhand instead of new | R | 10 | global | purchases_redirected |
| Skip a US fast-food chain for a local place | R | 5 | global | local_purchases, purchases_redirected |
| Unsubscribe from one retailer's marketing emails ★ | R | 5 | global | — |
| Shop at your local market this week | R | 5 | global | local_purchases |
| Cancel a warehouse club membership | 1 | 25 | global | subs_cancelled |

### Subscriptions (`subscriptions`) — 13

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| List every subscription you're paying for | 1 | 10 | global | — |
| Cancel Netflix ★ | 1 | 25 | global | subs_cancelled |
| Cancel Disney+ | 1 | 25 | global | subs_cancelled |
| Cancel Prime Video | 1 | 25 | global | subs_cancelled |
| Cancel Apple TV+ | 1 | 25 | global | subs_cancelled |
| Cancel Max or Paramount+ | 1 | 25 | global | subs_cancelled |
| Cancel Audible | 1 | 10 | global | subs_cancelled |
| Watch your public broadcaster instead | S | 10 | eu | services_swapped_eu |
| Subscribe to a European streaming service | 1 | 10 | eu | services_swapped_eu |
| Move your cloud storage off Google, Apple or Microsoft | 1 | 50 | global | services_swapped_eu, accounts_moved |
| Move your email off Gmail or Outlook | 1 | 75 | global | services_swapped_eu, accounts_moved |
| Replace your US office suite | 1 | 50 | global | services_swapped_eu, subs_cancelled |
| Switch to a European VPN | 1 | 25 | global | services_swapped_eu |

### Money & Banking (`money-banking`) — 13

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| Open an account at a cooperative or ethical bank | 1 | 50 | global | accounts_moved |
| Move your primary current account | S | 100 | global | accounts_moved |
| Move your savings to an ethical bank | 1 | 75 | global | accounts_moved |
| Move your money out of a detention or fossil financier | 1 | 75 | global | accounts_moved |
| Switch your card to a non-US-linked issuer | 1 | 50 | global | non_us_payments |
| Pay by Wero, girocard, Bizum or your domestic scheme | S | 50 | eu | non_us_payments |
| Move one recurring bill to SEPA direct transfer | 1 | 25 | eu | non_us_payments |
| Stop using PayPal for one recurring payment | 1 | 25 | global | non_us_payments |
| Remove Apple Pay or Google Pay as your default | 1 | 10 | global | non_us_payments |
| Cancel a US-issued credit card | 1 | 25 | global | accounts_closed |
| Pay cash for a week | R | 10 | global | non_us_payments |
| Tell your bank why you left, in writing | 1 | 25 | global | comments_filed |
| Ask your club or congregation which bank it uses | 1 | 25 | global | institutional_actions |

### Investments (`investments`) — 11

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| Get your pension's holdings list | 1 | 25 | global | investment_actions |
| Find out who administers your workplace plan | 1 | 10 | global | investment_actions |
| Move a self-managed account to a European broker | 1 | 75 | eu | investment_actions, accounts_moved |
| Switch one fund to a screened alternative | 1 | 75 | global | investment_actions |
| Move a US-domiciled ETF into a UCITS equivalent | 1 | 50 | eu | investment_actions |
| Divest one named holding | 1 | 50 | global | investment_actions |
| Vote your proxy | R | 50 | global | investment_actions |
| Back a shareholder resolution | R | 25 | global | investment_actions |
| Ask your provider to publish its exclusion list | 1 | 25 | global | investment_actions, comments_filed |
| Attend your pension scheme's member meeting | R | 25 | global | investment_actions, institutional_actions |
| Ask your works council to raise the plan provider | 1 | 25 | eu | investment_actions, institutional_actions |

### Travel (`travel`) — 12

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| Cancel or redirect a US trip, and say why | 1 | 50 | global | comments_filed |
| Take the train instead of a short-haul flight | R | 25 | eu | train_over_flight |
| Book a night train | R | 25 | eu | train_over_flight |
| Get an Interrail or Eurail pass | 1 | 25 | eu | train_over_flight |
| Holiday in Europe this year | S | 25 | eu | — |
| Fly a European carrier instead of a US one | R | 10 | global | — |
| Book your hotel direct instead of through a platform | R | 10 | global | purchases_redirected |
| Skip Airbnb for a local guesthouse or Fairbnb | R | 10 | global | purchases_redirected, local_purchases |
| Rent from a European car company | R | 10 | eu | purchases_redirected |
| Use a national tourist board instead of a US platform | R | 10 | global | — |
| Take the coach instead | R | 5 | eu | train_over_flight |
| Tell an operator why you changed your booking | 1 | 10 | global | comments_filed |

### Institutions (`institutions`) — 13

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| Ask your employer who its cloud provider is | 1 | 25 | global | institutional_actions |
| Propose one procurement change in writing | 1 | 75 | global | institutional_actions |
| Raise a vendor at your works council or union | 1 | 50 | eu | institutional_actions |
| Ask your child's school which software it runs on | 1 | 25 | global | institutional_actions |
| Submit a public comment on a public contract | R | 50 | global | comments_filed, institutional_actions |
| Look up a contract on TED or your procurement portal | 1 | 10 | eu | institutional_actions |
| Attend a council or shareholder meeting | R | 25 | global | institutional_actions |
| Sign a European Citizens' Initiative | R | 10 | eu | comments_filed |
| Write to your MEP about digital sovereignty | R | 25 | eu | comments_filed |
| Petition the European Parliament | R | 25 | eu | comments_filed |
| Vote in your local election as an EU resident | 1 | 50 | eu | institutional_actions |
| Register to vote, or confirm you're registered | 1 | 25 | us | institutional_actions |
| Ask your Verein or club about its contracts | 1 | 25 | eu | institutional_actions |

### Attention (`attention`) — 12

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| Install uBlock Origin ★ | 1 | 10 | global | services_swapped_eu |
| Delete your X account | 1 | 50 | global | accounts_closed |
| Deactivate Instagram or Facebook | S | 50 | global | — |
| Move a group chat off WhatsApp | 1 | 50 | global | services_swapped_eu |
| Switch your default search engine ★ | 1 | 10 | global | services_swapped_eu |
| Switch your browser off Chrome | 1 | 25 | global | services_swapped_eu |
| Switch your maps app | 1 | 10 | global | services_swapped_eu |
| Join Mastodon or a European platform | 1 | 25 | global | services_swapped_eu |
| Switch to a chronological feed ★ | 1 | 10 | global | — |
| Turn off ad personalisation on one platform ★ | 1 | 10 | global | — |
| Subscribe directly to a local newspaper | S | 25 | global | local_purchases |
| Install Consent-O-Matic and reject by default | 1 | 10 | eu | — |

### Data & Digital Rights (`data-rights`) — 12

| Action | R | Pts | Scope | Counters |
|---|---|---|---|---|
| File a GDPR erasure request (Art. 17) | R | 50 | eu | gdpr_requests |
| File a subject access request (Art. 15) | R | 25 | eu | gdpr_requests |
| Object to direct marketing processing (Art. 21) | R | 25 | eu | gdpr_requests |
| Export your data before you leave (Art. 20) | R | 10 | eu | gdpr_requests |
| File a complaint with your data protection authority | R | 75 | eu | gdpr_requests, comments_filed |
| Opt out of one data broker | R | 25 | global | gdpr_requests |
| Use your DMA choice screen to change a default | 1 | 10 | eu | services_swapped_eu |
| Unlink your accounts under DMA gatekeeper rules | 1 | 25 | eu | — |
| Turn off cross-app tracking on your phone ★ | 1 | 10 | global | — |
| Delete an old account you no longer use | R | 10 | global | accounts_closed |
| Ask a company to name its sub-processors | 1 | 25 | eu | gdpr_requests |
| Support a digital rights organisation | S | 50 | global | — |

### Distribution

| Category | Actions | Points |
|---|---|---|
| Everyday Spending | 14 | 225 |
| Subscriptions | 13 | 365 |
| Money & Banking | 13 | 545 |
| Investments | 11 | 435 |
| Travel | 12 | 215 |
| Institutions | 13 | 420 |
| Attention | 12 | 285 |
| Data & Digital Rights | 12 | 340 |

Exactly **1 of 100** actions is US-only: *Register to vote, or confirm you're
registered*. The old detention-financing action is now `global`, since
BankTrack and Urgewald cover European banks too. That is the Europe-first
pivot working as intended.

### Starter set (10)

Named, ≤5 minutes, global scope, nothing to look up first. Surfaced at the top
of the Actions tab until the account has logged five things, then it retires
itself.

Cancel Amazon Prime · Cancel Netflix · Install uBlock Origin · Switch your
default search engine · Switch to a chronological feed · Turn off ad
personalisation on one platform · Remove your saved card from one online
retailer · Unsubscribe from one retailer's marketing emails · Turn off
cross-app tracking on your phone · Delete the Amazon app from your phone

---

## 5. Badges — 39 grid entries

### 12 chains × 4 tiers (48 unlock events, 12 grid entries)

| Chain | Counter | I | II | III | IV |
|---|---|---|---|---|---|
| Unsubscribed | `subs_cancelled` | 1 | 5 | 15 | 30 |
| Rerouted | `purchases_redirected` | 1 | 10 | 30 | 75 |
| Erasure | `gdpr_requests` | 1 | 5 | 15 | 30 |
| Off the Rails | `non_us_payments` | 1 | 25 | 100 | 365 |
| Rolling Stock | `train_over_flight` | 1 | 5 | 15 | 40 |
| Deposits | `accounts_moved` | 1 | 2 | 4 | 6 |
| Substituted | `services_swapped_eu` | 1 | 5 | 12 | 25 |
| On the Record | `comments_filed` | 1 | 3 | 8 | 20 |
| Withdrawn | `accounts_closed` | 1 | 5 | 12 | 25 |
| Local | `local_purchases` | 1 | 10 | 30 | 75 |
| Convener | `institutional_actions` | 1 | 3 | 8 | 15 |
| Portfolio | `investment_actions` | 1 | 3 | 6 | 10 |

A chain is **one** grid entry showing its highest unlocked tier — 12 things to
collect, not 48. The chain sheet shows the whole ladder so the next target is
always visible.

Chains replaced the old category / mode / combo counter badges, which were
keyed on "N actions within this category" and so moved the goalposts for
anyone mid-progress every time the action list changed. A counter key is
stable across content edits.

### 14 marquee one-shots

Prime Cut · Cancelled · Blocked · Bank Job · Ghosted · Off the Ride ·
Mail Drop · Escalated · Paper Trail · Proxy · Sleeper · Tabled · Own Rails ·
Signed Off

### 5 milestones, 2 time-served, 6 meta

Milestones fire at 5 / 10 / 25 / 50 / 100 total loggings. Time-served are
Still Going (3 months banked) and The Long Haul (6 months).

The six meta badges and their rules:

| Badge | Rule (`scope`) |
|---|---|
| Grand Slam | `meta:all_categories` — one logging in every category |
| Completionist | `meta:category_sweep` — every action in any one category |
| Polyglot | `meta:chains_started` — tier I on 8 different chains |
| Full Sovereign | `meta:chain_tier4` — tier IV on any chain |
| Rare Bird | `meta:rare_badge` — holds a badge under 5% rarity |
| Founder | `meta:founder` — one of the first 100 accounts; retires itself |

### Rarity

Every badge and tier shows `earned_count / active_accounts` as a percentage,
computed at read time from a single grouped count — never stored, since a
stored figure is wrong the moment anyone else earns one. Rare Bird needs at
least 20 active accounts before it can fire, otherwise everything looks rare.

---

## 6. Level ladder

Unchanged: Bystander 0 · Rookie 1 · Starter 3 · Mover 6 · Switcher 10 ·
Divester 15 · Legend 25 · Untouchable 40. Counted on total loggings, so
repeats count.

---

## 7. Things to know before editing

- **Action `name` and `shortDescription` stay locale-neutral.** Only `targets`
  varies by country. There is one locale picker (en/de/es/fr) and it doubles
  as the country hint.
- **GDPR copy is sourced, not generated.** `actions/08-data-rights.json` links
  to noyb's and the EDPB's own published pages rather than reproducing request
  wording. Keep it that way — it is legal-adjacent copy.
- **Investments carries a standing disclaimer**, rendered under every action in
  that category. No action there names a security to buy.
- **Booking.com is US-owned** (Booking Holdings, Connecticut) — the "book
  direct" action says so explicitly, because people assume otherwise.
- **Spotify is Swedish**, which is why there is no "switch your music
  subscription" action. Don't re-add one unless it is retargeted away from
  Spotify and toward Apple / YouTube / Amazon Music.
