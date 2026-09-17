import type { Env } from "./types";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SIZE_RE = /^\d{2,5}x\d{2,5}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const MAX_RENDER_BYTES = 8 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/* The revision is in the key, not just the row. Renders are served immutable
   for a year, so a re-render that overwrote in place would leave every browser
   that already loaded a graphic serving the old bytes until 2027. Nothing
   re-renders a finished graphic today -- brand styles were what did, and they
   are gone -- so every live graphic sits at rev 1. The revision stays in the
   key because that is what makes re-rendering possible at all: write rev+1,
   commit only once every size has landed, and a tab closed halfway is a
   no-op rather than a half-rebuilt collection. */
const renderKey = (graphicId: string, rev: number, sizeId: string) =>
  `renders/${graphicId}/${rev}/${sizeId}.png`;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function parse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* ---------- collections ---------- */

export async function listCollections(env: Env): Promise<Response> {
  /* `cover` is "<graphic id>/<rev>" for the newest finished graphic in the
     collection -- enough for the browser to build a render URL, without a
     round trip per collection just to show a shelf with pictures on it.
     sizes != '[]' skips a save that died before its renders landed. */
  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM graphics g WHERE g.collection_id = c.id) AS n,
       (SELECT g.id || '/' || g.rev FROM graphics g
          WHERE g.collection_id = c.id AND g.sizes != '[]'
          ORDER BY g.created_at DESC LIMIT 1) AS cover
     FROM collections c WHERE c.archived = 0 ORDER BY c.created_at ASC`,
  ).all();
  return json({
    collections: (results as any[]).map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      count: r.n,
      cover: r.cover || null,
      created_at: r.created_at,
    })),
  });
}

export async function createCollection(env: Env, body: any): Promise<Response> {
  const name = String(body?.name ?? "").trim();
  if (!name) return json({ error: "name required" }, 400);

  const base = slugify(name);
  // Collections get renamed a lot, so the slug only has to be unique, not pretty.
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const clash = await env.DB.prepare("SELECT 1 FROM collections WHERE slug = ?").bind(slug).first();
    if (!clash) break;
    slug = `${base}-${i}`;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO collections (id, slug, name, archived, created_at) VALUES (?1,?2,?3,0,?4)",
  )
    .bind(id, slug, name, Date.now())
    .run();
  return json({ id, slug, name, count: 0 });
}

export async function renameCollection(env: Env, id: string, body: any): Promise<Response> {
  if (!ID_RE.test(id) && !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "bad id" }, 400);
  const name = String(body?.name ?? "").trim();
  if (!name) return json({ error: "name required" }, 400);
  const r = await env.DB.prepare("UPDATE collections SET name = ? WHERE id = ?").bind(name, id).run();
  if (!r.meta.changes) return json({ error: "not found" }, 404);
  return json({ ok: true, name });
}

/* ---------- graphics ---------- */

export async function listGraphics(env: Env, collectionId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM graphics WHERE collection_id = ? ORDER BY created_at DESC",
  )
    .bind(collectionId)
    .all();
  return json({ graphics: (results as any[]).map(rowToGraphic) });
}

function rowToGraphic(r: any) {
  return {
    id: r.id,
    collection_id: r.collection_id,
    title: r.title,
    top: r.top,
    bot: r.bot,
    variant: r.variant,
    align: r.align,
    photo_sha: r.photo_sha,
    scrim: r.scrim,
    per_size: parse(r.per_size, {}),
    sizes: parse<string[]>(r.sizes, []),
    rev: Number(r.rev) || 1,
    alt: r.alt,
    created_at: r.created_at,
    created_by: r.created_by,
  };
}

export async function getGraphic(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM graphics WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  return json({ graphic: rowToGraphic(row) });
}

/** Create the row for a finished graphic. The PNGs are PUT separately, then
    `sizes` is stamped by finishGraphic -- so a half-uploaded graphic never
    looks complete in the library. */
export async function createGraphic(env: Env, body: any): Promise<Response> {
  const collectionId = String(body?.collection_id ?? "");
  if (!collectionId) return json({ error: "collection_id required" }, 400);
  const exists = await env.DB.prepare("SELECT 1 FROM collections WHERE id = ?")
    .bind(collectionId)
    .first();
  if (!exists) return json({ error: "no such collection" }, 404);

  const photo = body?.photo_sha ? String(body.photo_sha) : null;
  if (photo && !SHA_RE.test(photo)) return json({ error: "bad photo_sha" }, 400);

  const id = crypto.randomUUID();
  const top = String(body?.top ?? "");
  await env.DB.prepare(
    `INSERT INTO graphics (id, collection_id, title, top, bot, variant, align,
                           photo_sha, scrim, per_size, sizes, alt, created_at, created_by)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'[]',?11,?12,?13)`,
  )
    .bind(
      id,
      collectionId,
      String(body?.title ?? top).replace(/\n/g, " ").slice(0, 200),
      top,
      String(body?.bot ?? ""),
      String(body?.variant ?? "stack"),
      String(body?.align ?? "center"),
      photo,
      Number(body?.scrim) || 70,
      JSON.stringify(body?.per_size ?? {}),
      String(body?.alt ?? ""),
      Date.now(),
      String(body?.created_by ?? ""),
    )
    .run();
  return json({ id });
}

/** Store one rendered PNG. */
export async function putRender(
  env: Env,
  graphicId: string,
  rev: number,
  sizeId: string,
  request: Request,
): Promise<Response> {
  if (!SIZE_RE.test(sizeId)) return json({ error: "bad size" }, 400);
  if (!Number.isInteger(rev) || rev < 1 || rev > 1e6) return json({ error: "bad rev" }, 400);
  const row = await env.DB.prepare("SELECT rev FROM graphics WHERE id = ?").bind(graphicId).first();
  if (!row) return json({ error: "no such graphic" }, 404);
  /* Only the live revision or the next one. Anything else is a stale client. */
  const live = Number(row.rev) || 1;
  if (rev !== live && rev !== live + 1) return json({ error: "stale rev" }, 409);

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "empty" }, 400);
  if (bytes.byteLength > MAX_RENDER_BYTES) return json({ error: "too large" }, 413);

  await env.IMAGES.put(renderKey(graphicId, rev, sizeId), bytes, {
    httpMetadata: { contentType: "image/png" },
  });
  return json({ ok: true, bytes: bytes.byteLength });
}

/** Stamp which sizes landed. Called once every PNG is up, so `sizes` is the
    signal that a graphic is actually finished and safe to show. */
export async function finishGraphic(env: Env, graphicId: string, body: any): Promise<Response> {
  const sizes: string[] = Array.isArray(body?.sizes) ? body.sizes.map(String) : [];
  if (!sizes.length || !sizes.every((s) => SIZE_RE.test(s)))
    return json({ error: "sizes required" }, 400);

  const row = await env.DB.prepare("SELECT rev, sizes FROM graphics WHERE id = ?")
    .bind(graphicId)
    .first();
  if (!row) return json({ error: "not found" }, 404);

  const live = Number(row.rev) || 1;
  const rev = Number(body?.rev) || live;
  if (rev !== live && rev !== live + 1) return json({ error: "stale rev" }, 409);

  // Trust nothing: confirm each PNG is really in the bucket before saying so.
  for (const s of sizes) {
    const head = await env.IMAGES.head(renderKey(graphicId, rev, s));
    if (!head) return json({ error: `missing render for ${s}` }, 409);
  }

  /* The commit. Until this line the graphic still points at its old renders,
     which is what makes an abandoned re-render cost nothing. */
  await env.DB.prepare("UPDATE graphics SET sizes = ?, rev = ? WHERE id = ?")
    .bind(JSON.stringify(sizes), rev, graphicId)
    .run();

  /* Sweep the superseded revision only after the new one is committed. */
  if (rev > live) {
    const old = parse<string[]>(row.sizes as string, []);
    if (old.length) {
      await env.IMAGES.delete(old.map((s) => renderKey(graphicId, live, s)));
    }
  }
  return json({ ok: true, sizes, rev });
}

export async function deleteGraphic(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT sizes, rev FROM graphics WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  const sizes = parse<string[]>(row.sizes as string, []);
  const rev = Number(row.rev) || 1;
  /* Sweep every revision, not just the live one, or a restyled-then-deleted
     graphic leaves its superseded renders in the bucket forever. */
  if (sizes.length) {
    const keys: string[] = [];
    for (let r = 1; r <= rev; r++) for (const s of sizes) keys.push(renderKey(id, r, s));
    await env.IMAGES.delete(keys);
  }
  await env.DB.prepare("DELETE FROM graphics WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/** Serve a finished PNG. Same reasoning as the source photos: proxied through
    the Worker so the gate applies and the bytes stay same-origin. */
export async function getRender(
  env: Env,
  graphicId: string,
  rev: number,
  sizeId: string,
): Promise<Response> {
  if (!SIZE_RE.test(sizeId)) return new Response("bad size", { status: 400 });
  const obj = await env.IMAGES.get(renderKey(graphicId, rev, sizeId));
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  /* A finished graphic is never re-rendered, so its bytes cannot change. */
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}
