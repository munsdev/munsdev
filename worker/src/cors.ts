import type { Env } from "./types";

export function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
      headers: { "Content-Type": "application/json", ...extraHeaders },
    })
  );
}

export function preflight(env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
