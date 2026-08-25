import { t, loadLocale, detectPreferredLocale, currentLocale } from "./i18n.js";
import { api } from "./api.js";
import { TURNSTILE_SITE_KEY } from "./config.js";
import { LEVEL_LADDER, computeLevel } from "./state.js";

// ---------------- module state ----------------
let catalog = { categories: [], actions: [], badges: [], chains: [] };
let stats = { period: null, peopleVerified: 0, communityGoals: [] };
let session = { loggedIn: false, email: null };
let stateByActionId = new Map(); // actionId -> {status, nextCheckinDue, ...} -- empty when signed out
let earnedBadgeIds = new Set();
let earnedBadgeDates = new Map(); // badgeId -> earnedAt, for the achievement detail sheet
let badgeRarity = new Map(); // badgeId -> % of active accounts holding it, computed server-side
let userChains = []; // per-chain progress from /me: value, currentTier, nextThreshold
let userCounters = {}; // counter key -> value
let currentCategoryId = null;
let currentActionId = null;
let toastTimer = null;
let pendingAction = null; // actionId -- resumed automatically right after sign-in
let turnstileRendered = { 1: false, 2: false };

const LOCALES = ["en", "de", "es", "fr"];

const filters = {
  search: "",
  quick: { under5: false, easy: false, anywhere: false },
  sheet: { time: new Set(), effort: new Set(), location: new Set(), status: new Set() },
};

const $ = (id) => document.getElementById(id);

// ---------------- boot ----------------
async function boot() {
  await loadLocale(detectPreferredLocale());
  wireStaticEvents();

  try {
    catalog = await api.getCatalog();
  } catch {
    catalog = { categories: [], actions: [], badges: [], chains: [] };
  }
  try {
    stats = await api.getStats();
  } catch {
    stats = { period: null, peopleVerified: 0, communityGoals: [] };
  }
  try {
    session = await api.getSession();
  } catch {
    session = { loggedIn: false, email: null };
  }

  await refreshUserState();
  renderTopbar();
  renderMeter();
  renderAggregate();
  renderExplore();
  refreshRecentLedger();
  go("home");
}

function clearUserState() {
  stateByActionId = new Map();
  earnedBadgeIds = new Set();
  earnedBadgeDates = new Map();
  badgeRarity = new Map();
  userChains = [];
  userCounters = {};
}

async function refreshUserState() {
  if (!session.loggedIn) return clearUserState();

  try {
    const me = await api.me();
    stateByActionId = new Map(me.states.claimed.map((s) => [s.actionId, s]));
    // /me returns full state rows here, not bare ids -- keying these by the row itself used to
    // silently drop every "not applicable" mark out of the map.
    for (const s of me.states.na) stateByActionId.set(s.actionId, s);

    // Chain tiers are earned things too, so the shelf and the "unlocked" checks treat them
    // exactly like standalone badges -- they just render grouped by chain.
    earnedBadgeIds = new Set(me.badges.filter((b) => b.earnedAt).map((b) => b.id));
    earnedBadgeDates = new Map(me.badges.map((b) => [b.id, b.earnedAt]));
    badgeRarity = new Map(me.badges.map((b) => [b.id, b.rarityPct ?? 0]));

    for (const chain of me.chains || []) {
      for (const tier of chain.tiers) {
        if (tier.earnedAt) earnedBadgeIds.add(tier.id);
        earnedBadgeDates.set(tier.id, tier.earnedAt);
        badgeRarity.set(tier.id, tier.rarityPct ?? 0);
      }
    }

    userChains = me.chains || [];
    userCounters = me.counters || {};
  } catch {
    clearUserState();
  }
}

// ---------------- topbar / level ----------------
function levelProgressPct(totalClaimed, level) {
  if (!level.nextName) return 100;
  const currentDef = LEVEL_LADDER.find((l) => l.level === level.level);
  const nextDef = LEVEL_LADDER.find((l) => l.name === level.nextName);
  const span = nextDef.min - currentDef.min;
  const progressed = totalClaimed - currentDef.min;
  return Math.max(0, Math.min(100, Math.round((progressed / span) * 100)));
}

function renderTopbar() {
  $("authPill").textContent = session.loggedIn ? t("auth.signedIn") : t("auth.guest");

  // Counts repeats, matching the server's tally -- otherwise the level shown here drifts below
  // the one /me reports as soon as anyone logs a repeatable action twice.
  const totalClaimed = totalLoggings();
  const level = computeLevel(totalClaimed);
  const pct = levelProgressPct(totalClaimed, level);

  // Level progress lives on the Achievements screen only -- the top bar just carries identity.
  const shelfLvlName = $("shelfLvlName");
  if (shelfLvlName) {
    shelfLvlName.textContent = `Lv${level.level} ${level.name}`;
    $("shelfLvlBar").style.width = `${pct}%`;
    $("shelfLvlNext").textContent = level.nextName ? t("level.toNext", { count: level.actionsToNext, name: level.nextName }) : "";
  }
}

// ---------------- meter (collective dial) ----------------
// Gauge geometry, matching the static markup in index.html: a 180° band of radius 112 centred on
// (168,160), swept left (0) to right (goal). The band shows the whole green->red scale at all
// times -- it's the dial face, not a progress bar -- and the needle alone reports the live count.
const GAUGE = { cx: 168, cy: 160, labelR: 146 };

/** Compact scale label: 100000 -> "100K", 2500 -> "2.5K", 0 -> "0". */
function compactNumber(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

/** Draws the 0/¼/½/¾/goal numbers around the dial, derived from the live goal. */
function renderMeterScale(goal) {
  const g = $("meterScale");
  g.innerHTML = "";
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const angle = ((180 - f * 180) * Math.PI) / 180;
    const x = GAUGE.cx + GAUGE.labelR * Math.cos(angle);
    const y = GAUGE.cy - GAUGE.labelR * Math.sin(angle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x.toFixed(1));
    // The 0 and goal labels come out level with the flat ends of the band and collide with them;
    // drop just those two clear of it.
    text.setAttribute("y", (f === 0 || f === 1 ? y + 17 : y).toFixed(1));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = compactNumber(Math.round(goal * f));
    g.appendChild(text);
  }
}

function renderMeter() {
  const period = stats.period;
  const count = period?.count ?? 0;
  const goal = period?.goal ?? 1;
  const pctRaw = goal > 0 ? count / goal : 0;
  const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(1, pctRaw)) : 0;

  renderMeterScale(goal);
  $("needle").setAttribute("transform", `rotate(${(-90 + pct * 180).toFixed(2)} ${GAUGE.cx} ${GAUGE.cy})`);

  // The dial carries no text of its own, so the accessible name has to state the reading.
  $("meterSvg").setAttribute("aria-label", t("meter.aria", { count: count.toLocaleString(), goal: goal.toLocaleString() }));

  // Help quotes the live goal, so it is filled here rather than by the static-string pass -- that
  // pass has no way to substitute {goal}, and this runs on both boot and every locale change.
  $("helpMeterAnswer").textContent = t("help.a3", { goal: goal.toLocaleString() });

  animateCount($("meterTick"), count);
}

