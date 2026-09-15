import type { Env } from "./types";

const COOKIE = "socialmaker_gate";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Compare without leaking length or position through timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Length differences are unavoidable to observe via encode, but we still
  // walk a fixed number of bytes so content comparison is constant-time.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stateless token: "<expiry-ms>.<hmac>". No KV round trip on every request. */
export async function mintToken(env: Env): Promise<string> {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${await hmac(env.GATE_SECRET, exp)}`;
}

export async function tokenValid(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.GATE_SECRET, exp));
}

export function passwordOk(env: Env, supplied: string): boolean {
  return safeEqual(supplied, env.GATE_PASSWORD || "");
}

export function cookieFrom(request: Request): string | undefined {
  const header = request.headers.get("Cookie") || "";
  for (const pair of header.split(";")) {
    const i = pair.indexOf("=");
    if (i === -1) continue;
    if (pair.slice(0, i).trim() === COOKIE) return decodeURIComponent(pair.slice(i + 1).trim());
  }
  return undefined;
}

export function setCookieHeader(token: string): string {
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ].join("; ");
}

export function clearCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
