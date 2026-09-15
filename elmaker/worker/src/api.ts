import type { Env, ItemRow } from "./types";

export const PROJECT_ID = "elmaker";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/* ---------- reads ---------- */

/** The whole workspace in one round trip. ~50 rows; not worth paginating. */
export async function getState(env: Env): Promise<Response> {
  const [proj, items, images] = await Promise.all([
    env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(PROJECT_ID).first(),
    env.DB.prepare("SELECT * FROM items WHERE project_id = ? ORDER BY ord ASC")
      .bind(PROJECT_ID)
      .all(),
    env.DB.prepare("SELECT sha256, has_thumb FROM images ORDER BY created_at ASC").all(),
  ]);

  return json({
    exists: !!proj,
    project: proj
      ? {
          caption: proj.caption,
          sizes: safeParse(proj.sizes as string, {}),
          pv: proj.pv,
          guides: !!proj.guides,
          sel: proj.sel,
        }
      : null,
    items: (items.results as unknown as ItemRow[]).map((r) => ({
      id: r.id,
      top: r.top,
      bot: r.bot,
      variant: r.variant,
      align: r.align,
      img: r.image_sha,
      zoom: r.zoom,
      fx: r.fx,
      fy: r.fy,
      scrim: r.scrim,
    })),
    images: (images.results as { sha256: string; has_thumb: number }[]).map((r) => ({
      sha: r.sha256,
      thumb: !!r.has_thumb,
    })),
  });
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* ---------- writes ---------- */

export async function putProject(env: Env, body: any): Promise<Response> {
  await env.DB.prepare(
    `INSERT INTO projects (id, caption, sizes, pv, guides, sel, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       caption=excluded.caption, sizes=excluded.sizes, pv=excluded.pv,
       guides=excluded.guides, sel=excluded.sel, updated_at=excluded.updated_at`,
  )
    .bind(
      PROJECT_ID,
      String(body.caption ?? ""),
      JSON.stringify(body.sizes ?? {}),
      String(body.pv ?? "1080x1350"),
      body.guides ? 1 : 0,
      body.sel ? String(body.sel) : null,
      Date.now(),
    )
    .run();
  return json({ ok: true });
}

/** Upsert a batch of items and their order. Sent as one D1 batch so a save
    is atomic -- a half-written list is worse than a stale one. */
export async function putItems(env: Env, body: any): Promise<Response> {
  const items: any[] = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ ok: true, written: 0 });
  if (items.length > 500) return json({ error: "too many items" }, 413);

  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO items (id, project_id, ord, top, bot, variant, align,
                        image_sha, zoom, fx, fy, scrim, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
     ON CONFLICT(id) DO UPDATE SET
       ord=excluded.ord, top=excluded.top, bot=excluded.bot,
       variant=excluded.variant, align=excluded.align, image_sha=excluded.image_sha,
       zoom=excluded.zoom, fx=excluded.fx, fy=excluded.fy, scrim=excluded.scrim,
       updated_at=excluded.updated_at`,
  );

  await env.DB.batch(
    items.map((it) =>
      stmt.bind(
        String(it.id),
        PROJECT_ID,
        Number(it.ord) || 0,
        String(it.top ?? ""),
        String(it.bot ?? ""),
        String(it.variant ?? "stack"),
        String(it.align ?? "center"),
        it.img ? String(it.img) : null,
        Number(it.zoom) || 100,
        Number(it.fx) ?? 50,
        Number(it.fy) ?? 50,
        Number(it.scrim) ?? 70,
        now,
      ),
    ),
  );
  return json({ ok: true, written: items.length });
}

/** Remove items the client no longer has. Sent alongside a save so the
    server never accumulates rows for graphics someone deleted. */
export async function deleteItems(env: Env, body: any): Promise<Response> {
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) return json({ ok: true, deleted: 0 });
  const stmt = env.DB.prepare("DELETE FROM items WHERE project_id = ? AND id = ?");
  await env.DB.batch(ids.map((id) => stmt.bind(PROJECT_ID, id)));
  return json({ ok: true, deleted: ids.length });
}