function animateCount(el, target) {
  const t0 = performance.now();
  function step(now) {
    const p = Math.min((now - t0) / 1200, 1);
    el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = target.toLocaleString();
  } else {
    requestAnimationFrame(step);
  }
}

async function refreshHome() {
  try {
    stats = await api.getStats();
  } catch {
    // keep showing the last-known stats rather than blanking the meter on a flaky request
  }
  renderMeter();
  renderAggregate();
  refreshRecentLedger();
}

// ---------------- global anonymized ledger ----------------
function formatRelativeTime(iso) {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return t("time.justNow");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("time.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("time.hoursAgo", { count: diffHr });
  return t("time.daysAgo", { count: Math.floor(diffHr / 24) });
}

function ledgerRowEl(item) {
  const row = document.createElement("div");
  row.className = "ledgerRow";
  row.innerHTML = `<span class="name">${esc(item.actionName)}</span><span class="ts">${esc(formatRelativeTime(item.claimedAt))}</span>`;
  return row;
}

function renderLedgerRows(container, items) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = `<p class="ledgerEmpty">${esc(t("ledger.empty"))}</p>`;
    return;
  }
  for (const item of items) container.appendChild(ledgerRowEl(item));
}

async function refreshRecentLedger() {
  try {
    const { items } = await api.getRecentLedger();
    renderLedgerRows($("recentLedger"), items);
  } catch {
    // leave whatever was last shown rather than blanking it on a flaky request
  }
}

let ledgerNextOffset = null;

async function openLedgerPage() {
  $("fullLedger").innerHTML = `<p class="ledgerEmpty">${esc(t("common.loading"))}</p>`;
  $("loadMoreLedgerBtn").hidden = true;
  go("ledger");
  try {
    const page = await api.getLedgerPage(0);
    renderLedgerRows($("fullLedger"), page.items);
    ledgerNextOffset = page.nextOffset;
    $("loadMoreLedgerBtn").hidden = ledgerNextOffset == null;
  } catch {
    $("fullLedger").innerHTML = `<p class="ledgerEmpty">${esc(t("common.error"))}</p>`;
  }
}

async function loadMoreLedger() {
  if (ledgerNextOffset == null) return;
  try {
    const page = await api.getLedgerPage(ledgerNextOffset);
    const container = $("fullLedger");
    for (const item of page.items) container.appendChild(ledgerRowEl(item));
    ledgerNextOffset = page.nextOffset;
    $("loadMoreLedgerBtn").hidden = ledgerNextOffset == null;
  } catch {
    // leave the button visible so the user can retap
  }
}

