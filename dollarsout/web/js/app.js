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
let currentCategoryId = null;
let currentActionId = null;
let toastTimer = null;
let lastUndo = null; // {kind:'claim', actionId}
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
    return;
  }
  try {
    const me = await api.me();
    stateByActionId = new Map(me.states.claimed.map((s) => [s.actionId, s]));
    for (const actionId of me.states.na) stateByActionId.set(actionId, { status: "na" });
    earnedBadgeIds = new Set(me.badges.map((b) => b.id));
  } catch {
    stateByActionId = new Map();
    earnedBadgeIds = new Set();
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

  $("lvlstrip").hidden = !session.loggedIn;
  if (session.loggedIn) {
    $("lvlName").textContent = `Lv${level.level} ${level.name}`;
    $("lvlBar").style.width = `${pct}%`;
    $("lvlNext").textContent = level.nextName ? t("level.toNext", { count: level.actionsToNext, name: level.nextName }) : "";
  }

  const shelfLvlName = $("shelfLvlName");
  if (shelfLvlName) {
    shelfLvlName.textContent = `Lv${level.level} ${level.name}`;
    $("shelfLvlBar").style.width = `${pct}%`;
    $("shelfLvlNext").textContent = level.nextName ? t("level.toNext", { count: level.actionsToNext, name: level.nextName }) : "";
  }
}

// ---------------- meter (collective dial) ----------------
// The fill arc and the background track share the exact same path (a fixed 180° semicircle from
// the "0" end at (20,130) to the "full" end at (280,130)); progress is drawn with stroke-dasharray
// / stroke-dashoffset against the path's real measured length (getTotalLength()) rather than by
// recomputing an arc endpoint by hand each render.
let meterArcLength = null;
function getMeterArcLength() {
  if (meterArcLength == null) meterArcLength = $("meterFillArc").getTotalLength();
  return meterArcLength;
}

