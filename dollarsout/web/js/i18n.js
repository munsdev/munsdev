// Minimal key-based i18n loader (spec §5: no hardcoded string concatenation).
// Static markup uses data-i18n="key" / data-i18n-placeholder="key"; dynamic JS strings call t().

let dict = {};
let locale = "en";

export async function loadLocale(preferred) {
  const supported = ["en", "de"];
  locale = supported.includes(preferred) ? preferred : "en";
  const resp = await fetch(`./i18n/${locale}.json`);
  dict = await resp.json();
  if (locale !== "en") {
    // Fill any key missing from a partial translation with the English fallback.
    const enResp = await fetch("./i18n/en.json");
    const en = await enResp.json();
    dict = { ...en, ...dict };
  }
  document.documentElement.lang = locale;
  applyStaticStrings();
  return locale;
}

export function t(key, vars) {
  let str = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function applyStaticStrings(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
}

export function detectPreferredLocale() {
  const stored = localStorage.getItem("dollarsout:locale");
  if (stored) return stored;
  const nav = (navigator.language || "en").slice(0, 2);
  return nav === "de" ? "de" : "en";
}

export function currentLocale() {
  return locale;
}