function renderAggregate() {
  const wrap = $("communityGoals");
  wrap.innerHTML = "";
  for (const goal of stats.communityGoals) {
    const pct = Math.max(0, Math.min(100, Math.round((goal.count / goal.goal) * 100)));
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:900;font-size:14px;text-transform:uppercase;letter-spacing:0.02em">${esc(goal.label)}</div>
      <div class="goal"><i style="width:${pct}%"></i></div>
      <div class="mini">${t("aggregate.communityGoalSoFar", { count: goal.count.toLocaleString(), remaining: Math.max(0, goal.goal - goal.count).toLocaleString() })}</div>`;
    wrap.appendChild(card);
  }
}

// ---------------- helpers ----------------
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function tagLabel(key) {
  // `mode` (Withdraw/Substitute/Pressure/Build) is gone: the four buckets never divided the
  // actions cleanly, and the badges keyed on them broke whenever the action list changed.
  // Recurrence and region carry the same weight without the ambiguity.
  const map = {
    Easy: "tag.easy", Moderate: "tag.moderate", Advanced: "tag.advanced",
    global: "tag.global", eu: "tag.europe", us: "tag.usOnly",
    once: "tag.once", sustained: "tag.sustained", repeatable: "tag.repeatable",
  };
  return map[key] ? t(map[key]) : key;
}

/**
 * The suggested targets for an action in the user's locale, falling back to `default`.
 *
 * The UI locale doubles as the country hint -- there is only one language picker, and a German
 * speaker is overwhelmingly likely to want the German bank list. Country-only keys ("at", "ch",
 * "nl") still resolve when the locale matches them exactly.
 */
function targetsFor(action) {
  const targets = action.targets || {};
  return targets[currentLocale()] || targets[currentLocale().split("-")[0]] || targets.default || [];
}

function categoryById(id) {
  return catalog.categories.find((c) => c.id === id);
}
function actionById(id) {
  return catalog.actions.find((a) => a.id === id);
}
function actionsInCategory(id) {
  return catalog.actions.filter((a) => a.categoryId === id);
}
function categoryFraction(categoryId) {
  const actions = actionsInCategory(categoryId);
  const done = actions.filter((a) => stateByActionId.get(a.id)?.status === "claimed").length;
  return { done, total: actions.length };
}

// ---------------- filtering ----------------
function timeBucket(timeEstimate) {
  if (timeEstimate === "5 Minutes") return "5min";
  if (timeEstimate === "10-30 Minutes") return "10-30min";
  if (timeEstimate === "Ongoing") return "ongoing";
  return "1hr+"; // 1-2 Hours, 1 Day, Varies
}

function matchesFilters(action) {
  const q = filters.search.trim().toLowerCase();
  if (q && !`${action.name} ${action.shortDescription}`.toLowerCase().includes(q)) return false;

  if (filters.quick.under5 && action.timeEstimate !== "5 Minutes") return false;
  if (filters.quick.easy && action.effort !== "Easy") return false;
  if (filters.quick.anywhere && action.scopeRegion !== "global") return false;

  const { time, effort, location, status } = filters.sheet;
  if (time.size && !time.has(timeBucket(action.timeEstimate))) return false;
  if (effort.size && !effort.has(action.effort)) return false;
  if (location.size && !location.has(action.scopeRegion)) return false;
  if (status.size) {
    const st = stateByActionId.get(action.id)?.status === "claimed" ? "done" : "not_done";
    if (!status.has(st)) return false;
  }
  return true;
}

function getFilteredActions(categoryId) {
  const pool = categoryId ? actionsInCategory(categoryId) : catalog.actions;
  return pool.filter(matchesFilters).sort((a, b) => a.sortOrder - b.sortOrder);
}

function filtersActive() {
  return (
    filters.search.trim() !== "" ||
    Object.values(filters.quick).some(Boolean) ||
    Object.values(filters.sheet).some((s) => s.size > 0)
  );
}

// ---------------- screens ----------------
const SCREENS = ["home", "explore", "categories", "cat", "detail", "shelf", "shelf-empty", "ledger", "help", "about"];
function go(id) {
  for (const s of SCREENS) $("s-" + s).hidden = s !== id;
  document.querySelectorAll(".nav button[data-nav]").forEach((b) => b.setAttribute("aria-current", "false"));
  const navMap = { home: "home", explore: "explore", categories: "explore", cat: "explore", detail: "explore",
    shelf: "shelf", "shelf-empty": "shelf", ledger: "home", help: "home", about: "home" };
  const navBtn = document.querySelector(`.nav button[data-nav="${navMap[id]}"]`);
  if (navBtn) navBtn.setAttribute("aria-current", "true");
  $("scrollBody").scrollTop = 0;
}

// The action-list screen is reached two ways -- drilling into a category, or tapping a shortcut
// tile -- and it has to know which so Back and post-claim re-renders return to the right place.
let catView = null; // {kind:"category", id} | {kind:"filter", title}

function reopenCatView() {
  if (!catView) return backToExplore();
  if (catView.kind === "category") openCategory(catView.id);
  else openFilteredList(catView.title);
}

function backToExplore() {
  catView = null;
  filters.quick = { under5: false, easy: false, anywhere: false };
  renderExplore();
  go("explore");
}

/** Re-renders whichever action-bearing screen is on top, after a state change. */
function refreshCurrentScreen(actionId) {
  if (!$("s-detail").hidden) openDetail(actionId ?? currentActionId);
  else if (!$("s-cat").hidden) reopenCatView();
  else if (!$("s-categories").hidden) renderCategories();
  else if (!$("s-explore").hidden) renderExplore();
}

/** How many actions someone can have logged and still be shown the starter set. */
const STARTER_VISIBLE_UNTIL = 5;

/**
 * The starter set: ten named, sub-five-minute, globally applicable actions with no research
 * attached, shown to anyone who hasn't got going yet.
 *
 * It disappears once they have a handful logged -- it exists to answer "what do I do first",
 * and once that's answered it is just ten tiles in the way.
 */
function renderStarterSet() {
  const section = $("starterSection");
  const starters = catalog.actions.filter((a) => a.isStarter);
  const done = starters.filter((a) => stateByActionId.get(a.id)?.status === "claimed").length;

  if (!starters.length || totalLoggings() >= STARTER_VISIBLE_UNTIL) {
    section.hidden = true;
    section.innerHTML = "";
    return;
  }

  section.hidden = false;
  section.innerHTML = `<div class="h2" style="margin-top:22px">${esc(t("explore.startHere"))}</div>
    <p class="mini" style="margin-bottom:10px">${esc(t("explore.startHereBlurb", { done, total: starters.length }))}</p>
    <div id="starterList"></div>`;

  const list = $("starterList");
  for (const action of starters) list.appendChild(buildActionCard(action));
}

/** Actions tab: shortcut tiles, swapped for live results while there's a search query. */
function renderExplore() {
  const query = filters.search.trim();
  const results = $("exploreResults");
  const tiles = $("exploreTiles");

  tiles.hidden = !!query;
  results.hidden = !query;
  if (!query) {
    results.innerHTML = "";
    renderStarterSet();
    return;
  }
  $("starterSection").hidden = true;

  const actions = catalog.actions.filter(matchesFilters).sort((a, b) => a.sortOrder - b.sortOrder);
  results.innerHTML = "";
  if (actions.length === 0) {
    results.innerHTML = `<p class="ledgerEmpty">${esc(t("explore.noMatches"))}</p>`;
    return;
  }
  for (const action of actions) results.appendChild(buildActionCard(action));
}

function renderCategories() {
  const listEl = $("categoryList");
  $("categoryCount").textContent = t("categories.count", { count: catalog.categories.length });
  listEl.innerHTML = "";
  for (const cat of catalog.categories) {
    const frac = categoryFraction(cat.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat ${cat.colorKey}`;
    btn.innerHTML = `
      <span class="num">${session.loggedIn ? `${frac.done}<small>${t("categories.fractionOf")} ${frac.total}</small>` : `${frac.total}`}</span>
      <span class="txt"><b>${esc(cat.name)}</b><span>${esc(cat.tagline || cat.shortDescription || "")}</span></span>
      <span class="go">›</span>`;
    btn.addEventListener("click", () => openCategory(cat.id));
    listEl.appendChild(btn);
  }
}

function openCategory(categoryId) {
  currentCategoryId = categoryId;
  catView = { kind: "category", id: categoryId };
  const cat = categoryById(categoryId);
  const actions = getFilteredActions(categoryId);
  const doneCount = actions.filter((a) => stateByActionId.get(a.id)?.status === "claimed").length;

  $("catBackLabel").textContent = t("categories.heading");
  $("catHeading").innerHTML = `${esc(cat.name)} <span class="cnt">${doneCount} ${t("shelf.of")} ${actions.length} ${t("category.done")}</span>`;
  renderCatList(actions);
  go("cat");
}

/** Same action-list screen, filled from the active filters rather than one category. */
function openFilteredList(title) {
  currentCategoryId = null;
  catView = { kind: "filter", title };
  const actions = getFilteredActions(null);

  $("catBackLabel").textContent = t("nav.explore");
  $("catHeading").innerHTML = `${esc(title)} <span class="cnt">${actions.length}</span>`;
  renderCatList(actions);
  go("cat");
}

function renderCatList(actions) {
  const list = $("catActionList");
  list.innerHTML = "";
  if (actions.length === 0) {
    list.innerHTML = `<p class="ledgerEmpty">${esc(t("explore.noMatches"))}</p>`;
    return;
  }
  for (const action of actions) list.appendChild(buildActionCard(action));
}

/** Compact list row -- checkbox, name, chevron. Full detail (description, tags, time estimate,
 *  claim/remove) lives only in openDetail, reached by tapping the row. */
function buildActionCard(action) {
  const state = stateByActionId.get(action.id);
  const done = state?.status === "claimed";

  const row = document.createElement("button");
  row.type = "button";
  row.className = `actrow ${done ? "done" : ""}`;
  row.innerHTML = `
    <span class="box">${done ? "✓" : ""}</span>
    <span class="nm">${esc(action.name)}</span>
    <span class="go">›</span>`;
  row.addEventListener("click", () => openDetail(action.id));
  return row;
}

