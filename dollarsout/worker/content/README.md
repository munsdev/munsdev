# Content layer

DollarsOut is fully self-contained — there is no live connection to Webflow
or any other CMS. Everything below describes where the content was
originally drawn from, not an ongoing sync.

`categories.json` was originally sourced from the 1STAND Webflow Actions CMS
(collection `69a446acb75c3e74816c32c0`), filtered to the 9 items tagged
**Boycott / Economic Pressure**, minus two that don't fit a consumer-category
shape (folded into existing categories instead — see notes below), as a
**one-time import**. Each category's `webflowItemId`, `name`,
`shortDescription`, and `website` link trace back to that original CMS item
for provenance, but nothing re-fetches them — edit `categories.json` (and
push the change into D1) the same way you'd edit any other content here.

`actions.json` and `badges.json` are **not** 1:1 synced from Webflow — the
CMS only has campaign-level items ("Shift Your Everyday Spending"), not the
granular, individually-claimable line items DollarsOut's UI needs ("Cancel
Amazon Prime"). The spec anticipated exactly this gap for money-redirected
presets ("maintain a small companion mapping... since Webflow doesn't have
this field" — spec §8) and separately lists the badge list and money presets
as open decisions for Casey to finalize (spec §12, items 1 and 3). This first
pass extends that same companion-mapping approach to the action list itself:
real category framing from the CMS, hand-authored granular sub-actions and
badges as a **draft** pending a real content pass — replace freely, nothing
here is meant to ship as final copy. `disabled: true` actions are excluded
from all counts.

Two CMS items didn't get their own category:
- **Research Companies Before You Spend** → folded in as an Everyday
  Spending action (`everyday-research-companies`).
- **#BoycottCitizens — Pull Your Money from ICE Detention Financing** →
  folded in as a Money & Banking action (`banking-detention-financing`).

Money amounts are in whole euros (matching the mockup's `€` chips); the
Worker stores claimed amounts in cents.
