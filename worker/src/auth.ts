import type { Env } from "./types";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const COOKIE_NAME = "poolman_session";

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function checkCredentials(env: Env, username: string, password: string): boolean {
  const pairs = (env.AUTH_PAIRS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return pairs.some((pair) => {
    const sep = pair.indexOf(":");
    if (sep === -1) return false;
    const u = pair.slice(0, sep);
    const p = pair.slice(sep + 1);
    return u === username && p === password;
  });
}

export async function createSession(env: Env): Promise<string> {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(token, JSON.stringify({ createdAt: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function isValidSession(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const record = await env.SESSIONS.get(token);
  return record !== null;
}

export async function destroySession(env: Env, token: string | undefined): Promise<void> {
  if (!token) return;
  await env.SESSIONS.delete(token);
}

export function sessionCookieHeader(env: Env, token: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Domain=${env.SESSION_COOKIE_DOMAIN}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearedSessionCookieHeader(env: Env): string {
  return sessionCookieHeader(env, "", 0);
}