function renderMeter() {
  const period = stats.period;
  const count = period?.count ?? 0;
  const goal = period?.goal ?? 1;
  const pctRaw = goal > 0 ? count / goal : 0;
  const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(1, pctRaw)) : 0;

  const fillArc = $("meterFillArc");
  const length = getMeterArcLength();
  fillArc.style.strokeDasharray = `${length}`;
  fillArc.style.strokeDashoffset = `${length * (1 - pct)}`;

  $("needle").setAttribute("transform", `rotate(${(-90 + pct * 180).toFixed(2)} 150 130)`);

  $("meterGoalLine").textContent = `${t("meter.goalPrefix")} ${goal.toLocaleString()} ${t("meter.actionsSuffix")}`;

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
  $("statActionsLogged").textContent = (stats.period?.count ?? 0).toLocaleString();
  $("statPeopleVerified").textContent = (stats.peopleVerified ?? 0).toLocaleString();

  const wrap = $("communityGoals");
  wrap.innerHTML = "";
  for (const goal of stats.communityGoals) {
    const pct = Math.max(0, Math.min(100, Math.round((goal.count / goal.goal) * 100)));
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-family:'Archivo Black';font-size:14px;text-transform:uppercase;letter-spacing:0.02em">${esc(goal.label)}</div>
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
const SCREENS = ["home", "explore", "cat", "detail", "shelf", "shelf-empty", "ledger"];
function go(id) {
  for (const s of SCREENS) $("s-" + s).hidden = s !== id;
  document.querySelectorAll(".nav button[data-nav]").forEach((b) => b.setAttribute("aria-current", "false"));
  const navMap = { home: "home", explore: "explore", cat: "explore", detail: "explore", shelf: "shelf", "shelf-empty": "shelf", ledger: "home" };
  const navBtn = document.querySelector(`.nav button[data-nav="${navMap[id]}"]`);
  if (navBtn) navBtn.setAttribute("aria-current", "true");
  $("scrollBody").scrollTop = 0;
}

/** Re-renders whichever of Explore/category/detail is currently on screen, after a state change. */
function refreshCurrentScreen(actionId) {
  if (!$("s-detail").hidden) openDetail(actionId ?? currentActionId, currentCategoryId);
  else if (!$("s-cat").hidden) openCategory(currentCategoryId);
  else if (!$("s-explore").hidden) renderExplore();
}

function renderExplore() {
  const listEl = $("categoryList");
  $("categoryCount").textContent = t("categories.count", { count: catalog.categories.length });

  if (filtersActive()) {
    const actions = getFilteredActions(null);
    listEl.innerHTML = "";
    if (actions.length === 0) {
      listEl.innerHTML = `<p style="font-weight:600;padding:12px 2px">${esc(t("common.error"))}</p>`;
    }
    for (const action of actions) listEl.appendChild(buildActionCard(action, null));
    return;
  }

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
  const cat = categoryById(categoryId);
  const actions = getFilteredActions(categoryId);
  const doneCount = actions.filter((a) => stateByActionId.get(a.id)?.status === "claimed").length;

  $("catHeading").innerHTML = `${esc(cat.name)} <span class="cnt">${doneCount} ${t("shelf.of")} ${actions.length} ${t("category.done")}</span>`;

  const list = $("catActionList");
  list.innerHTML = "";
  for (const action of actions) list.appendChild(buildActionCard(action, categoryId));
  go("cat");
}

function buildActionCard(action, fromCategoryId) {
  const state = stateByActionId.get(action.id);
  const card = document.createElement("div");
  card.className = "card";

  const done = state?.status === "claimed";
  const tags = [tagLabel(action.mode), `${action.timeEstimate}`, tagLabel(action.effort), tagLabel(action.availability)];

  card.innerHTML = `<div class="act ${done ? "done" : ""}"><span class="box">${done ? "✓" : ""}</span><div style="flex:1">
      <h3><button class="actTitle" type="button">${esc(action.name)}</button></h3>
      <p>${esc(action.shortDescription)}</p>
      <div class="tags">${tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>
      ${done ? "" : `<button class="btn sm" style="margin-top:12px" type="button" data-role="idid">${esc(t("action.iDidThis"))}</button>`}
    </div></div>`;

  card.querySelector(".actTitle").addEventListener("click", () => openDetail(action.id, fromCategoryId));
  if (!done) {
    card.querySelector('[data-role="idid"]').addEventListener("click", () => doClaim(action));
  }
  return card;
}

function openDetail(actionId, fromCategoryId) {
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
      ${state?.status === "claimed" ? "" : `<button class="btn" style="margin-top:18px" type="button" id="detailClaimBtn">${esc(t("action.iDidThis"))}</button>`}
    </div>`;

  if (state?.status !== "claimed") {
    $("detailClaimBtn").addEventListener("click", () => doClaim(action));
  }
  $("detailBackBtn").onclick = () => {
    const target = fromCategoryId !== undefined ? fromCategoryId : currentCategoryId;
    if (target) openCategory(target);
    else {
      renderExplore();
      go("explore");
    }
  };
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

    lastUndo = { kind: "claim", actionId: action.id };
    showToast(t("claim.logged", { title: action.name }));
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

async function doUndoClaimLast() {
  if (!lastUndo || lastUndo.kind !== "claim") return;
  await api.undoClaim(lastUndo.actionId);
  lastUndo = null;
  hideToast();
  await refreshUserState();
  renderTopbar();
  renderAggregate();
  refreshCurrentScreen();
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
    const tile = document.createElement("div");
    tile.className = `badge ${unlocked ? "" : "locked"}`;
    tile.innerHTML = `<div class="ico">${badge.icon}</div><div class="nm">${esc(badge.name)}</div><div class="st">${unlocked ? "" : t("badge.locked")}</div>`;
    badgeGrid.appendChild(tile);
  }

  renderCheckins();
  go("shelf");
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
      <h3 style="font-family:'Archivo Black';font-size:16px;margin-bottom:6px">${esc(item.action.name)}</h3>
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
  if (!$("s-cat").hidden) openCategory(currentCategoryId);
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
  try {
    const result = await api.requestCode(email, token);
    if (!result.ok) throw new Error(result.error || "failed");
    showAuthStep(2);
  } catch {
    $("authError1").textContent = t("common.error");
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
  renderExplore();
  if (!$("s-cat").hidden) openCategory(currentCategoryId);
}

// ---------------- static wiring ----------------
function wireStaticEvents() {
  document.querySelectorAll(".nav button[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dest = btn.dataset.nav;
      if (dest === "home") { go("home"); refreshHome(); }
      else if (dest === "explore") { renderExplore(); go("explore"); }
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

  $("catBackBtn").addEventListener("click", () => { renderExplore(); go("explore"); });
  $("toastUndoBtn").addEventListener("click", doUndoClaimLast);
  $("popCloseBtn").addEventListener("click", () => $("badgePop").classList.remove("on"));

  $("openFiltersBtn").addEventListener("click", openFilters);
  $("closeFiltersBtn").addEventListener("click", closeFilters);
  $("showResultsBtn").addEventListener("click", applyFiltersAndClose);

  $("searchInput").addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderExplore();
  });
  $("quickChips").querySelectorAll("[data-quick]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.quick;
      filters.quick[key] = !filters.quick[key];
      chip.setAttribute("aria-pressed", String(filters.quick[key]));
      renderExplore();
    });
  });
  $("surpriseBtn").addEventListener("click", () => {
    const undone = catalog.actions.filter((a) => stateByActionId.get(a.id)?.status !== "claimed" && stateByActionId.get(a.id)?.status !== "na");
    const pick = (undone.length ? undone : catalog.actions)[Math.floor(Math.random() * (undone.length ? undone.length : catalog.actions.length))];
    if (pick) openDetail(pick.id, pick.categoryId);
  });

  $("localeSwitch").addEventListener("click", openLanguageSheet);
  $("closeLanguageBtn").addEventListener("click", closeLanguageSheet);

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
      if (screen === "cat" || screen === "detail" || screen === "ledger") {
        if (dx > 0) {
          if (screen === "cat") $("catBackBtn").click();
          else if (screen === "detail") $("detailBackBtn").click();
          else if (screen === "ledger") $("ledgerBackBtn").click();
        }
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
