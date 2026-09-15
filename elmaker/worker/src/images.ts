import type { Env } from "./types";

const SHA_RE = /^[0-9a-f]{64}$/;
const OK_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 12 * 1024 * 1024; // a 2000px photo is well under this

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Does the library already hold these bytes? Lets the client skip the
    upload entirely when the same photo is dropped twice. Answers 200 either
    way: a miss is the ordinary case, and a 404 here would spend the rest of
    the tool's life as a red line in the console that hides real ones. */
export async function haveImage(env: Env, sha: string): Promise<Response> {
  if (!SHA_RE.test(sha)) return json({ error: "bad key" }, 400);
  const row = await env.DB.prepare("SELECT sha256 FROM images WHERE sha256 = ?").bind(sha).first();
  return json({ have: !!row });
}

/** Store the full-size photo. The client claims a sha; we recompute it from
    the bytes and reject a mismatch, so the key always describes the content. */
export async function putImage(env: Env, sha: string, request: Request): Promise<Response> {
  if (!SHA_RE.test(sha)) return json({ error: "bad key" }, 400);

  const mime = request.headers.get("Content-Type") || "";
  if (!OK_MIME.has(mime)) return json({ error: "unsupported type" }, 415);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: "empty" }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "too large" }, 413);

  const actual = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (actual !== sha) return json({ error: "digest mismatch" }, 400);

  const url = new URL(request.url);
  const w = Number(url.searchParams.get("w")) || 0;
  const h = Number(url.searchParams.get("h")) || 0;

  await env.IMAGES.put(`img/${sha}`, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    `INSERT INTO images (sha256, mime, w, h, bytes, has_thumb, created_at)
     VALUES (?1,?2,?3,?4,?5,0,?6)
     ON CONFLICT(sha256) DO UPDATE SET mime=excluded.mime, w=excluded.w, h=excluded.h`,
  )
    .bind(sha, mime, w, h, bytes.byteLength, Date.now())
    .run();

  return json({ ok: true, sha });
}

/** The 72px list-card thumbnail, stored separately so opening the app pulls
    a few KB per photo instead of the full 2000px original. */
export async function putThumb(env: Env, sha: string, request: Request): Promise<Response> {
  if (!SHA_RE.test(sha)) return json({ error: "bad key" }, 400);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024)
    return json({ error: "bad thumb" }, 400);

  await env.IMAGES.put(`thumb/${sha}`, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare("UPDATE images SET has_thumb = 1 WHERE sha256 = ?").bind(sha).run();
  return json({ ok: true });
}

/** Serve bytes through the Worker rather than exposing the bucket: it keeps
    the password meaningful, keeps img-src at 'self', and -- because the
    images stay same-origin -- leaves the export canvas untainted. */
export async function getImage(env: Env, prefix: "img" | "thumb", sha: string): Promise<Response> {
  if (!SHA_RE.test(sha)) return new Response("bad key", { status: 400 });

  const obj = await env.IMAGES.get(`${prefix}/${sha}`);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // The key is the digest, so the bytes can never change under it.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

export async function deleteImage(env: Env, sha: string): Promise<Response> {
  if (!SHA_RE.test(sha)) return json({ error: "bad key" }, 400);
  await env.IMAGES.delete([`img/${sha}`, `thumb/${sha}`]);
  await env.DB.batch([
    env.DB.prepare("UPDATE items SET image_sha = NULL WHERE image_sha = ?").bind(sha),
    env.DB.prepare("DELETE FROM images WHERE sha256 = ?").bind(sha),
  ]);
  return json({ ok: true });
}
