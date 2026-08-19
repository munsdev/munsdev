import { t, loadLocale, applyStaticStrings, detectPreferredLocale, currentLocale } from "./i18n.js";
import { api } from "./api.js";
import { TURNSTILE_SITE_KEY } from "./config.js";
import {
  LEVEL_LADDER,
  computeLevel,
  loadGuestState,
  hasGuestProgress,
  claimGuest,
  undoClaimGuest,
  markNAGuest,
  undoNAGuest,
  checkinGuest,
  listDueCheckinsGuest,
  guestSummary,
  migrateGuestStateToAccount,
  clearGuestState,
} from "./state.js";

// ---------------- module state ----------------
let catalog = { categories: [], actions: [], badges: [] };
let stats = { period: null, peopleVerified: 0, communityGoals: [] };
let session = { loggedIn: false, email: null };
let stateByActionId = new Map(); // actionId -> {status, moneyRedirectedCents, whatBroke, nextCheckinDue, ...}
let earnedBadgeIds = new Set();
let currentCategoryId = null; // null = Explore "all"
let currentActionId = null;
let toastTimer = null;
let lastUndo = null; // {kind:'claim'|'na', actionId}
let turnstileRendered = { 1: false, 2: false };

const filters = {
  search: "",
  quick: { under5: false, easy: false, anywhere: false },
  sheet: { time: new Set(), effort: new Set(), location: new Set(), status: new Set() },
};

const $ = (id) => document.getElementById(id);
const euros = (cents) => `€${Math.round((cents || 0) / 100)}`;

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
  renderHomeCategoryOrList();
  renderAggregate();
  go("home");
}

