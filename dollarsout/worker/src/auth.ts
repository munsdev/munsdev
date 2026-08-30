import type { Env } from "./types";
import { createAccount, getAccountByEmail, getAccountById } from "./db";

export const COOKIE_NAME = "dollarsout_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const OTP_TTL_SECONDS = 10 * 60;
const OTP_MAX_ATTEMPTS = 5;

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

export async function createSession(env: Env, accountId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, accountId, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function accountIdForSession(env: Env, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  return (await env.SESSIONS.get(`session:${token}`)) || null;
}

export async function destroySession(env: Env, token: string | undefined): Promise<void> {
  if (!token) return;
  await env.SESSIONS.delete(`session:${token}`);
}

/** Resolves the requesting account from the session cookie, or null for a guest. Guests are fully
 *  supported everywhere per spec S1 -- callers must not treat null as an error. */
export async function currentAccount(env: Env, request: Request) {
  const token = parseCookies(request)[COOKIE_NAME];
  const accountId = await accountIdForSession(env, token);
  if (!accountId) return null;
  return getAccountById(env, accountId);
}

// ---- Turnstile (spec S7.1) ----

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: ip,
  });
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const data = (await resp.json()) as { success: boolean };
  return !!data.success;
}

// ---- Disposable-email blocklist (spec S7.2) ----

const BLOCKLIST_KV_KEY = "disposable-domains";
const BLOCKLIST_CACHE_TTL = 60 * 60 * 24; // refresh daily

export async function isDisposableEmail(env: Env, email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return true;

  let list = await env.COUNTERS.get(BLOCKLIST_KV_KEY);
  if (!list) {
    try {
      const resp = await fetch(env.DISPOSABLE_DOMAIN_BLOCKLIST_URL);
      const text = await resp.text();
      await env.COUNTERS.put(BLOCKLIST_KV_KEY, text, { expirationTtl: BLOCKLIST_CACHE_TTL });
      list = text;
    } catch {
      return false; // fail open -- don't block signups because the remote list is unreachable
    }
  }
  const domains = new Set(list.split("\n").map((d) => d.trim().toLowerCase()).filter(Boolean));
  return domains.has(domain);
}

// ---- Per-IP / per-ASN rate limiting (spec S7.3) ----
// Tuned loosely (see README) so a shared-NAT office/university doesn't get blocked outright.

const IP_DAILY_LIMIT = 8;
const ASN_DAILY_LIMIT = 40;

async function bumpAndCheck(env: Env, key: string, limit: number): Promise<boolean> {
  const current = parseInt((await env.COUNTERS.get(key)) || "0", 10);
  if (current >= limit) return false;
  await env.COUNTERS.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 });
  return true;
}

export async function checkRateLimits(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const asn = (request as any).cf?.asn ? String((request as any).cf.asn) : "unknown-asn";
  const day = new Date().toISOString().slice(0, 10);
  const ipOk = await bumpAndCheck(env, `ratelimit:ip:${ip}:${day}`, IP_DAILY_LIMIT);
  if (!ipOk) return false;
  const asnOk = await bumpAndCheck(env, `ratelimit:asn:${asn}:${day}`, ASN_DAILY_LIMIT);
  return asnOk;
}

// ---- OTP request/verify ----

function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sends the OTP email. The transactional-email vendor is not yet wired -- spec S11 says to reuse
 * whichever EU-resident-friendly sender was set up for 1STAND's Mobilizon instance rather than
 * introducing a new one, but that choice needs Casey to confirm before this can send real mail.
 * OTP_EMAIL_API_KEY / OTP_EMAIL_FROM are read from secrets so swapping vendors is a config change,
 * not a code change -- this Postmark-style call is a placeholder shape, not a final integration.
 */
const OTP_SUBJECT = "Your DollarsOut code";

function otpBody(code: string): string {
  return `Your one-time code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`;
}

/**
 * Sends the OTP through whichever transactional vendor is configured. Resend keys are prefixed
 * `re_`, so the vendor can be inferred from the key rather than needing a second setting.
 *
 * Throws when the send fails, including when no vendor is configured at all: an unconfigured
 * sender used to be swallowed here, so /auth/request-code answered {ok:true} and the UI advanced
 * to the code screen for a code that was never going to arrive. A sign-in that cannot complete has
 * to surface as an error, not as a success.
 */
async function sendOtpEmail(env: Env, email: string, code: string): Promise<void> {
  if (!env.OTP_EMAIL_API_KEY || !env.OTP_EMAIL_FROM) {
    throw new Error("email_not_configured");
  }

  const isResend = env.OTP_EMAIL_API_KEY.startsWith("re_");
  const resp = isResend
    ? await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OTP_EMAIL_API_KEY}`,
        },
        body: JSON.stringify({
          from: env.OTP_EMAIL_FROM,
          to: [email],
          subject: `${OTP_SUBJECT}: ${code}`,
          text: otpBody(code),
        }),
      })
    : await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": env.OTP_EMAIL_API_KEY,
        },
        body: JSON.stringify({
          From: env.OTP_EMAIL_FROM,
          To: email,
          Subject: `${OTP_SUBJECT}: ${code}`,
          TextBody: otpBody(code),
        }),
      });

  if (!resp.ok) {
    console.error(`OTP send failed (${isResend ? "resend" : "postmark"}) ${resp.status}: ${await resp.text()}`);
    throw new Error("email_send_failed");
  }
}

export async function requestOtp(env: Env, email: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { ok: false, error: "invalid_email" };
  if (await isDisposableEmail(env, normalized)) return { ok: false, error: "disposable_email" };

  const code = generateOtp();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO otp_requests (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), normalized, codeHash, expiresAt)
    .run();

  try {
    await sendOtpEmail(env, normalized, code);
  } catch (err) {
    // The pending row is left to expire on its own (10 min) rather than being cleaned up here --
    // it is unusable without the code, which only ever existed in the email we failed to send.
    return { ok: false, error: (err as Error).message || "email_send_failed" };
  }
  return { ok: true };
}

export async function verifyOtp(
  env: Env,
  email: string,
  code: string,
  signupIp: string | null
): Promise<{ ok: boolean; accountId?: string; error?: string }> {
  const normalized = email.trim().toLowerCase();
  const row = await env.DB.prepare(
    `SELECT * FROM otp_requests WHERE email = ? AND consumed = 0
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(normalized)
    .first();

  if (!row) return { ok: false, error: "no_pending_code" };
  if (new Date(row.expires_at as string).getTime() < Date.now()) return { ok: false, error: "expired" };
  if ((row.attempts as number) >= OTP_MAX_ATTEMPTS) return { ok: false, error: "too_many_attempts" };

  const hash = await sha256Hex(code.trim());
  if (hash !== row.code_hash) {
    await env.DB.prepare("UPDATE otp_requests SET attempts = attempts + 1 WHERE id = ?")
      .bind(row.id)
      .run();
    return { ok: false, error: "incorrect_code" };
  }

  await env.DB.prepare("UPDATE otp_requests SET consumed = 1 WHERE id = ?").bind(row.id).run();

  let account = await getAccountByEmail(env, normalized);
  if (!account) {
    account = await createAccount(env, normalized, signupIp);
  }
  return { ok: true, accountId: account.id };
}
