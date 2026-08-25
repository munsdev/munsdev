// Thin fetch wrapper for the DollarsOut Worker API. Cross-subdomain cookie auth (httpOnly session
// cookie set by /auth/verify-code, scoped to .1stand.org) -- credentials: 'include' on every call.
import { API_BASE } from "./config.js";

async function request(path, options = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let data = null;
  try {
    data = await resp.json();
  } catch {
    // non-JSON response (e.g. export download) -- caller handles resp directly if needed
  }
  if (!resp.ok) {
    const err = new Error((data && data.error) || `http_${resp.status}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  getCatalog: () => request("/catalog"),
  getStats: () => request("/stats"),

  getSession: () => request("/auth/session"),
  requestCode: (email, turnstileToken) =>
    request("/auth/request-code", { method: "POST", body: JSON.stringify({ email, turnstileToken }) }),
  verifyCode: (email, code, turnstileToken) =>
    request("/auth/verify-code", { method: "POST", body: JSON.stringify({ email, code, turnstileToken }) }),
  logout: () => request("/auth/logout", { method: "POST" }),

  /**
   * Logs an action. `claimedAt` backdates it ("I did this before finding the app").
   *
   * A rejected claim -- repeatable action still in cooldown, or a one-off already logged --
   * is an expected outcome the UI explains rather than an error it should blow up on, so those
   * come back as a plain `{error}` object instead of throwing.
   */
  claim: (actionId, claimedAt) =>
    request("/claims", { method: "POST", body: JSON.stringify({ actionId, claimedAt }) }).catch(
      (err) => {
        if (err.status === 409 || err.status === 400) return err.data ?? { error: err.message };
        throw err;
      }
    ),
  undoClaim: (actionId) => request(`/claims/${encodeURIComponent(actionId)}`, { method: "DELETE" }),

  checkin: (actionId, result) =>
    request("/checkins", { method: "POST", body: JSON.stringify({ actionId, result }) }),
  dueCheckins: () => request("/checkins/due"),

  me: () => request("/me"),
  exportData: () => request("/me/export"),
  deleteAccount: () => request("/me/delete", { method: "POST" }),

  createShare: (card) => request("/share", { method: "POST", body: JSON.stringify(card) }),

  getRecentLedger: () => request("/ledger/recent"),
  getLedgerPage: (offset) => request(`/ledger?offset=${offset}`),
};

export { API_BASE };