function openDetail(actionId) {
  currentActionId = actionId;
  const action = catalog.actions.find((a) => a.id === actionId);
  const state = stateByActionId.get(actionId);
  const category = categoryById(action.categoryId);
  const claimed = state?.status === "claimed";
  const repeatable = action.recurrence === "repeatable";

  const tags = [
    action.timeEstimate,
    tagLabel(action.effort),
    tagLabel(action.scopeRegion),
    tagLabel(action.recurrence),
  ];

  const targets = targetsFor(action);
  const targetsHtml = targets.length
    ? `<div class="h2" style="margin-top:18px">${esc(t("detail.tryThese"))}</div>
       <div class="tags" style="margin-top:8px">${targets.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>`
    : "";

  const disclaimerHtml = category?.disclaimer
    ? `<p class="mini" style="margin-top:16px;opacity:0.75">${esc(category.disclaimer)}</p>`
    : "";

  const linksHtml = action.helpfulLinks.length
    ? `<div class="h2" style="margin-top:18px">${esc(t("detail.helpfulLinks"))}</div>
       <p style="font-size:15px;line-height:1.9">${action.helpfulLinks
         .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;font-weight:700">${esc(l.label)} ↗</a>`)
         .join("<br>")}</p>`
    : "";

  // Repeatable actions stay loggable after the first time, so they keep the claim button and
  // show a running count instead of switching to a terminal "logged" row.
  const countHtml =
    repeatable && state?.claimCount
      ? `<p class="mini" style="margin-top:10px">${esc(t("action.loggedTimes", { count: state.claimCount }))}</p>`
      : "";

  const claimBlock =
    claimed && !repeatable
      ? `<div class="doneRow"><span class="doneMark">✓ ${esc(t("action.logged"))}</span>
           <button class="removeLink" type="button" id="detailRemoveBtn">${esc(t("action.remove"))}</button></div>`
      : `<label class="backdateRow" style="display:flex;align-items:center;gap:8px;margin-top:18px;font-size:14px">
           <input type="checkbox" id="detailBackdateChk">
           <span>${esc(t("action.didThisEarlier"))}</span>
         </label>
         <input type="date" id="detailBackdateDate" hidden max="${new Date().toISOString().slice(0, 10)}"
                style="margin-top:8px;width:100%;padding:10px;font:inherit">
         <button class="btn" style="margin-top:12px" type="button" id="detailClaimBtn">${esc(
           repeatable ? t("action.logItAgain") : t("action.iDidThis")
         )}</button>
         ${claimed && repeatable ? `<button class="removeLink" type="button" id="detailRemoveBtn" style="margin-top:10px">${esc(t("action.removeLast"))}</button>` : ""}`;

  $("detailContent").innerHTML = `
    <div class="card">
      <div class="tags" style="margin-bottom:12px">${tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>
      <h3 style="font-size:20px;margin-bottom:10px">${esc(action.name)}</h3>
      <p class="mini" style="margin-bottom:10px">${esc(t("action.pointsWorth", { points: action.points }))}</p>
      <p style="font-size:15px;line-height:1.6;margin-bottom:14px">${esc(action.longDescriptionHtml || action.shortDescription)}</p>
      ${targetsHtml}
      ${linksHtml}
      ${countHtml}
      ${claimBlock}
      ${disclaimerHtml}
    </div>`;

  const removeBtn = $("detailRemoveBtn");
  if (removeBtn) removeBtn.addEventListener("click", () => doWithdraw(actionId));

  const claimBtn = $("detailClaimBtn");
  if (claimBtn) {
    const chk = $("detailBackdateChk");
    const dateInput = $("detailBackdateDate");
    chk.addEventListener("change", () => {
      dateInput.hidden = !chk.checked;
      if (chk.checked) dateInput.focus();
    });
    claimBtn.addEventListener("click", () =>
      doClaim(action, chk.checked && dateInput.value ? dateInput.value : undefined)
    );
  }

  $("detailBackBtn").onclick = reopenCatView;
  go("detail");
}

// ---------------- claim / undo (sign-in required to track) ----------------
async function requireAuthThen(actionId, run) {
  if (!session.loggedIn) {
    pendingAction = actionId;
    openAuth();
    return;
  }
  await run();
}

async function doClaim(action, claimedAt) {
  await requireAuthThen(action.id, async () => {
    // A backdated date arrives as YYYY-MM-DD; send it as midday UTC so a timezone offset
    // can't push it onto the previous day.
    const result = await api.claim(action.id, claimedAt ? `${claimedAt}T12:00:00Z` : undefined);

    if (result?.error === "cooldown_active") {
      showToast(t("action.cooldown", { when: formatCountdown(result.retryAfter) }));
      return;
    }
    if (result?.error) {
      showToast(t("action.claimFailed"));
      return;
    }

    await refreshUserState();
    renderTopbar();
    renderAggregate();

    refreshCurrentScreen(action.id);

    if (result.newBadges?.length || result.levelUp) {
      showBadgePop({
        badges: result.newBadges || [],
        levelUp: result.levelUp,
        receipt: { action: action.name, time: action.timeEstimate },
        shareCard: { kind: "claim", headline: action.name, subline: t("badge.stamp") },
      });
    }
  });
}

/** Withdraws a claim. Available on any claimed action forever, not just the one just logged. */
async function doWithdraw(actionId) {
  await api.undoClaim(actionId);
  await refreshUserState();
  renderTopbar();
  refreshHome();
  refreshCurrentScreen(actionId);
}

// ---------------- toast ----------------
function showToast(msg) {
  $("toastMsg").textContent = msg;
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  $("toast").classList.remove("on");
  clearTimeout(toastTimer);
}

// ---------------- badge popup ----------------
function shareButtons() {
  const targets = [
    ["instagram", "📷", "share.instagram"],
    ["tiktok", "🎵", "share.tiktok"],
    ["bluesky", "🦋", "share.bluesky"],
    ["whatsapp", "💬", "share.whatsapp"],
    ["more", "📤", "share.more"],
    ["copy", "🔗", "share.copyLink"],
  ];
  return targets
    .map(([id, icon, key]) => `<button type="button" data-share="${id}"><span class="ic">${icon}</span>${esc(t(key))}</button>`)
    .join("");
}

async function showBadgePop({ badges, levelUp, receipt, shareCard }) {
  const first = badges[0];
  $("popStamp").textContent = t("badge.stamp");
  if (first) {
    $("popTitle").innerHTML = `${esc(t("badge.unlocked"))}<br>${first.icon} ${esc(first.name)}`;
    $("popBody").textContent = badges.length > 1 ? `+${badges.length - 1} more` : "";
  } else if (levelUp) {
    $("popTitle").innerHTML = `${esc(t("badge.levelUp"))}<br>Lv${levelUp.level} ${esc(levelUp.name)}`;
    $("popBody").textContent = "";
  }

  $("popReceipt").innerHTML = `
    <div class="r"><span>${esc(t("nav.explore"))}</span><b>${esc(receipt.action)}</b></div>
    <div class="r"><span>${esc(t("filters.time"))}</span><b>${esc(receipt.time)}</b></div>`;

  $("popShares").innerHTML = shareButtons();
  let shareUrl = null;
  try {
    const created = await api.createShare(shareCard);
    shareUrl = created.url;
  } catch {
    shareUrl = null;
  }
  $("popShares").querySelectorAll("[data-share]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!shareUrl) return;
      const kind = btn.dataset.share;
      if (kind === "more" && navigator.share) {
        navigator.share({ title: shareCard.headline, url: shareUrl }).catch(() => {});
      } else if (kind === "copy") {
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
        showToast(t("share.copied"));
      } else {
        const urls = {
          whatsapp: `https://wa.me/?text=${encodeURIComponent(shareUrl)}`,
          bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(shareUrl)}`,
        };
        if (urls[kind]) window.open(urls[kind], "_blank", "noopener,noreferrer");
        else {
          await navigator.clipboard.writeText(shareUrl).catch(() => {});
          showToast(t("share.copied"));
        }
      }
    });
  });

  $("badgePop").classList.add("on");
}

// ---------------- achievements (shelf) ----------------
function renderShelf() {
  if (!session.loggedIn) {
    go("shelf-empty");
    return;
  }

  const badgeGrid = $("badgeGrid");
  badgeGrid.innerHTML = "";

  // A chain is one entry showing its highest unlocked tier, not four separate ones -- 12 chains
  // read as 12 things to collect rather than 48 near-identical tiles.
  const chainsDone = userChains.filter((c) => c.currentTier > 0).length;
  const badgesDone = catalog.badges.filter((b) => earnedBadgeIds.has(b.id)).length;
  const total = catalog.badges.length + (catalog.chains?.length || 0);
  $("shelfCount").textContent = `${badgesDone + chainsDone} ${t("shelf.of")} ${total}`;

  for (const chain of catalog.chains || []) {
    const progress = userChains.find((c) => c.id === chain.id);
    const value = progress?.value ?? 0;
    const currentTier = progress?.currentTier ?? 0;
    const nextTier = chain.tiers.find((tt) => value < tt.threshold) ?? null;

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `badge ${currentTier > 0 ? "" : "locked"}`;

    const pct = nextTier
      ? Math.max(0, Math.min(100, Math.round((value / nextTier.threshold) * 100)))
      : 100;
    const statusHtml = nextTier
      ? `<div class="minibar"><i style="width:${pct}%"></i></div><div class="st">${value}/${nextTier.threshold}</div>`
      : `<div class="st">${esc(t("badge.chainComplete"))}</div>`;

    const name = currentTier > 0 ? progress.currentTierName : chain.name;
    tile.innerHTML = `<div class="ico">${chain.icon}</div>
      <div class="nm">${esc(name)}</div>
      ${currentTier > 0 ? `<div class="st">${esc(t("badge.tier", { tier: tierNumeral(currentTier) }))}</div>` : ""}
      ${statusHtml}`;
    tile.addEventListener("click", () => openChainSheet(chain, progress));
    badgeGrid.appendChild(tile);
  }

  for (const badge of catalog.badges) {
    const unlocked = earnedBadgeIds.has(badge.id);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `badge ${unlocked ? "" : "locked"}`;

    let statusHtml = `<div class="st">${esc(t("badge.locked"))}</div>`;
    if (unlocked) {
      statusHtml = rarityHtml(badge.id);
    } else if (badge.kind === "milestone" && badge.threshold) {
      const count = totalLoggings();
      const pct = Math.max(0, Math.min(100, Math.round((count / badge.threshold) * 100)));
      statusHtml = `<div class="minibar"><i style="width:${pct}%"></i></div><div class="st">${count}/${badge.threshold}</div>`;
    } else if (badge.kind === "time_served") {
      const due = nextCheckinDueDate();
      if (due) statusHtml = `<div class="st">${esc(t("badge.checkinDue", { when: formatCountdown(due) }))}</div>`;
    }

    tile.innerHTML = `<div class="ico">${badge.icon}</div><div class="nm">${esc(badge.name)}</div>${statusHtml}`;
    tile.addEventListener("click", () => openBadgeSheet(badge));
    badgeGrid.appendChild(tile);
  }

  renderCheckins();
  go("shelf");
}

/** Tier numerals. Four tiers only, so a lookup beats a general Roman-numeral routine. */
const TIER_NUMERALS = ["", "I", "II", "III", "IV"];
const tierNumeral = (tier) => TIER_NUMERALS[tier] ?? String(tier);

/** "Held by 3% of members" -- only shown once there are enough members for it to mean anything. */
function rarityHtml(badgeId) {
  const pct = badgeRarity.get(badgeId);
  if (pct == null || pct <= 0) return "";
  const label = pct < 1 ? "<1" : String(Math.round(pct));
  return `<div class="st">${esc(t("badge.rarity", { pct: label }))}</div>`;
}

/** Total loggings, counting each repeat of a repeatable action -- matches the server's tally. */
function totalLoggings() {
  return claimedEntries().reduce((n, [, s]) => n + Math.max(1, s.claimCount || 0), 0);
}

/** [actionId, state] pairs for the signed-in user's currently claimed actions. */
function claimedEntries() {
  return [...stateByActionId.entries()].filter(([, s]) => s.status === "claimed");
}

/**
 * The soonest upcoming check-in among claimed actions, if any. Time-served badges are milestone
 * awards (Still Going / The Long Haul fire once, on whichever action reaches 3 or 6 months first),
 * so this is deliberately not attributed to one specific badge -- it is the honest answer to "when
 * is my next check-in", not a claim about which badge it will unlock.
 */
function nextCheckinDueDate() {
  const dueDates = claimedEntries()
    .map(([, s]) => s.nextCheckinDue)
    .filter(Boolean)
    .sort();
  return dueDates[0] || null;
}

function formatCountdown(iso) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return days <= 0 ? t("badge.dueNow") : t("badge.dueInDays", { count: days });
}

/** Human description of what a badge takes to earn, phrased tense-neutrally so it reads fine both
 *  locked ("takes 6 actions") and unlocked (as a record of what was done). */
function badgeRequirementText(badge) {
  if (badge.kind === "one_shot") {
    const action = actionById(badge.actionId);
    return t("badge.reqOneShot", { action: action ? action.name : "" });
  }
  if (badge.kind === "time_served") {
    return badge.scope === "checkin:6mo" ? t("badge.reqTimeServed6mo") : t("badge.reqTimeServed3mo");
  }
  if (badge.kind === "milestone") {
    return t("badge.reqCounterTotal", { count: badge.threshold });
  }
  // Meta badges each describe their own rule; the copy lives with the badge rather than being
  // reconstructed from a scope string here.
  return badge.description || "";
}

function openBadgeSheet(badge) {
  const unlocked = earnedBadgeIds.has(badge.id);
  $("badgeSheetName").textContent = badge.name;
  $("badgeSheetIcon").textContent = badge.icon;
  $("badgeSheetReq").textContent = badgeRequirementText(badge);

  const actionBtn = $("badgeSheetActionBtn");
  actionBtn.hidden = true;
  const progress = $("badgeSheetProgress");
  progress.innerHTML = "";

  const statusEl = $("badgeSheetStatus");
  if (unlocked) {
    const earnedAt = earnedBadgeDates.get(badge.id);
    statusEl.textContent = earnedAt ? t("badge.unlockedAgo", { time: formatRelativeTime(earnedAt) }) : t("badge.detailUnlocked");
    statusEl.className = "badgeStatus unlocked";
    const pct = badgeRarity.get(badge.id);
    if (pct != null && pct > 0) {
      progress.innerHTML = `<p class="mini">${esc(t("badge.rarityLong", { pct: pct < 1 ? "<1" : String(Math.round(pct)) }))}</p>`;
    }
  } else {
    statusEl.textContent = t("badge.locked");
    statusEl.className = "badgeStatus";

    if (badge.kind === "milestone" && badge.threshold) {
      const count = totalLoggings();
      const pct = Math.max(0, Math.min(100, Math.round((count / badge.threshold) * 100)));
      progress.innerHTML = `<div class="segbar" style="margin:10px 0 6px"><i style="width:${pct}%"></i></div>
        <p class="mini">${esc(t("badge.progressLabel", { count, threshold: badge.threshold }))}</p>`;
    } else if (badge.kind === "time_served") {
      const due = nextCheckinDueDate();
      progress.innerHTML = due
        ? `<p class="mini">${esc(t("badge.timeServedHintPending", { when: formatCountdown(due) }))}</p>`
        : `<p class="prose">${esc(t("badge.timeServedHintNone"))}</p>`;
    } else if (badge.kind === "one_shot") {
      const action = actionById(badge.actionId);
      if (action) {
        actionBtn.hidden = false;
        actionBtn.textContent = t("badge.viewAction");
        actionBtn.onclick = () => {
          closeBadgeSheet();
          openDetail(action.id);
        };
      }
    }
  }

  $("badgeSheet").classList.add("on");
}
function closeBadgeSheet() {
  $("badgeSheet").classList.remove("on");
}

/**
 * Chain detail: the full four-tier ladder with the current count against each threshold.
 *
 * Showing every tier at once is the point of the chain -- unlike the old category badges, the
 * next target is visible and doesn't move when the action list changes.
 */
function openChainSheet(chain, progress) {
  const value = progress?.value ?? 0;
  const currentTier = progress?.currentTier ?? 0;

  $("badgeSheetName").textContent = currentTier > 0 ? progress.currentTierName : chain.name;
  $("badgeSheetIcon").textContent = chain.icon;
  $("badgeSheetReq").textContent = chain.description || "";
  $("badgeSheetActionBtn").hidden = true;

  const statusEl = $("badgeSheetStatus");
  if (currentTier > 0) {
    const earnedAt = progress.earnedAt;
    statusEl.textContent = earnedAt
      ? t("badge.unlockedAgo", { time: formatRelativeTime(earnedAt) })
      : t("badge.detailUnlocked");
    statusEl.className = "badgeStatus unlocked";
  } else {
    statusEl.textContent = t("badge.locked");
    statusEl.className = "badgeStatus";
  }

  const rows = chain.tiers
    .map((tier) => {
      const done = value >= tier.threshold;
      const pct = Math.max(0, Math.min(100, Math.round((value / tier.threshold) * 100)));
      const rarity = badgeRarity.get(tier.id);
      const rarityText =
        done && rarity != null && rarity > 0
          ? t("badge.rarity", { pct: rarity < 1 ? "<1" : String(Math.round(rarity)) })
          : "";
      return `<div style="margin:12px 0">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;font-weight:700">
          <span>${done ? "✓" : "○"} ${esc(tierNumeral(tier.tier))} · ${esc(tier.name)}</span>
          <span style="opacity:0.7">${Math.min(value, tier.threshold)}/${tier.threshold}</span>
        </div>
        <div class="segbar" style="margin-top:6px"><i style="width:${pct}%"></i></div>
        ${rarityText ? `<p class="mini" style="margin-top:4px">${esc(rarityText)}</p>` : ""}
      </div>`;
    })
    .join("");

  $("badgeSheetProgress").innerHTML = rows;
  $("badgeSheet").classList.add("on");
}

/**
 * Due check-ins on sustained actions.
 *
 * Months are banked, not streaked -- "I stopped" credits the time already served and restarts
 * the clock rather than zeroing the total, so the copy here has to say that. Telling someone
 * who held a bank switch for five months that they are back to nothing is both wrong and the
 * fastest way to make them stop answering.
 */
async function renderCheckins() {
  const due = (await api.dueCheckins()).map((d) => ({
    actionId: d.state.actionId,
    action: d.action,
    monthsBanked: d.state.monthsBanked ?? 0,
  }));

  const section = $("checkinsSection");
  section.innerHTML = "";
  if (due.length === 0) return;

  const heading = document.createElement("div");
  heading.className = "h2";
  heading.textContent = t("shelf.checkinsHeading");
  section.appendChild(heading);

  for (const item of due) {
    if (!item.action) continue;
    const card = document.createElement("div");
    card.className = "card";
    card.style.background = "var(--cream)";
    card.innerHTML = `
      <h3 style="font-weight:900;font-size:16px;margin-bottom:6px">${esc(item.action.name)}</h3>
      <p style="font-size:14px;font-weight:600;margin-bottom:4px">${esc(t("shelf.stillHolding"))}</p>
      ${item.monthsBanked > 0 ? `<p class="mini" style="margin-bottom:12px">${esc(t("shelf.monthsBanked", { count: item.monthsBanked }))}</p>` : `<div style="height:8px"></div>`}
      <div style="display:flex;gap:10px">
        <button class="btn sm" type="button" data-role="still">${esc(t("shelf.stillOffIt"))}</button>
        <button class="btn sm ghost" type="button" data-role="back">${esc(t("shelf.wentBack"))}</button>
      </div>`;

    const answer = async (result) => {
      const resp = await api.checkin(item.actionId, result);
      await refreshUserState();
      if (result === "went_back") {
        const banked = resp?.state?.monthsBanked ?? item.monthsBanked;
        card.innerHTML = `<p style="font-size:14px;font-weight:700">${esc(t("shelf.wentBackLogged"))}</p>
          ${banked > 0 ? `<p class="mini" style="margin-top:6px">${esc(t("shelf.wentBackBanked", { count: banked }))}</p>` : ""}`;
        return;
      }
      renderShelf();
      if (resp?.newBadges?.length) {
        showBadgePop({
          badges: resp.newBadges,
          levelUp: null,
          receipt: { action: item.action.name, time: item.action.timeEstimate },
          shareCard: { kind: "badge", headline: resp.newBadges[0].name, subline: t("badge.unlocked") },
        });
      }
    };

    card.querySelector('[data-role="still"]').addEventListener("click", () => answer("holding"));
    card.querySelector('[data-role="back"]').addEventListener("click", () => answer("went_back"));
    section.appendChild(card);
  }
}

// ---------------- account sheet ----------------
function openAccountSheet() {
  $("accountSheet").classList.add("on");
}
function closeAccountSheet() {
  $("accountSheet").classList.remove("on");
}

async function handleLogout() {
  closeAccountSheet();
  await api.logout();
  session = { loggedIn: false, email: null };
  await refreshUserState();
  renderTopbar();
  renderExplore();
  go("home");
  refreshHome();
}

async function handleExportData() {
  const data = await api.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "dollarsout-export.json";
  a.click();
}

async function handleDeleteAccount() {
  if (!confirm(t("account.deleteConfirm"))) return;
  await api.deleteAccount();
  closeAccountSheet();
  session = { loggedIn: false, email: null };
  await refreshUserState();
  renderTopbar();
  go("home");
  refreshHome();
}

// ---------------- actions-screen tiles ----------------
/** Each shortcut tile applies exactly one quick filter and opens the matching list. */
const TILE_FILTERS = { under5: "home.under5min", easy: "home.easyOnly", anywhere: "home.anywhere" };

function handleTile(kind) {
  if (kind === "all") {
    renderCategories();
    go("categories");
    return;
  }
  if (kind === "surprise") {
    const undone = catalog.actions.filter((a) => stateByActionId.get(a.id)?.status !== "claimed");
    const pool = undone.length ? undone : catalog.actions;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) openDetail(pick.id);
    return;
  }
  filters.quick = { under5: false, easy: false, anywhere: false };
  filters.quick[kind] = true;
  openFilteredList(t(TILE_FILTERS[kind]));
}

// ---------------- settings sheet ----------------
function openSettingsSheet() {
  $("settingsLanguageValue").textContent = LOCALE_NAMES[currentLocale()] || currentLocale();
  $("settingsSheet").classList.add("on");
}
function closeSettingsSheet() {
  $("settingsSheet").classList.remove("on");
}

// ---------------- language sheet ----------------
const LOCALE_NAMES = { en: "English", de: "Deutsch", es: "Español", fr: "Français" };

function openLanguageSheet() {
  const wrap = $("languageOptions");
  wrap.innerHTML = "";
  for (const loc of LOCALES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "langOption";
    btn.setAttribute("aria-pressed", loc === currentLocale() ? "true" : "false");
    btn.textContent = LOCALE_NAMES[loc];
    btn.addEventListener("click", () => selectLocale(loc));
    wrap.appendChild(btn);
  }
  $("languageSheet").classList.add("on");
}
function closeLanguageSheet() {
  $("languageSheet").classList.remove("on");
}

async function selectLocale(loc) {
  closeLanguageSheet();
  if (loc === currentLocale()) return;
  localStorage.setItem("dollarsout:locale", loc);
  await loadLocale(loc);
  renderTopbar();
  renderMeter();
  renderAggregate();
  refreshRecentLedger();
  if (!$("s-explore").hidden) renderExplore();
  if (!$("s-categories").hidden) renderCategories();
  if (!$("s-cat").hidden) reopenCatView();
  if (!$("s-shelf").hidden) renderShelf();
}

// ---------------- auth (OTP + Turnstile) ----------------
function loadTurnstileScript() {
  if (window.turnstile || document.getElementById("turnstileScript")) return;
  const s = document.createElement("script");
  s.id = "turnstileScript";
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  s.async = true;
  document.head.appendChild(s);
}

function renderTurnstile(step) {
  loadTurnstileScript();
  const el = $(`turnstileWidget${step}`);
  const tryRender = () => {
    if (turnstileRendered[step]) return;
    if (!window.turnstile) return setTimeout(tryRender, 200);
    window.turnstile.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => (el.dataset.token = token),
    });
    turnstileRendered[step] = true;
  };
  tryRender();
}

function openAuth() {
  $("authSheet").classList.add("on");
  showAuthStep(1);
  renderTurnstile(1);
}
function closeAuth() {
  $("authSheet").classList.remove("on");
}
function showAuthStep(n) {
  $("authStep1").classList.toggle("on", n === 1);
  $("authStep2").classList.toggle("on", n === 2);
  if (n === 2) renderTurnstile(2);
}

async function handleSendCode() {
  const email = $("authEmail").value.trim();
  const token = $("turnstileWidget1").dataset.token;
  $("authError1").textContent = "";
  if (!email) {
    $("authError1").textContent = t("common.error");
    return;
  }
  const messages = {
    invalid_email: "auth.errInvalidEmail",
    disposable_email: "auth.errDisposableEmail",
    rate_limited: "auth.errRateLimited",
    email_not_configured: "auth.errEmailDown",
    email_send_failed: "auth.errEmailDown",
  };
  try {
    const result = await api.requestCode(email, token);
    if (!result.ok) throw new Error(result.error || "failed");
    showAuthStep(2);
  } catch (err) {
    $("authError1").textContent = t(messages[err?.message] || "common.error");
  }
}

async function handleConfirmCode() {
  const email = $("authEmail").value.trim();
  const code = [...$("otpBoxes").querySelectorAll("input")].map((i) => i.value).join("");
  const token = $("turnstileWidget2").dataset.token;
  $("authError2").textContent = "";
  try {
    const result = await api.verifyCode(email, code, token);
    if (!result.ok) throw new Error(result.error || "failed");
    closeAuth();
    session = await api.getSession();
    await refreshUserState();
    renderTopbar();

    if (pendingAction) {
      const actionId = pendingAction;
      pendingAction = null;
      const action = catalog.actions.find((a) => a.id === actionId);
      if (action) await doClaim(action);
    } else {
      renderExplore();
      renderAggregate();
      showToast(t("auth.syncedToast"));
    }
  } catch {
    $("authError2").textContent = t("common.error");
  }
}

// ---------------- filter sheet ----------------
function buildFilterChips(containerId, options, group) {
  const el = $(containerId);
  el.innerHTML = "";
  for (const [value, key] of options) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = t(key);
    chip.setAttribute("aria-pressed", filters.sheet[group].has(value) ? "true" : "false");
    chip.addEventListener("click", () => {
      if (filters.sheet[group].has(value)) filters.sheet[group].delete(value);
      else filters.sheet[group].add(value);
      chip.setAttribute("aria-pressed", filters.sheet[group].has(value) ? "true" : "false");
    });
    el.appendChild(chip);
  }
}

function openFilters() {
  buildFilterChips("filterTime", [
    ["5min", "filters.time5min"],
    ["10-30min", "filters.time1030min"],
    ["1hr+", "filters.time1hrplus"],
    ["ongoing", "filters.timeOngoing"],
  ], "time");

  buildFilterChips("filterEffort", [["Easy", "tag.easy"], ["Moderate", "tag.moderate"], ["Advanced", "tag.advanced"]], "effort");
  buildFilterChips("filterLocation", [["global", "tag.global"], ["eu", "tag.europe"], ["us", "tag.usOnly"]], "location");
  buildFilterChips("filterStatus", [["not_done", "filters.statusNotDone"], ["done", "filters.statusDone"]], "status");
  $("filterSheet").classList.add("on");
}
function closeFilters() {
  $("filterSheet").classList.remove("on");
}
function applyFiltersAndClose() {
  closeFilters();
  // From a category or an existing result list, re-filter in place; from the tile screen, the
  // filters have nothing to narrow yet, so open a result list for them.
  if (!$("s-cat").hidden) reopenCatView();
  else if (filtersActive()) openFilteredList(t("explore.filtered"));
  else renderExplore();
}

function closeBadgePop() {
  $("badgePop").classList.remove("on");
}

/**
 * Dismisses an overlay when the dimmed backdrop behind the card is clicked.
 *
 * `.sheet` / `.pop` are the full-screen dimmed layer and the card is a child, so "clicked the
 * backdrop" is exactly "the event target is the overlay itself" -- anything inside the card has
 * that element as its target instead.
 *
 * The pointerdown check exists because a plain click fires on the nearest common ancestor of
 * press and release: pressing inside the card and releasing outside it (selecting text, or a
 * slightly draggy tap) reports the overlay as the target and would otherwise dismiss the sheet
 * out from under someone mid-interaction. Requiring the press to have started on the backdrop too
 * means only a genuine backdrop tap closes it.
 */
function wireBackdropDismiss(overlayId, close) {
  const overlay = $(overlayId);
  let pressedBackdrop = false;
  overlay.addEventListener("pointerdown", (e) => {
    pressedBackdrop = e.target === overlay;
  });
  overlay.addEventListener("click", (e) => {
    if (pressedBackdrop && e.target === overlay) close();
    pressedBackdrop = false;
  });
}

// ---------------- static wiring ----------------
function wireStaticEvents() {
  document.querySelectorAll(".nav button[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dest = btn.dataset.nav;
      if (dest === "home") { go("home"); refreshHome(); }
      else if (dest === "explore") backToExplore();
      else if (dest === "shelf") renderShelf();
    });
  });

  $("authPill").addEventListener("click", () => {
    if (session.loggedIn) openAccountSheet();
    else openAuth();
  });
  $("shelfSaveBtn").addEventListener("click", () => openAuth());
  $("closeAccountBtn").addEventListener("click", closeAccountSheet);
  $("logoutBtn").addEventListener("click", handleLogout);
  $("exportDataBtn").addEventListener("click", handleExportData);
  $("deleteAccountBtn").addEventListener("click", handleDeleteAccount);
  $("closeAuthBtn").addEventListener("click", closeAuth);
  $("sendCodeBtn").addEventListener("click", handleSendCode);
  $("confirmCodeBtn").addEventListener("click", handleConfirmCode);
  $("resendBtn").addEventListener("click", handleSendCode);

  $("otpBoxes").querySelectorAll("input").forEach((input, idx, all) => {
    input.addEventListener("input", () => {
      if (input.value && idx < all.length - 1) all[idx + 1].focus();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && idx > 0) all[idx - 1].focus();
    });
  });

  $("catBackBtn").addEventListener("click", () => {
    if (catView?.kind === "category") { renderCategories(); go("categories"); }
    else backToExplore();
  });
  $("categoriesBackBtn").addEventListener("click", backToExplore);
  $("popCloseBtn").addEventListener("click", closeBadgePop);

  // Every dimmed overlay dismisses on a backdrop tap, same as its X / Close button.
  wireBackdropDismiss("badgePop", closeBadgePop);
  wireBackdropDismiss("filterSheet", closeFilters);
  wireBackdropDismiss("authSheet", closeAuth);
  wireBackdropDismiss("accountSheet", closeAccountSheet);
  wireBackdropDismiss("settingsSheet", closeSettingsSheet);
  wireBackdropDismiss("languageSheet", closeLanguageSheet);
  wireBackdropDismiss("badgeSheet", closeBadgeSheet);

  $("openFiltersBtn").addEventListener("click", openFilters);
  $("closeFiltersBtn").addEventListener("click", closeFilters);
  $("showResultsBtn").addEventListener("click", applyFiltersAndClose);

  $("searchInput").addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderExplore();
  });
  $("exploreTiles").querySelectorAll("[data-tile]").forEach((tile) => {
    tile.addEventListener("click", () => handleTile(tile.dataset.tile));
  });

  $("settingsBtn").addEventListener("click", openSettingsSheet);
  $("closeSettingsBtn").addEventListener("click", closeSettingsSheet);
  $("settingsLanguageBtn").addEventListener("click", () => { closeSettingsSheet(); openLanguageSheet(); });
  $("settingsHelpBtn").addEventListener("click", () => { closeSettingsSheet(); go("help"); });
  $("settingsAboutBtn").addEventListener("click", () => { closeSettingsSheet(); go("about"); });
  $("helpBackBtn").addEventListener("click", openSettingsSheet);
  $("aboutBackBtn").addEventListener("click", openSettingsSheet);
  $("closeLanguageBtn").addEventListener("click", closeLanguageSheet);
  $("closeBadgeSheetBtn").addEventListener("click", closeBadgeSheet);

  $("goActionsBtn").addEventListener("click", backToExplore);
  $("seeAllLedgerBtn").addEventListener("click", openLedgerPage);
  $("ledgerBackBtn").addEventListener("click", () => { go("home"); refreshHome(); });
  $("loadMoreLedgerBtn").addEventListener("click", loadMoreLedger);

  wireSwipeNav();
}

// ---------------- swipe navigation ----------------
const PANEL_ORDER = ["home", "explore", "shelf"];
let touchStart = null;

function currentScreenId() {
  const el = document.querySelector(".screen:not([hidden])");
  return el ? el.id.slice(2) : null; // strip "s-" prefix
}

function wireSwipeNav() {
  const body = $("scrollBody");
  body.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    },
    { passive: true }
  );

  body.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      const dt = Date.now() - touchStart.time;
      touchStart = null;
      if (dt > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      const screen = currentScreenId();
      const backBtns = { cat: "catBackBtn", categories: "categoriesBackBtn", detail: "detailBackBtn",
        ledger: "ledgerBackBtn", help: "helpBackBtn", about: "aboutBackBtn" };
      if (backBtns[screen]) {
        if (dx > 0) $(backBtns[screen]).click();
        return;
      }

      const panelScreen = screen === "shelf-empty" ? "shelf" : screen;
      const idx = PANEL_ORDER.indexOf(panelScreen);
      if (idx === -1) return;
      const nextIdx = dx < 0 ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= PANEL_ORDER.length) return;
      const navBtn = document.querySelector(`.nav button[data-nav="${PANEL_ORDER[nextIdx]}"]`);
      if (navBtn) navBtn.click();
    },
    { passive: true }
  );
}

boot();