async function refreshUserState() {
  if (session.loggedIn) {
    try {
      const me = await api.me();
      stateByActionId = new Map(me.states.claimed.map((s) => [s.actionId, s]));
      for (const actionId of me.states.na) stateByActionId.set(actionId, { status: "na" });
      earnedBadgeIds = new Set(me.badges.map((b) => b.id));
      window.__lastMe = me;
    } catch {
      stateByActionId = new Map();
      earnedBadgeIds = new Set();
    }
  } else {
    const summary = guestSummary(catalog);
    stateByActionId = new Map(summary.states.claimed.map((s) => [s.actionId, s]));
    for (const actionId of summary.states.na) stateByActionId.set(actionId, { status: "na" });
    earnedBadgeIds = new Set(summary.badges.map((b) => b.id));
    window.__lastMe = summary;
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
  const showLevel = session.loggedIn || hasGuestProgress();
  const pct = levelProgressPct(totalClaimed, level);

  $("lvlstrip").hidden = !showLevel;
  if (showLevel) {
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
function arcPoint(pct) {
  const angleDeg = -90 + pct * 180;
  const theta = (angleDeg * Math.PI) / 180;
  const cx = 150, cy = 130, r = 130;
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}

function renderMeter() {
  const period = stats.period;
  const count = period?.count ?? 0;
  const goal = period?.goal ?? 1;
  const pct = Math.max(0, Math.min(1, count / goal));

  const p = arcPoint(pct);
  $("meterFillArc").setAttribute("d", `M20 130 A130 130 0 0 1 ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  $("needle").setAttribute("transform", `rotate(${(-90 + pct * 180).toFixed(2)} 150 130)`);

  let daysLeft = "";
  if (period?.endsAt) {
    const days = Math.max(0, Math.ceil((new Date(period.endsAt).getTime() - Date.now()) / 86400000));
    daysLeft = " · " + t("meter.resetsIn", { days });
  }
  $("meterGoalLine").textContent = `${t("meter.goalPrefix")} ${goal.toLocaleString()} ${t("meter.actionsSuffix")}${daysLeft}`;

  const tickEl = $("meterTick");
  animateCount(tickEl, count);
  $("meterSub").textContent = t("meter.loggedSoFar", { goal: goal.toLocaleString() });
}

function animateCount(el, target) {
  const t0 = performance.now();
  const from = 0;
  function step(now) {
    const p = Math.min((now - t0) / 1200, 1);
    el.textContent = Math.floor(from + (target - from) * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = target.toLocaleString();
  } else {
    requestAnimationFrame(step);
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
const SCREENS = ["home", "cat", "detail", "shelf", "shelf-empty", "you", "you-empty"];
function go(id) {
  for (const s of SCREENS) $("s-" + s).hidden = s !== id;
  document.querySelectorAll(".nav button[data-nav]").forEach((b) => b.setAttribute("aria-current", "false"));
  const navMap = { home: "home", cat: "explore", detail: "explore", shelf: "shelf", "shelf-empty": "shelf", you: "you", "you-empty": "you" };
  const navBtn = document.querySelector(`.nav button[data-nav="${navMap[id]}"]`);
  if (navBtn) navBtn.setAttribute("aria-current", "true");
  $("scrollBody").scrollTop = 0;
}

function renderHomeCategoryOrList() {
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
      <span class="num">${session.loggedIn || hasGuestProgress() ? `${frac.done}<small>${t("categories.fractionOf")} ${frac.total}</small>` : `${frac.total}`}</span>
      <span class="txt"><b>${esc(cat.name)}</b><span>${esc(cat.tagline || cat.shortDescription || "")}</span></span>
      <span class="go">›</span>`;
    btn.addEventListener("click", () => openCategory(cat.id));
    listEl.appendChild(btn);
  }
}

function openCategory(categoryId) {
  currentCategoryId = categoryId;
  const cat = categoryId ? categoryById(categoryId) : null;
  const actions = getFilteredActions(categoryId);
  const doneCount = actions.filter((a) => stateByActionId.get(a.id)?.status === "claimed").length;

  $("catHeading").innerHTML = cat
    ? `${esc(cat.name)} <span class="cnt">${doneCount} ${t("shelf.of")} ${actions.length} ${t("category.done")}</span>`
    : `${esc(t("categories.heading"))} <span class="cnt">${actions.length}</span>`;

  const list = $("catActionList");
  list.innerHTML = "";
  for (const action of actions) list.appendChild(buildActionCard(action, categoryId));
  go("cat");
}

function buildActionCard(action, fromCategoryId) {
  const state = stateByActionId.get(action.id);
  const card = document.createElement("div");
  card.className = "card";

  if (state?.status === "na") {
    card.innerHTML = `<div class="act na"><span class="box">–</span><div>
      <h3><button class="actTitle" type="button">${esc(action.name)}</button></h3>
      <p class="nastate">${esc(t("action.markedNA"))} <button class="linkish" type="button" data-role="undoNA">${esc(t("action.undo"))}</button></p>
    </div></div>`;
    card.querySelector(".actTitle").addEventListener("click", () => openDetail(action.id, fromCategoryId));
    card.querySelector('[data-role="undoNA"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      await doUndoNA(action.id);
    });
    return card;
  }

  const done = state?.status === "claimed";
  const tags = [tagLabel(action.mode), `${action.timeEstimate}`, tagLabel(action.effort), tagLabel(action.availability)];

  card.innerHTML = `<div class="act ${done ? "done" : ""}"><span class="box">${done ? "✓" : ""}</span><div style="flex:1">
      <h3><button class="actTitle" type="button">${esc(action.name)}</button></h3>
      <p>${esc(action.shortDescription)}</p>
      <div class="tags">${tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>
      ${done ? "" : `<div class="actbtns">
        <button class="btn sm" style="flex:1" type="button" data-role="idid">${esc(t("action.iDidThis"))}</button>
        <button class="naLink" type="button" data-role="na">${esc(t("action.doesntApply"))}</button>
      </div>
      <div class="claimform" data-role="claimform">${buildClaimFormHtml(action)}</div>`}
    </div></div>`;

  card.querySelector(".actTitle").addEventListener("click", () => openDetail(action.id, fromCategoryId));
  if (!done) {
    card.querySelector('[data-role="idid"]').addEventListener("click", () => {
      const form = card.querySelector('[data-role="claimform"]');
      form.classList.toggle("open");
    });
    card.querySelector('[data-role="na"]').addEventListener("click", () => doMarkNA(action.id));
    wireClaimForm(card, action);
  }
  return card;
}

function buildClaimFormHtml(action) {
  const chips = action.moneyPresets.map((amount, i) => `<button class="mchip" type="button" data-amount="${amount}" aria-pressed="${i === 0 ? "true" : "false"}">€${amount}</button>`).join("");
  const customChip = `<button class="mchip" type="button" data-amount="custom" aria-pressed="false">${esc(t("claim.moneyCustom"))}</button>`;
  return `
    ${action.moneyPresets.length ? `<span class="claimlabel">${esc(t("claim.moneyLabel"))}</span>
    <div class="moneychips">${chips}${customChip}</div>
    <input type="number" inputmode="decimal" class="customAmount" style="display:none" placeholder="€">` : ""}
    <span class="claimlabel">${esc(t("claim.whatBrokeLabel"))}</span>
    <input type="text" class="whatBroke" placeholder="${esc(t("claim.whatBrokePlaceholder"))}">
    <button class="btn" type="button" data-role="logit">${esc(t("claim.logIt"))}</button>`;
}

function wireClaimForm(card, action) {
  const form = card.querySelector('[data-role="claimform"]');
  if (!form) return;
  let selectedAmount = action.moneyPresets[0] ?? null;

  form.querySelectorAll(".mchip").forEach((chip) => {
    chip.addEventListener("click", () => {
      form.querySelectorAll(".mchip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      chip.setAttribute("aria-pressed", "true");
      const custom = form.querySelector(".customAmount");
      if (chip.dataset.amount === "custom") {
        custom.style.display = "block";
        custom.focus();
        selectedAmount = null;
      } else {
        custom.style.display = "none";
        selectedAmount = Number(chip.dataset.amount);
      }
    });
  });

  form.querySelector('[data-role="logit"]').addEventListener("click", async () => {
    const customEl = form.querySelector(".customAmount");
    const amount = customEl && customEl.style.display !== "none" ? Number(customEl.value || 0) : selectedAmount;
    const whatBroke = form.querySelector(".whatBroke")?.value || "";
    await doClaim(action, amount, whatBroke);
  });
}

function openDetail(actionId, fromCategoryId) {
  currentActionId = actionId;
  const action = catalog.actions.find((a) => a.id === actionId);
  const cat = categoryById(action.categoryId);
  const state = stateByActionId.get(actionId);
  const tags = [tagLabel(action.mode), action.timeEstimate, tagLabel(action.effort), tagLabel(action.availability)];

  $("detailContent").innerHTML = `
    <div class="card">
      <div class="tags" style="margin-bottom:12px">${tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>
      <h3 style="font-size:20px;margin-bottom:10px">${esc(action.name)}</h3>
      <p style="font-size:15px;line-height:1.6;margin-bottom:14px">${esc(action.longDescriptionHtml || action.shortDescription)}</p>
      ${action.helpfulLinks.length ? `<div class="h2" style="margin-top:18px">${esc(t("detail.helpfulLinks"))}</div>
      <p style="font-size:15px;line-height:1.9">${action.helpfulLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="text-decoration:underline;font-weight:700">${esc(l.label)} →</a>`).join("<br>")}</p>` : ""}
      ${state?.status === "claimed" ? "" : `<button class="btn" style="margin-top:18px" type="button" id="detailClaimBtn">${esc(t("action.iDidThis"))}</button>
      <button class="btn ghost sm" style="margin-top:10px" type="button" id="detailNABtn">${esc(t("action.doesntApply"))}</button>
      <div class="claimform" id="detailClaimForm" data-role="claimform">${buildClaimFormHtml(action)}</div>`}
    </div>`;

  if (state?.status !== "claimed") {
    $("detailClaimBtn").addEventListener("click", () => $("detailClaimForm").classList.toggle("open"));
    $("detailNABtn").addEventListener("click", () => doMarkNA(actionId));
    wireClaimForm($("detailContent"), action);
  }
  $("detailBackBtn").onclick = () => (fromCategoryId !== undefined ? openCategory(fromCategoryId) : openCategory(currentCategoryId));
  go("detail");
}

// ---------------- claim / NA / undo ----------------
async function doClaim(action, amountEuros, whatBroke) {
  let result;
  if (session.loggedIn) {
    result = await api.claim(action.id, amountEuros, whatBroke);
  } else {
    result = claimGuest(catalog, action.id, amountEuros, whatBroke);
  }
  await refreshUserState();
  renderTopbar();
  renderAggregate();

  lastUndo = { kind: "claim", actionId: action.id };
  showToast(t("claim.logged", { title: action.name }));

  if (!$("s-detail").hidden) openDetail(action.id, currentCategoryId);
  else if (!$("s-cat").hidden) openCategory(currentCategoryId);
  else if (!$("s-home").hidden) renderHomeCategoryOrList();

  const moneyLabel = amountEuros ? `€${amountEuros}/yr` : null;
  if (result.newBadges?.length || result.levelUp) {
    showBadgePop({
      badges: result.newBadges || [],
      levelUp: result.levelUp,
      receipt: { action: action.name, time: action.timeEstimate, whatBroke: whatBroke || null },
      shareCard: { kind: "claim", headline: action.name, subline: t("badge.stamp"), moneyLabel, whatBroke: whatBroke || null },
    });
  }
}

async function doUndoClaimLast() {
  if (!lastUndo || lastUndo.kind !== "claim") return;
  if (session.loggedIn) await api.undoClaim(lastUndo.actionId);
  else undoClaimGuest(lastUndo.actionId);
  lastUndo = null;
  hideToast();
  await refreshUserState();
  renderTopbar();
  renderAggregate();
  if (!$("s-cat").hidden) openCategory(currentCategoryId);
  if (!$("s-detail").hidden) openDetail(currentActionId, currentCategoryId);
  if (!$("s-home").hidden) renderHomeCategoryOrList();
}

async function doMarkNA(actionId) {
  if (session.loggedIn) await api.markNA(actionId);
  else markNAGuest(actionId);
  await refreshUserState();
  if (!$("s-detail").hidden) openDetail(actionId, currentCategoryId);
  else if (!$("s-cat").hidden) openCategory(currentCategoryId);
  else if (!$("s-home").hidden) renderHomeCategoryOrList();
}

async function doUndoNA(actionId) {
  if (session.loggedIn) await api.undoNA(actionId);
  else undoNAGuest(actionId);
  await refreshUserState();
  if (!$("s-detail").hidden) openDetail(actionId, currentCategoryId);
  else if (!$("s-cat").hidden) openCategory(currentCategoryId);
  else if (!$("s-home").hidden) renderHomeCategoryOrList();
  showToast(t("action.restoredActive"));
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
function shareButtons(card) {
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
    <div class="r"><span>${esc(t("filters.time"))}</span><b>${esc(receipt.time)}</b></div>
    ${receipt.whatBroke ? `<div class="r"><span>${esc(t("claim.whatBrokeLabel"))}</span><b>${esc(receipt.whatBroke)}</b></div>` : ""}`;

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

// ---------------- shelf ----------------
function renderShelf() {
  if (!session.loggedIn && !hasGuestProgress()) {
    go("shelf-empty");
    return;
  }

  const badgeGrid = $("badgeGrid");
  badgeGrid.innerHTML = "";
  const earnedCount = earnedBadgeIds.size;
  $("shelfCount").textContent = `${earnedCount} ${t("shelf.of")} ${catalog.badges.length}`;

  for (const badge of catalog.badges) {
    const unlocked = earnedBadgeIds.has(badge.id);
    const tile = document.createElement("div");
    tile.className = `badge ${unlocked ? "" : "locked"}`;
    tile.innerHTML = `<div class="ico">${badge.icon}</div><div class="nm">${esc(badge.name)}</div><div class="st">${unlocked ? "" : t("filters.status")}</div>`;
    badgeGrid.appendChild(tile);
  }

  renderCheckins();
  go("shelf");
}

async function renderCheckins() {
  const due = session.loggedIn ? (await api.dueCheckins()).map((d) => ({ actionId: d.state.actionId, action: d.action })) : listDueCheckinsGuest().map((s) => ({ actionId: s.actionId, action: catalog.actions.find((a) => a.id === s.actionId) }));

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
      const result = session.loggedIn ? await api.checkin(item.actionId, "holding") : checkinGuest(catalog, item.actionId, "holding");
      await refreshUserState();
      renderShelf();
      if (result?.newBadges?.length) {
        showBadgePop({ badges: result.newBadges, levelUp: null, receipt: { action: item.action.name, time: item.action.timeEstimate, whatBroke: null }, shareCard: { kind: "badge", headline: result.newBadges[0].name, subline: t("badge.unlocked") } });
      }
    });
    card.querySelector('[data-role="back"]').addEventListener("click", async () => {
      if (session.loggedIn) await api.checkin(item.actionId, "went_back");
      else checkinGuest(catalog, item.actionId, "went_back");
      await refreshUserState();
      card.innerHTML = `<p style="font-size:14px;font-weight:700">${esc(t("shelf.wentBackLogged"))}</p>`;
    });
    section.appendChild(card);
  }
}

// ---------------- you ----------------
function renderYou() {
  if (!session.loggedIn && !hasGuestProgress()) {
    go("you-empty");
    return;
  }
  const me = window.__lastMe;
  $("youActionsTaken").textContent = me.stats.actionsTaken;
  $("youRedirected").textContent = euros(me.stats.redirectedCents);
  $("youBadges").textContent = me.stats.badgesEarned;
  $("youStillHolding").textContent = me.stats.stillHolding;

  const receipt = $("ledgerReceipt");
  receipt.innerHTML = "";
  for (const entry of me.ledger) {
    const row = document.createElement("div");
    row.className = "r";
    row.innerHTML = `<span>${esc(entry.actionName)}</span><b>${euros(entry.cents)}</b>`;
    receipt.appendChild(row);
  }
  const total = document.createElement("div");
  total.className = "r";
  total.style.borderTop = "2px solid var(--ink)";
  total.style.marginTop = "6px";
  total.style.paddingTop = "6px";
  total.innerHTML = `<span><b>${esc(t("you.perYear"))}</b></span><b>${euros(me.stats.redirectedCents)}</b>`;
  receipt.appendChild(total);

  const tools = $("accountTools");
  tools.innerHTML = "";
  if (session.loggedIn) {
    const exportBtn = document.createElement("button");
    exportBtn.className = "linkish";
    exportBtn.type = "button";
    exportBtn.textContent = t("you.exportDelete");
    exportBtn.addEventListener("click", async () => {
      if (!confirm(t("you.exportConfirm"))) return;
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dollarsout-export.json";
      a.click();
      await api.deleteAccount();
      session = { loggedIn: false, email: null };
      await refreshUserState();
      renderTopbar();
      go("home");
    });
    tools.appendChild(exportBtn);
  } else {
    const note = document.createElement("p");
    note.style.fontSize = "14px";
    note.style.fontWeight = "600";
    note.style.opacity = "0.8";
    note.textContent = t("you.guestNote");
    tools.appendChild(note);
  }

  $("shareLedgerBtn").onclick = async () => {
    let shareUrl = null;
    try {
      const created = await api.createShare({ kind: "ledger", headline: t("you.ledgerHeading"), subline: euros(me.stats.redirectedCents), moneyLabel: euros(me.stats.redirectedCents) });
      shareUrl = created.url;
    } catch {}
    if (shareUrl && navigator.share) navigator.share({ title: t("you.ledgerHeading"), url: shareUrl }).catch(() => {});
    else if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl).catch(() => {});
      showToast(t("share.copied"));
    }
  };

  go("you");
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
  } catch (err) {
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
    if (hasGuestProgress()) {
      showToast(t("auth.migrating"));
      await migrateGuestStateToAccount(api);
    }
    session = await api.getSession();
    await refreshUserState();
    renderTopbar();
    renderHomeCategoryOrList();
    renderAggregate();
    showToast(t("auth.syncedToast"));
  } catch (err) {
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
  renderHomeCategoryOrList();
  if (!$("s-cat").hidden) openCategory(currentCategoryId);
}

