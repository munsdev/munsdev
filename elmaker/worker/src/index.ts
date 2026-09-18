import type { Env } from "./types";
import { cookieFrom, mintToken, tokenValid, passwordOk, setCookieHeader, clearCookieHeader } from "./auth";
import { loginPage } from "./login";
import { getState } from "./api";
import { getImage } from "./images";
import {
  listCollections, listGraphics, getGraphic, getRender,
} from "./library";
import { retiredPage, retiredWrite } from "./retired";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

function harden(res: Response, csp?: string): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (csp) out.headers.set("Content-Security-Policy", csp);
  return out;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function readForm(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    try {
      Object.assign(out, await request.json());
    } catch {
      /* fall through to an empty form; handled as a bad password */
    }
  } else {
    const form = await request.formData();
    for (const [k, v] of form.entries()) out[k] = String(v);
  }
  return out;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  // A shared password is only as good as the cost of guessing it, so the
  // gate is the one route that is rate limited.
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  const limiter = (env as any).LOGIN_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: ip });
    if (!success) return json({ error: "too many attempts" }, 429);
  }

  const form = await readForm(request);
  if (!passwordOk(env, String(form.password ?? ""))) {
    const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
    return wantsJson ? json({ ok: false }, 401) : harden(loginPage(true));
  }

  const token = await mintToken(env);
  const res = json({ ok: true });
  res.headers.set("Set-Cookie", setCookieHeader(token));
  // A browser form post wants to land on the app, not on JSON.
  if (!(request.headers.get("Accept") || "").includes("application/json")) {
    return new Response(null, {
      status: 303,
      headers: { Location: "/", "Set-Cookie": setCookieHeader(token) },
    });
  }
  return res;
}

/* CLOSED. The editor moved into the ElectionLog team hub -- see retired.ts.
   What is left is the notice, the gate, and the reads a migration needs to
   copy the 50 finished graphics across. Nothing here writes any more, and
   nothing here serves the app: `page.html` is no longer built or bundled. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    /* Every write, in one place and before anything else, so a script still
       pointed here fails loudly instead of appearing to work. */
    if (request.method !== "GET" && request.method !== "HEAD" && path !== "/login") {
      return harden(retiredWrite());
    }

    if (path === "/login") {
      if (request.method === "POST") return handleLogin(request, env);
      return harden(loginPage(false));
    }

    const authed = await tokenValid(env, cookieFrom(request));

    if (path === "/logout") {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login", "Set-Cookie": clearCookieHeader() },
      });
    }

    /* The graphics are still behind the password. The notice is not: it says
       only that a tool moved and where to, and somebody still holding the
       bookmark should not need a password they no longer have to find out. */
    if (!authed) {
      if (
        path.startsWith("/api/") || path.startsWith("/img/") ||
        path.startsWith("/thumb/") || path.startsWith("/r/")
      ) {
        return json({ error: "unauthorized" }, 401);
      }
      return harden(retiredPage());
    }

    // --- finished graphics ---
    const renderMatch = /^\/r\/([0-9a-f-]{36})\/(\d{1,6})\/(\d{2,5}x\d{2,5})\.png$/.exec(path);
    if (renderMatch) {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return harden(await getRender(env, renderMatch[1], Number(renderMatch[2]), renderMatch[3]));
    }

    // --- source photos ---
    const imgMatch = /^\/(img|thumb)\/([0-9a-f]{64})$/.exec(path);
    if (imgMatch) {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return harden(await getImage(env, imgMatch[1] as "img" | "thumb", imgMatch[2]));
    }

    // --- api ---
    if (path.startsWith("/api/")) {
      const res = await api(request, env, path);
      return harden(res);
    }

    if (path === "/robots.txt") {
      return harden(
        new Response("User-agent: *\nDisallow: /\n", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    }

    return harden(retiredPage());
  },
};

/* Reads only, and only the ones that let the finished graphics be listed and
   fetched. Everything the editor used to call -- saving a bench, uploading a
   photo, committing a render -- is gone, and the write guard above catches
   those before they reach here anyway. */
async function api(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/state") return getState(env);
  if (path === "/api/collections") return listCollections(env);

  const colGfx = /^\/api\/collections\/([0-9a-f-]{36})\/graphics$/.exec(path);
  if (colGfx) return listGraphics(env, colGfx[1]);

  const gfxOne = /^\/api\/graphics\/([0-9a-f-]{36})$/.exec(path);
  if (gfxOne) return getGraphic(env, gfxOne[1]);

  return json({ error: "not found" }, 404);
}
