import type { Env } from "./types";

export function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function withCors(env: Env, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(env))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export function json(env: Env, data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return withCors(
    env,
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        // Every one of these is live state (the meter, the ledger, the signed-in user's own
        // rows). Without an explicit directive the edge is free to apply its own heuristics and
        // hand the next visitor a stale count, so opt out at both layers -- CDN-Cache-Control
        // targets Cloudflare's cache specifically, Cache-Control the browser's.
        "Cache-Control": "no-store",
        "CDN-Cache-Control": "no-store",
        ...extraHeaders,
      },
    })
  );
}

export function preflight(env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