// ---------------- static wiring ----------------
function wireStaticEvents() {
  document.querySelectorAll(".nav button[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dest = btn.dataset.nav;
      if (dest === "home") { renderHomeCategoryOrList(); go("home"); }
      else if (dest === "explore") openCategory(null);
      else if (dest === "shelf") renderShelf();
      else if (dest === "you") renderYou();
    });
  });

  $("authPill").addEventListener("click", () => {
    if (session.loggedIn) {
      api.logout().then(() => {
        session = { loggedIn: false, email: null };
        refreshUserState().then(() => { renderTopbar(); renderHomeCategoryOrList(); });
      });
    } else openAuth();
  });
  $("shelfSaveBtn").addEventListener("click", openAuth);
  $("youSaveBtn").addEventListener("click", openAuth);
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

  $("catBackBtn").addEventListener("click", () => { renderHomeCategoryOrList(); go("home"); });
  $("toastUndoBtn").addEventListener("click", doUndoClaimLast);
  $("popCloseBtn").addEventListener("click", () => $("badgePop").classList.remove("on"));

  $("openFiltersBtn").addEventListener("click", openFilters);
  $("closeFiltersBtn").addEventListener("click", closeFilters);
  $("showResultsBtn").addEventListener("click", applyFiltersAndClose);

  $("searchInput").addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderHomeCategoryOrList();
  });
  $("quickChips").querySelectorAll("[data-quick]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.quick;
      filters.quick[key] = !filters.quick[key];
      chip.setAttribute("aria-pressed", String(filters.quick[key]));
      renderHomeCategoryOrList();
    });
  });
  $("surpriseBtn").addEventListener("click", () => {
    const undone = catalog.actions.filter((a) => stateByActionId.get(a.id)?.status !== "claimed" && stateByActionId.get(a.id)?.status !== "na");
    const pick = (undone.length ? undone : catalog.actions)[Math.floor(Math.random() * (undone.length ? undone.length : catalog.actions.length))];
    if (pick) openDetail(pick.id, pick.categoryId);
  });

  $("localeSwitch").addEventListener("click", async () => {
    const next = currentLocale() === "en" ? "de" : "en";
    localStorage.setItem("dollarsout:locale", next);
    await loadLocale(next);
    $("localeSwitch").textContent = next === "en" ? "DE" : "EN";
    renderTopbar();
    renderMeter();
    renderAggregate();
    if (!$("s-home").hidden) renderHomeCategoryOrList();
    if (!$("s-cat").hidden) openCategory(currentCategoryId);
  });
  $("localeSwitch").textContent = currentLocale() === "en" ? "DE" : "EN";
}

boot();
