import type { Env } from "./types";
import { json, preflight } from "./cors";
import {
  checkRateLimits,
  clearedSessionCookieHeader,
  createSession,
  currentAccount,
  destroySession,
  parseCookies,
  requestOtp,
  sessionCookieHeader,
  verifyOtp,
  verifyTurnstile,
  COOKIE_NAME,
} from "./auth";
import { getCatalog, getStats, invalidateCatalogCache } from "./content";
import {
  handleCheckin,
  handleClaim,
  handleDeleteAccount,
  handleDueCheckins,
  handleExport,
  handleMarkNA,
  handleMe,
  handleUndoClaim,
  handleUndoNA,
} from "./claims";
import { createShare, getShare, renderCardPng } from "./shareImage";
import { reconcileAggregates } from "./aggregate";
import { syncCategoriesFromWebflow } from "./webflowSync";

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function requireAccount(env: Env, request: Request) {
  return currentAccount(env, request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    if (request.method === "OPTIONS") return preflight(env);

    try {
      // ---- public content ----
      if (request.method === "GET" && pathname === "/catalog") {
        return json(env, await getCatalog(env));
      }
      if (request.method === "GET" && pathname === "/stats") {
        return json(env, await getStats(env));
      }

      // ---- auth ----
      if (request.method === "POST" && pathname === "/auth/request-code") {
        const body = await readJson<{ email: string; turnstileToken: string }>(request);
        if (!body?.email) return json(env, { error: "missing_email" }, 400);
        if (!(await verifyTurnstile(env, body.turnstileToken, ip)))
          return json(env, { error: "turnstile_failed" }, 400);
        if (!(await checkRateLimits(env, request))) return json(env, { error: "rate_limited" }, 429);
        const result = await requestOtp(env, body.email);
        return json(env, result, result.ok ? 200 : 400);
      }

      if (request.method === "POST" && pathname === "/auth/verify-code") {
        const body = await readJson<{ email: string; code: string; turnstileToken: string }>(request);
        if (!body?.email || !body?.code) return json(env, { error: "missing_fields" }, 400);
        if (!(await verifyTurnstile(env, body.turnstileToken, ip)))
          return json(env, { error: "turnstile_failed" }, 400);
        const result = await verifyOtp(env, body.email, body.code, ip);
        if (!result.ok || !result.accountId) return json(env, result, 400);
        const token = await createSession(env, result.accountId);
        return json(env, { ok: true }, 200, {
          "Set-Cookie": sessionCookieHeader(env, token, 60 * 60 * 24 * 90),
        });
      }

      if (request.method === "POST" && pathname === "/auth/logout") {
        const token = parseCookies(request)[COOKIE_NAME];
        await destroySession(env, token);
        return json(env, { ok: true }, 200, { "Set-Cookie": clearedSessionCookieHeader(env) });
      }

      if (request.method === "GET" && pathname === "/auth/session") {
        const account = await requireAccount(env, request);
        return json(env, { loggedIn: !!account, email: account?.email ?? null });
      }

      // ---- account-gated routes ----
      const gated = [
        "/claims",
        "/na/",
        "/checkins",
        "/me",
        "/me/export",
        "/me/delete",
      ];
      const needsAccount = gated.some((p) => pathname === p || pathname.startsWith(p));

      if (needsAccount) {
        const account = await requireAccount(env, request);
        if (!account) return json(env, { error: "sign_in_required" }, 401);

        if (request.method === "POST" && pathname === "/claims") {
          const body = await readJson<{ actionId: string; moneyRedirectedEuros?: number; whatBroke?: string }>(
            request
          );
          if (!body?.actionId) return json(env, { error: "missing_action_id" }, 400);
          const result = await handleClaim(env, account, body);
          return json(env, "body" in result ? result.body : { error: result.error }, result.status);
        }

        if (request.method === "DELETE" && pathname.startsWith("/claims/")) {
          const actionId = decodeURIComponent(pathname.slice("/claims/".length));
          const result = await handleUndoClaim(env, account, actionId);
          return json(env, result.body, result.status);
        }

        if (request.method === "POST" && pathname.startsWith("/na/")) {
          const actionId = decodeURIComponent(pathname.slice("/na/".length));
          const result = await handleMarkNA(env, account, actionId);
          return json(env, "body" in result ? result.body : { error: result.error }, result.status);
        }

        if (request.method === "DELETE" && pathname.startsWith("/na/")) {
          const actionId = decodeURIComponent(pathname.slice("/na/".length));
          const result = await handleUndoNA(env, account, actionId);
          return json(env, result.body, result.status);
        }

        if (request.method === "POST" && pathname === "/checkins") {
          const body = await readJson<{ actionId: string; result: "holding" | "went_back" }>(request);
          if (!body?.actionId || !body?.result) return json(env, { error: "missing_fields" }, 400);
          const result = await handleCheckin(env, account, body);
          return json(env, "body" in result ? result.body : { error: result.error }, result.status);
        }

        if (request.method === "GET" && pathname === "/checkins/due") {
          const result = await handleDueCheckins(env, account);
          return json(env, result.body, result.status);
        }

        if (request.method === "GET" && pathname === "/me") {
          const result = await handleMe(env, account);
          return json(env, result.body, result.status);
        }

        if (request.method === "GET" && pathname === "/me/export") {
          const result = await handleExport(env, account);
          return json(env, result.body, result.status, {
            "Content-Disposition": "attachment; filename=dollarsout-export.json",
          });
        }

        if (request.method === "POST" && pathname === "/me/delete") {
          const result = await handleDeleteAccount(env, account);
          return json(env, result.body, result.status, { "Set-Cookie": clearedSessionCookieHeader(env) });
        }
      }

      // ---- sharing (public, unauthenticated per spec S9) ----
      if (request.method === "POST" && pathname === "/share") {
        const body = await readJson<{
          kind: "claim" | "badge" | "ledger";
          headline: string;
          subline: string;
          moneyLabel?: string | null;
          whatBroke?: string | null;
        }>(request);
        if (!body?.kind || !body?.headline || !body?.subline) return json(env, { error: "missing_fields" }, 400);
        const id = await createShare(env, body);
        return json(env, { id, url: `${url.origin}/s/${id}` });
      }

      if (request.method === "GET" && pathname.startsWith("/share/") && pathname.endsWith(".png")) {
        const id = pathname.slice("/share/".length, -".png".length);
        const card = await getShare(env, id);
        if (!card) return new Response("Not found", { status: 404 });
        const png = await renderCardPng(card);
        return new Response(png, {
          headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
        });
      }

      if (request.method === "GET" && pathname.startsWith("/s/")) {
        const id = pathname.slice("/s/".length);
        const card = await getShare(env, id);
        if (!card) return new Response("Not found", { status: 404 });
        const imgUrl = `${url.origin}/share/${id}.png`;
        const html = `<!doctype html><html><head><meta charset="utf-8">
          <title>${card.headline} — DollarsOut</title>
          <meta property="og:title" content="${card.headline}">
          <meta property="og:description" content="${card.subline}">
          <meta property="og:image" content="${imgUrl}">
          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:image" content="${imgUrl}">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          </head><body style="margin:0;background:#14130F;display:flex;align-items:center;justify-content:center;min-height:100vh">
          <img src="${imgUrl}" alt="${card.headline}" style="max-width:100%;height:auto">
          </body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      return json(env, { error: "not_found" }, 404);
    } catch (err) {
      console.error(err);
      return json(env, { error: "internal_error" }, 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 3 * * *") {
      ctx.waitUntil(
        (async () => {
          await syncCategoriesFromWebflow(env);
          await invalidateCatalogCache(env);
        })()
      );
      return;
    }
    ctx.waitUntil(reconcileAggregates(env));
  },
};
