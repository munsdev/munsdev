import { t, loadLocale, detectPreferredLocale, currentLocale } from "./i18n.js";
import { api } from "./api.js";
import { TURNSTILE_SITE_KEY } from "./config.js";
import { LEVEL_LADDER, computeLevel } from "./state.js";

// ---------------- module state ----------------
let catalog = { categories: [], actions: [], badges: [] };
let stats = { period: null, peopleVerified: 0, communityGoals: [] };
let session = { loggedIn: false, email: null };
let stateByActionId = new Map(); // actionId -> {status, nextCheckinDue, ...} -- empty when signed out
let earnedBadgeIds = new Set();
let earnedBadgeDates = new Map(); // badgeId -> earnedAt, for the achievement detail sheet
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
    catalog = { categories: [], actions: [], badges: [] };
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

async function refreshUserState() {
  if (!session.loggedIn) {
    stateByActionId = new Map();
    earnedBadgeIds = new Set();
    earnedBadgeDates = new Map();
    return;
  }
  try {
    const me = await api.me();
    stateByActionId = new Map(me.states.claimed.map((s) => [s.actionId, s]));
    for (const actionId of me.states.na) stateByActionId.set(actionId, { status: "na" });
    earnedBadgeIds = new Set(me.badges.map((b) => b.id));
    earnedBadgeDates = new Map(me.badges.map((b) => [b.id, b.earnedAt]));
  } catch {
    stateByActionId = new Map();
    earnedBadgeIds = new Set();
    earnedBadgeDates = new Map();
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

  const totalClaimed = [...stateByActionId.values()].filter((s) => s.status === "claimed").length;
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
  const map = { Withdraw: "tag.withdraw", Substitute: "tag.substitute", Pressure: "tag.pressure", Build: "tag.build",
    Easy: "tag.easy", Moderate: "tag.moderate", Advanced: "tag.advanced",
    Anywhere: "tag.anywhere", "Outside US": "tag.outsideUs", "US only": "tag.usOnly" };
  return map[key] ? t(map[key]) : key;
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
  if (filters.quick.anywhere && action.availability !== "Anywhere") return false;

  const { time, effort, location, status } = filters.sheet;
  if (time.size && !time.has(timeBucket(action.timeEstimate))) return false;
  if (effort.size && !effort.has(action.effort)) return false;
  if (location.size && !location.has(action.availability)) return false;
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

/** Actions tab: shortcut tiles, swapped for live results while there's a search query. */
function renderExplore() {
  const query = filters.search.trim();
  const results = $("exploreResults");
  const tiles = $("exploreTiles");

  tiles.hidden = !!query;
  results.hidden = !query;
  if (!query) {
    results.innerHTML = "";
    return;
  }

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

function buildActionCard(action) {
  const state = stateByActionId.get(action.id);
  const card = document.createElement("div");
  card.className = "card";

  const done = state?.status === "claimed";
  const tags = [tagLabel(action.mode), `${action.timeEstimate}`, tagLabel(action.effort), tagLabel(action.availability)];

  card.innerHTML = `<div class="act ${done ? "done" : ""}"><span class="box">${done ? "✓" : ""}</span><div style="flex:1">
      <h3><button class="actTitle" type="button">${esc(action.name)}</button></h3>
      <p>${esc(action.shortDescription)}</p>
      <div class="tags">${tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>
      ${done
        ? `<button class="removeLink" type="button" data-role="remove">${esc(t("action.remove"))}</button>`
        : `<button class="btn sm" style="margin-top:12px" type="button" data-role="idid">${esc(t("action.iDidThis"))}</button>`}
    </div></div>`;

  card.querySelector(".actTitle").addEventListener("click", () => openDetail(action.id));
  card.querySelector(done ? '[data-role="remove"]' : '[data-role="idid"]')
    .addEventListener("click", () => (done ? doWithdraw(action.id) : doClaim(action)));
  return card;
}

function openDetail(actionId) {
  currentActionId = actionId;
  const action = catalog.actions.find((a) => a.id === actionId);
  const state = stateByActionId.get(actionId);
  const tags = [tagLabel(action.mode), action.timeEstimate, tagLabel(action.effort), tagLabel(action.availability)];

  $("detailContent").innerHTML = `
    <div class="card">
      <div class="tags" style="margin-bottom:12px">${tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>
      <h3 style="font-size:20px;margin-bottom:10px">${esc(action.name)}</h3>
      <p style="font-size:15px;line-height:1.6;margin-bottom:14px">${esc(action.longDescriptionHtml || action.shortDescription)}</p>
      ${action.helpfulLinks.length ? `<div class="h2" style="margin-top:18px">${esc(t("detail.helpfulLinks"))}</div>
      <p style="font-size:15px;line-height:1.9">${action.helpfulLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="text-decoration:underline;font-weight:700">${esc(l.label)} →</a>`).join("<br>")}</p>` : ""}
      ${state?.status === "claimed"
        ? `<div class="doneRow"><span class="doneMark">✓ ${esc(t("action.logged"))}</span>
             <button class="removeLink" type="button" id="detailRemoveBtn">${esc(t("action.remove"))}</button></div>`
        : `<button class="btn" style="margin-top:18px" type="button" id="detailClaimBtn">${esc(t("action.iDidThis"))}</button>`}
    </div>`;

  if (state?.status === "claimed") {
    $("detailRemoveBtn").addEventListener("click", () => doWithdraw(actionId));
  } else {
    $("detailClaimBtn").addEventListener("click", () => doClaim(action));
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

async function doClaim(action) {
  await requireAuthThen(action.id, async () => {
    const result = await api.claim(action.id);
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
        if (urls[kind]) window.open(urls[kind], "_blank", "noopener");
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
  $("shelfCount").textContent = `${earnedBadgeIds.size} ${t("shelf.of")} ${catalog.badges.length}`;

  for (const badge of catalog.badges) {
    const unlocked = earnedBadgeIds.has(badge.id);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `badge ${unlocked ? "" : "locked"}`;

    let statusHtml = `<div class="st">${esc(t("badge.locked"))}</div>`;
    if (!unlocked && badge.kind === "counter") {
      const count = badgeCounterCount(badge.scope || "");
      const pct = Math.max(0, Math.min(100, Math.round((count / badge.threshold) * 100)));
      statusHtml = `<div class="minibar"><i style="width:${pct}%"></i></div><div class="st">${count}/${badge.threshold}</div>`;
    } else if (!unlocked && badge.kind === "time_served") {
      const due = nextCheckinDueDate();
      if (due) statusHtml = `<div class="st">${esc(t("badge.checkinDue", { when: formatCountdown(due) }))}</div>`;
    } else if (unlocked) {
      statusHtml = "";
    }

    tile.innerHTML = `<div class="ico">${badge.icon}</div><div class="nm">${esc(badge.name)}</div>${statusHtml}`;
    tile.addEventListener("click", () => openBadgeSheet(badge));
    badgeGrid.appendChild(tile);
  }

  renderCheckins();
  go("shelf");
}

/** [actionId, state] pairs for the signed-in user's currently claimed actions. */
function claimedEntries() {
  return [...stateByActionId.entries()].filter(([, s]) => s.status === "claimed");
}

/** How far a counter badge's progress toward its threshold currently stands. */
function badgeCounterCount(scope) {
  const claimed = claimedEntries();
  if (scope === "total") return claimed.length;
  // Long Haul x3: actions that have reached the terminal 6-month check-in and are still holding.
  if (scope === "checkin:6mo") {
    return claimed.filter(([, s]) => s.lastCheckinResult === "holding" && s.nextCheckinDue === null).length;
  }
  if (scope.startsWith("category:") && scope.includes(":mode:")) {
    const [, categoryId, , mode] = scope.split(":");
    return claimed.filter(([id]) => actionById(id)?.categoryId === categoryId && actionById(id)?.mode === mode).length;
  }
  if (scope.startsWith("category:")) {
    const categoryId = scope.split(":")[1];
    return claimed.filter(([id]) => actionById(id)?.categoryId === categoryId).length;
  }
  if (scope.startsWith("mode:")) {
    const mode = scope.split(":")[1];
    return claimed.filter(([id]) => actionById(id)?.mode === mode).length;
  }
  return 0;
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
  const scope = badge.scope || "";
  const count = badge.threshold;
  if (scope === "total") return t("badge.reqCounterTotal", { count });
  if (scope === "checkin:6mo") return t("badge.reqCounterCheckin6mo", { count });
  if (scope.startsWith("category:") && scope.includes(":mode:")) {
    const [, categoryId, , mode] = scope.split(":");
    return t("badge.reqCounterCategoryMode", { count, mode: tagLabel(mode), category: categoryById(categoryId)?.name || "" });
  }
  if (scope.startsWith("category:")) {
    const categoryId = scope.split(":")[1];
    return t("badge.reqCounterCategory", { count, category: categoryById(categoryId)?.name || "" });
  }
  if (scope.startsWith("mode:")) {
    return t("badge.reqCounterMode", { count, mode: tagLabel(scope.split(":")[1]) });
  }
  return "";
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
  } else {
    statusEl.textContent = t("badge.locked");
    statusEl.className = "badgeStatus";

    if (badge.kind === "counter") {
      const count = badgeCounterCount(badge.scope || "");
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

async function renderCheckins() {
  const due = (await api.dueCheckins()).map((d) => ({ actionId: d.state.actionId, action: d.action }));

  const section = $("checkinsSection");
  section.innerHTML = "";
  if (due.length === 0) return;

  const heading = document.createElement("div");
  heading.className = "h2";
  heading.textContent = t("shelf.stillHolding");
  section.appendChild(heading);

  for (const item of due) {
    if (!item.action) continue;
    const card = document.createElement("div");
    card.className = "card";
    card.style.background = "var(--cream)";
    card.innerHTML = `
      <h3 style="font-weight:900;font-size:16px;margin-bottom:6px">${esc(item.action.name)}</h3>
      <p style="font-size:14px;font-weight:600;margin-bottom:12px">${esc(t("shelf.stillHolding"))}</p>
      <div style="display:flex;gap:10px">
        <button class="btn sm" type="button" data-role="still">${esc(t("shelf.stillOffIt"))}</button>
        <button class="btn sm ghost" type="button" data-role="back">${esc(t("shelf.wentBack"))}</button>
      </div>`;
    card.querySelector('[data-role="still"]').addEventListener("click", async () => {
      const result = await api.checkin(item.actionId, "holding");
      await refreshUserState();
      renderShelf();
      if (result?.newBadges?.length) {
        showBadgePop({
          badges: result.newBadges,
          levelUp: null,
          receipt: { action: item.action.name, time: item.action.timeEstimate },
          shareCard: { kind: "badge", headline: result.newBadges[0].name, subline: t("badge.unlocked") },
        });
      }
    });
    card.querySelector('[data-role="back"]').addEventListener("click", async () => {
      await api.checkin(item.actionId, "went_back");
      await refreshUserState();
      card.innerHTML = `<p style="font-size:14px;font-weight:700">${esc(t("shelf.wentBackLogged"))}</p>`;
    });
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
  buildFilterChips("filterLocation", [["Anywhere", "tag.anywhere"], ["Outside US", "tag.outsideUs"], ["US only", "tag.usOnly"]], "location");
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
  $("popCloseBtn").addEventListener("click", () => $("badgePop").classList.remove("on"));

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
