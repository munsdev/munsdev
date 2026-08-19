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

  claim: (actionId) => request("/claims", { method: "POST", body: JSON.stringify({ actionId }) }),
  undoClaim: (actionId) => request(`/claims/${encodeURIComponent(actionId)}`, { method: "DELETE" }),
  markNA: (actionId) => request(`/na/${encodeURIComponent(actionId)}`, { method: "POST" }),
  undoNA: (actionId) => request(`/na/${encodeURIComponent(actionId)}`, { method: "DELETE" }),

  checkin: (actionId, result) =>
    request("/checkins", { method: "POST", body: JSON.stringify({ actionId, result }) }),
  dueCheckins: () => request("/checkins/due"),

  me: () => request("/me"),
  exportData: () => request("/me/export"),
  deleteAccount: () => request("/me/delete", { method: "POST" }),

  createShare: (card) => request("/share", { method: "POST", body: JSON.stringify(card) }),
};

export { API_BASE };
