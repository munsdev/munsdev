# DollarsOut — Build Spec

Gamified companion to the [1STAND.org](https://1stand.org) economic-pressure action list. Standalone resource first, optional account for tracking second. Mockup: `dollarsout-mockup-v2.html` (visual reference only — rebuild properly, don't ship that file).

## 1. What this is

People take real-world economic actions (cancel a subscription, switch banks, leave Amazon) drawn from a curated list. They mark actions done, collect badges for it, watch a personal ledger and a collective community meter grow, and share progress on social. No money changes hands anywhere in the product. Optional account = email + one-time passcode, nothing else.

**Non-negotiable design constraints:**
- Works completely, immediately, unauthenticated. Sign-in is additive (cross-device sync), never a gate.
- No made-up "impact" numbers. Only count what the user says they redirected (self-reported, clearly labeled as such) and real aggregate counts (actions logged, people verified). Never claim an effect on any company's revenue.
- Audience spans tech-illiterate grandparents to Gen Z. High contrast, large tap targets, icon+word always, no interface-only humor — copy carries the personality, chrome stays plain.
- Zero cost to the user anywhere in the flow.

## 2. Brand

**Name:** DollarsOut · **Tagline:** "Take your money out."
Domain: dollarsout.app (registered).

**Palette** (locked from mockup — do not substitute default AI-generated palettes):
```
--bg:         #FFD426   background field
--ink:        #14130F   text, outlines, shadows
--cream:      #FFF6D6   card fill / secondary surface
--grn-solid:  #00873E   buttons/fills with white text (AA-safe)
--grn-bright: #3ED17C   decorative fills with black text only
--pur-solid:  #5B2FB3   buttons/fills with white text
--pur-bright: #B79CFF   decorative fills with black text only
--orn-solid:  #C93E0B   buttons/fills with white text
--orn-bright: #FF8A5B   decorative fills with black text only
```
Rule: `-solid` variants always pair with white text (verified ≥4.5:1). `-bright` variants are decorative only and always pair with black/`--ink` text. Never put white text on a `-bright` fill or black text on a `-solid` fill.

**Type:** Archivo Black (display/headers/buttons), Archivo 500–800 (body/UI). Google Fonts, self-host for production rather than depending on the CDN at runtime.

**Visual language:** Hard 3–4px black outlines, solid offset drop-shadows (no blur), no gradients except the repeating-diagonal-stripe pattern used for "fill" elements (progress bars, receipts). Border-radius 10–20px depending on element size. Everything looks like a sticker or a piece of toy hardware, not a SaaS dashboard.

## 3. Information architecture

Four nav destinations, always visible at the bottom (mobile-first, works up to desktop via max-width centered layout):

1. **Home** — search/filter, collective meter, category list, aggregate stats
2. **Explore** — same category→action drill-down, reachable directly, supports deep links
3. **Shelf** — badges + level ladder + "still holding?" check-ins (signed-in only; empty state prompts sign-in when signed out)
4. **You** — personal ledger, stats, export/delete (signed-in only; empty state prompts sign-in when signed out)

Signed-out users get full Home/Explore functionality. Shelf/You show an empty state explaining what sign-in unlocks, never a hard wall.

## 4. Screen-by-screen

### Home
- Top bar: wordmark, sign-in status pill. If signed in, a level strip (segmented bar + level name + "N to next level") sits directly under the top bar — this is the **only** personal-progress meter that appears alongside the collective dial. Do not build a second competing gauge.
- Guest banner (signed-out only): "Browsing as guest — nothing is tracked. Save my progress →" — dismissible per session, not permanently.
- Search bar + filter icon button, always visible, not buried in a menu.
- Filter chip row: pinned quick filters (Surprise me, Under 5 min, Easy only, Anywhere) — tapping opens the fuller filter sheet for combinations.
- **Collective meter** ("Impact-O-Meter"): analog dial, single needle, three-band arc. Denominator is always a real, stated, resettable goal — e.g. "Goal: 50,000 actions this month." Never an invented maximum. Center readout: big number (live count) + "of 50,000 logged so far." Goal value and reset cadence are admin-configurable (see §7).
- Category list: fixed color per category (see §6), each row shows completed/total fraction for signed-in users, or total action count only for guests (no fraction with zero context).
- Aggregate stats block at the bottom of Home (not a separate nav tab): total actions logged, verified people count, and one live community goal bar (e.g. "10,000 bank switches — 71%"). This block is always public.

### Explore → Category → Action list
- Back button, category header with running fraction.
- Each action is a card: status box (empty / ✓ done / – marked N/A), title, one-line description, tag row (mode: Withdraw/Substitute/Pressure/Build; time; effort; availability: Anywhere/Outside US/US only).
- Two actions per undone card: primary **"I did this"** button, secondary **"Doesn't apply to me"** text link.
- "Doesn't apply" removes the item from the user's personal denominator (their category fraction), never from their history — reversible via an inline "undo" link that appears in its place. It must never silently vanish; the card collapses to a one-line "Marked doesn't apply · undo" state.
- Tapping the title (not the button) opens the full Action Detail screen.

### Action Detail
- Full long-description content (sourced from the 1STAND Actions CMS — see §8), tag row, helpful links.
- "I did this" and "Doesn't apply to me" repeated here at full size.

### Claim flow (triggered by "I did this")
This is the core interaction — build it exactly as staged, in this order:
1. Tap "I did this" → inline form expands under the card (no full-screen modal, keep context visible).
2. **Money redirected** (optional): preset chips per action (€0 / a sensible default / a higher default / Custom-with-numeric-input). Defaults come from the action's data, not guessed live.
3. **"What broke?"** (optional, free text, placeholder text supplies an example like "Nothing. Just annoying."). This field exists specifically because honest friction reports outperform polished claims when shared — see §9 share copy.
4. Confirm button ("Log it") commits the claim.
5. On confirm: (a) card updates to done state immediately: (b) a bottom toast appears — "Logged: [action title]" with an **Undo** button, auto-dismissing after 5 seconds, not sooner. Undo fully reverts the claim with no confirmation dialog. (c) *Only if* this claim crossed a real badge or level threshold, a badge popup appears (see below) — routine claims that don't unlock anything should NOT pop a modal; that cheapens the ones that do.

### Badge popup
- Stamp-style "Logged!" mark, badge name, one line of context (what it means numerically — total actions or money redirected), a mini receipt recap (action / time / what-broke text if provided), then the share row, then Close.
- Share row: labeled icon+text buttons (Instagram, TikTok, Bluesky, WhatsApp, More, Copy link) — never icon-only, per the accessibility requirement. "More" invokes the native Web Share API where available; fall back to a share-link sheet.
- Share generates an **image card** (see §9), not a bare link.

### Shelf (signed in)
- Level ladder card at top: current level name, segmented progress bar, "N to next," and the full named ladder in small print underneath so people can see what's coming (defined in §6).
- Badge grid, 3 columns, locked (greyscale, "Locked" or progress-fraction caption) vs unlocked (full color, date earned, "NEW!" tag if unlocked this session).
- "Still holding?" section: surfaces time-served badges due for a check-in (see §6 badge taxonomy), with **Still off it** / **Went back** buttons. Neither answer is punished — "Went back" logs a gentle no-judgment message and resets that specific timer; it must never delete history or shame the user.

### Shelf (signed out)
- Empty state: icon, "Nothing on the shelf yet," one sentence explaining badges need an account to survive a lost phone, single CTA "Save my progress" opening the auth sheet.

### You (signed in)
- Stat tiles: actions taken, redirected/year, badges earned, still-holding count.
- **Ledger** ("Where it went"): receipt-styled itemized list of claimed money-redirected amounts, summed to an annual total, followed by a mandatory disclaimer line stating plainly that this is self-reported redirection, not a claim about impact on any company. This disclaimer text is not optional and should not be editable away by future contributors — see §10.
- "Share your ledger" primary action → same share-card mechanism as badges.
- "Export or delete my data" — always visible, one tap, no dark patterns, no "are you sure" friction beyond a single confirm. Export produces a JSON download; delete is irreversible and says so plainly before the second tap.

### You (signed out)
- Empty state explaining sign-in, PLUS an explicit note that the whole action list works without an account and only badge/ledger persistence requires one — this screen is where guest users are most likely to feel locked out, so it must reassure rather than pressure.

### Filter sheet (bottom sheet, not a separate page)
Groups: Time it takes (5 min / 10–30 min / 1hr+ / Ongoing), Effort (Easy/Moderate/Advanced), Where you live (Anywhere/Outside US/US only), Status (Not done yet/Done). Multi-select chips within each group, single "Show results" commit button. Filters combine with search (AND across groups, OR within a group).

### Auth sheet (bottom sheet, two steps)
1. Email input + "Send my code." One line of plain-language privacy copy: no password ever, one-time code instead, data never sold, one-tap delete available anytime from You, actions never publicly linked to identity.
2. Six-digit OTP input (six single-character boxes, auto-advance focus), "Confirm," a visible "Resend" link.
No password field ever exists anywhere in the product.

## 5. Accessibility & inclusivity (hard requirements, not nice-to-haves)

- Minimum body text 16px, minimum any text 14px. Headers/buttons per the mockup's already-larger scale.
- All interactive elements ≥44×44px tap target (the mockup's badge grid needs enlarging to meet this in production — noted as a known gap).
- Every icon is paired with a text label. No icon-only controls anywhere, including share buttons and nav.
- Color is never the only signal — status also uses a checkmark/dash glyph and text, not fill color alone.
- Full keyboard navigation, visible focus rings (already styled via `:focus-visible` in the mockup CSS — carry this forward).
- Respect `prefers-reduced-motion`: disable the needle sweep, popup pop-in, and toast slide; use instant state changes instead.
- Support browser-level text zoom to 200% without breaking layout (avoid fixed-height text containers).
- Plan for German localization from the start even if English ships first — no hardcoded string concatenation, use a proper i18n key system. The core audience is substantially German (per 1STAND's base).

## 6. Gamification rules

### Levels (defined ladder — do not leave this open-ended)
| Level | Name | Actions required |
|---|---|---|
| 0 | Bystander | 0 |
| 1 | Rookie | 1–2 |
| 2 | Starter | 3–5 |
| 3 | Mover | 6–9 |
| 4 | Switcher | 10–14 |
| 5 | Divester | 15–24 |
| 6 | Legend | 25–39 |
| 7 | Untouchable | 40+ |

"Actions" for leveling purposes = distinct claimed actions, not repeat check-ins. Level is computed server-side, never client-trusted.

### Badge types — three shapes, not one
1. **One-shot** — awarded the instant a specific action is claimed (e.g. "Prime Cut" for cancelling Amazon Prime). One badge per qualifying action; define the mapping in the action-to-badge table seeded from the 1STAND Actions CMS.
2. **Counter** — awarded at a threshold across a category or mode (e.g. "Cord Cutter ×3" for three streaming cancellations; "Follow the Money" for reaching N actions total). Counters must be visibly progressing before unlock (e.g. "2 of 3") not just binary locked/unlocked.
3. **Time-served** — awarded via the "Still holding?" check-in loop. Requires a claimed action to have an associated start date; the system prompts the user at defined intervals (e.g. 1 month, 3 months, 6 months) to confirm they're still holding. A "Yes, still holding" response at the 6-month mark unlocks the badge; "Went back" resets that specific timer without penalty elsewhere. This is the retention mechanic — treat its notification/reminder design (email nudge, in-app badge) as first-class, not an afterthought.

Full badge list (names, icons, trigger rules) should be authored as structured data, not hardcoded in UI components, so new badges can be added without a redeploy. Target roughly 60 total badges at launch (matching the mockup's "14 of 60" framing), covering all 8 action categories plus a handful of cross-category / meta badges (e.g. "Registered" for the voting action, "Meeting Goer" for institutional-procurement actions).

### The collective meter — rules for honesty
- The dial's denominator is a real, human-set goal for the current period (default: monthly), never a derived or invented ceiling.
- The numerator is the true count of verified-account actions logged in that period (see §7 anti-bot — unverified/quarantined accounts do not count until they clear quarantine).
- When the goal is reached, do not reset instantly — hold the "full" state briefly with a celebratory state, then roll over to the next period's (higher) goal. Admin sets each period's goal manually or via a simple formula (e.g. 110% of last period's actual) — build this as a configurable value, not a hardcoded constant.
- Never display a needle position that doesn't map to a real, explainable fraction. If you cannot explain the number in one sentence to a skeptical journalist, don't ship it.

### "Doesn't apply to me"
Removes an action from a user's personal denominator only (their category fraction, their level count if it hadn't been claimed anyway). Does not affect collective stats. Must be undoable. Store as a distinct state, not a deletion, so users can find and restore it later from the action detail screen.

## 7. Anti-abuse / bot defense

The action catalog is bounded (~49 actions today, growing slowly via CMS updates) — a single fake account can inflate the aggregate count by at most that many claims, ever. This bounds the blast radius and shapes the defense: the threat is **account volume**, not per-account spam.

Required layers:
1. **Turnstile (Cloudflare)** on both the request-code and verify-code endpoints. No CAPTCHA-solving-service-friendly puzzle CAPTCHAs — Turnstile's invisible mode first, visible fallback only if it fails.
2. **Disposable-email domain blocklist** checked at signup, maintained as an updatable list (not hardcoded), rejecting known throwaway domains.
3. **Per-IP and per-ASN rate limits** on account creation and OTP requests (e.g. N accounts per IP per day; tune based on observed real-world patterns from shared-NAT contexts like universities and offices — don't set this so tight that a whole household or office gets blocked).
4. **48-hour quarantine before an account's actions count toward public aggregate stats.** The account works fully during quarantine (can browse, claim, see their own ledger) — only the *public* collective numbers exclude quarantined data until it clears. This removes the incentive to game the public dial in real time and gives moderation a window to catch anomalies before they're visible.
5. Log anomaly signals (burst claiming across the full 49-action list in seconds, identical "what broke" text across many accounts, etc.) for manual review — don't auto-ban on heuristics alone given the harm of wrongly locking out a real, if unusual, user (e.g. someone catching up on a backlog of real actions).

## 8. Data model & content source

**Source of truth for action content is the 1STAND.org Webflow CMS**, Actions collection (site ID `69a1a23b929de4a13af87819`, collection ID `69a446acb75c3e74816c32c0`). Do not hand-author action copy inside this app — sync from Webflow via its API/webhooks so 1STAND remains the single editable source and this app stays current automatically.

Relevant existing Webflow fields to map:
- `name`, `slug`, `short-description`, `long-description` (rich text/HTML)
- `tags-2` → Action Types (includes the four new modes: Withdraw/Substitute/Pressure/Build, plus category-ish tags like time/effort — reconcile against this app's own category taxonomy, they don't map 1:1)
- `availability` (new field: Anywhere / Outside US / US only)
- `effort` (Easy/Moderate/Advanced)
- `time` (5 Minutes/10–30 Minutes/1–2 Hours/1 Day/Ongoing/Varies)
- `website` and other link fields → Helpful Resources
- `audience-2` (American Citizens/Immigrants/International Supporters)

This app's own data (accounts, claims, badges, levels, ledger entries, N/A markers, aggregate counters) is separate and does not live in Webflow — build it in Cloudflare D1 (see §11).

**Money-redirected presets** per action should be authored alongside the content (not guessed by the app at claim time) — extend the sync or maintain a small companion mapping of `action-slug → [preset amounts]` since Webflow doesn't currently have this field; consider requesting it be added to the CMS as a follow-up rather than forking the data model.

## 9. Sharing

- Every claim/badge/ledger share generates a **rendered image card** (not a bare link) sized for common platforms (at minimum 1080×1080 and a 9:16 story variant). Server-rendered (e.g. via a Worker using an HTML-to-image approach, or a client canvas fallback) so it works without native share-sheet image support.
- Card content: DollarsOut wordmark, the action/badge/ledger headline, the optional money figure, and — when present — the "what broke" text verbatim. Never invent or embellish this copy.
- No login required to view a shared card (public, unauthenticated route) — the person clicking through from social should land on a working page even before creating an account.
- Suggested caption copy to pre-fill (never preachy, stated as fact — pull from the shortlist already agreed):
  - "I took [€X] out."
  - "Cancelled. Redirected. Done."
  - "One less [company]."
  - "Dollars out. Receipts in."
- Share targets: Instagram, TikTok, Bluesky, WhatsApp, native "More" (Web Share API), Copy link. All labeled icon+text.

## 10. Copy guardrails (apply to all future contributors, not just this build)

- Never state or imply a dollar figure represents damage to a company. The ledger disclaimer in §4 (You screen) is mandatory, not optional boilerplate to be trimmed later.
- Never build a competitive/ranked leaderboard of individuals. Collective goals only.
- "Doesn't apply" and "Went back" must never carry punitive or shaming copy — this is explicitly about sustaining participation from imperfect, real people over years, not scoring purity.
- Every acknowledgment of an action mentioning Tesla/EV/vehicle-related demonstrations must retain the existing non-violence framing already established in the 1STAND content (peaceful, no property damage) if this app ever surfaces that context.

## 11. Suggested technical shape

(Casey's own stack preference — confirm before deviating)
- **Frontend:** static site, framework optional but keep it light — this needs to load fast on old phones over bad connections. Vanilla or a minimal framework (Astro/Svelte) over a heavy SPA framework, given the accessibility and performance bar.
- **Backend:** Cloudflare Worker.
- **Database:** Cloudflare D1 for accounts, claims, badges, ledger entries.
- **Aggregate counters:** Cloudflare KV for the fast-path public numbers (dial value, community goal bars) to avoid hammering D1 on every homepage load; reconcile periodically from D1 as source of truth.
- **Auth:** email + Turnstile-protected OTP, Worker-issued session token (short-lived, httpOnly cookie), no third-party auth provider needed given the minimal requirements.
- **Email delivery:** needs an EU-resident-friendly transactional sender for the OTP codes (Casey has prior context on this from the 1STAND Mobilizon setup — reuse or extend that decision rather than introducing a new vendor).
- **Image card rendering:** Worker-side HTML/SVG-to-image (e.g. `@cloudflare/pages-plugin-og` style approach or a Satori-based renderer) so share cards work without client-side canvas quirks.
- **Content sync:** scheduled Worker or webhook-triggered pull from the Webflow CMS API into D1, so the action catalog stays current without manual duplication.

## 12. Open decisions for Casey before/during build

1. Exact badge list (60 names/icons/trigger rules) — needs authoring, not yet finalized beyond the categories.
2. Real badge artwork — emoji are placeholder only; illustrated badges are the highest-leverage art spend since they're the most-screenshotted asset.
3. Money-redirected preset amounts per action — needs a first pass of real, defensible figures (subscription costs, typical bank fees, etc.), sourced and documented.
4. Community goal values and reset cadence — who sets these, how often, is there an admin UI or is it a config file edit.
5. Whether "Explore" and category browsing need a true search backend or client-side filter over the (small, ~49-item) dataset is sufficient — likely the latter given catalog size.
6. German localization — full translation before launch, or English-first with German fast-follow.
