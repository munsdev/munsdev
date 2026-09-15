import PAGE from "./page.html";
import type { Env } from "./types";
import { cookieFrom, mintToken, tokenValid, passwordOk, setCookieHeader, clearCookieHeader } from "./auth";
import { loginPage } from "./login";
import { getState, putProject, putItems, deleteItems } from "./api";
import { haveImage, putImage, putThumb, getImage, deleteImage } from "./images";

/* The tool used to be a single file with `connect-src 'none'` and no server.
   It now has both, so that photos survive a reload -- see HANDOFF section 1.
   Everything it talks to is same-origin; no third-party host appears here. */
const APP_CSP = [
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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

    /* Everything below this line is behind the password -- the app shell, the
       API and the image bytes alike. Gating only the page would leave the
       photos and the copy readable to anyone who guessed a URL. */
    if (!authed) {
      if (path.startsWith("/api/") || path.startsWith("/img/") || path.startsWith("/thumb/")) {
        return json({ error: "unauthorized" }, 401);
      }
      return harden(loginPage(false));
    }

    // --- images ---
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

    /* The app is one 186KB file, so it rides inside the Worker bundle rather
       than through an assets binding: one artifact, one deploy, nothing to
       get out of step with the code that serves it. */
    return harden(
      new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      }),
      APP_CSP,
    );
  },
};

async function api(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;

  if (path === "/api/state" && method === "GET") return getState(env);

  if (path === "/api/project" && method === "PUT") return putProject(env, await request.json());
  if (path === "/api/items" && method === "PUT") return putItems(env, await request.json());
  if (path === "/api/items/delete" && method === "POST")
    return deleteItems(env, await request.json());

  const haveApi = /^\/api\/have\/([0-9a-f]{64})$/.exec(path);
  if (haveApi && method === "GET") return haveImage(env, haveApi[1]);

  const imgApi = /^\/api\/images\/([0-9a-f]{64})$/.exec(path);
  if (imgApi) {
    const sha = imgApi[1];
    if (method === "PUT") return putImage(env, sha, request);
    if (method === "DELETE") return deleteImage(env, sha);
    return json({ error: "method not allowed" }, 405);
  }

  const thumbApi = /^\/api\/thumbs\/([0-9a-f]{64})$/.exec(path);
  if (thumbApi && method === "PUT") return putThumb(env, thumbApi[1], request);

  return json({ error: "not found" }, 404);
}
