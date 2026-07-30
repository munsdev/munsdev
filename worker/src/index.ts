import type { Env } from "./types";
import {
  COOKIE_NAME,
  checkCredentials,
  clearedSessionCookieHeader,
  createSession,
  destroySession,
  isValidSession,
  parseCookies,
  sessionCookieHeader,
} from "./auth";
import { json, preflight, withCors } from "./cors";
import { createItem, getItem, updateItem, uploadPhotoAsset, type EntryFields } from "./webflow";
import { CLIENT_JS } from "./client";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

async function requireSession(request: Request, env: Env): Promise<string | null> {
  const token = parseCookies(request)[COOKIE_NAME];
  const valid = await isValidSession(env, token);
  return valid ? token! : null;
}

async function readEntryFields(request: Request): Promise<{ fields: EntryFields; photo: File | null }> {
  const form = await request.formData();
  const date = String(form.get("date") || new Date().toISOString());
  const status = String(form.get("status") || "");
  const photo = form.get("photo");
  return {
    fields: { date, status },
    photo: photo && typeof photo !== "string" && photo.size > 0 ? photo : null,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return preflight(env);
    }

    if (request.method === "GET" && url.pathname === "/client.js") {
      return new Response(CLIENT_JS, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/login") {
      const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
      const { username, password } = body;
      if (!username || !password || !checkCredentials(env, username, password)) {
        return json(env, { error: "Invalid credentials" }, 401);
      }
      const token = await createSession(env);
      return json(
        env,
        { loggedIn: true },
        200,
        { "Set-Cookie": sessionCookieHeader(env, token, SESSION_MAX_AGE_SECONDS) }
      );
    }

    if (request.method === "POST" && url.pathname === "/logout") {
      const token = parseCookies(request)[COOKIE_NAME];
      await destroySession(env, token);
      return json(env, { loggedIn: false }, 200, { "Set-Cookie": clearedSessionCookieHeader(env) });
    }

    if (request.method === "GET" && url.pathname === "/session") {
      const token = parseCookies(request)[COOKIE_NAME];
      const loggedIn = await isValidSession(env, token);
      return json(env, { loggedIn });
    }

    const itemIdMatch = url.pathname.match(/^\/item\/([^/]+)$/);
    if (request.method === "GET" && itemIdMatch) {
      if (!(await requireSession(request, env))) {
        return json(env, { error: "Not logged in" }, 401);
      }
      try {
        const item = await getItem(env, itemIdMatch[1]);
        return json(env, item);
      } catch (err) {
        return json(env, { error: String(err) }, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      if (!(await requireSession(request, env))) {
        return json(env, { error: "Not logged in" }, 401);
      }
      try {
        const { fields, photo } = await readEntryFields(request);
        const entryFields: EntryFields = { ...fields };
        if (photo) {
          const { fileId } = await uploadPhotoAsset(env, await photo.arrayBuffer(), photo.name, photo.type);
          entryFields.photoFileId = fileId;
        }
        const item = await createItem(env, entryFields);
        return json(env, { ok: true, item });
      } catch (err) {
        return json(env, { error: String(err) }, 502);
      }
    }

    const submitEditMatch = url.pathname.match(/^\/submit\/([^/]+)$/);
    if (request.method === "PATCH" && submitEditMatch) {
      if (!(await requireSession(request, env))) {
        return json(env, { error: "Not logged in" }, 401);
      }
      try {
        const { fields, photo } = await readEntryFields(request);
        const entryFields: EntryFields = { ...fields };
        if (photo) {
          const { fileId } = await uploadPhotoAsset(env, await photo.arrayBuffer(), photo.name, photo.type);
          entryFields.photoFileId = fileId;
        }
        const item = await updateItem(env, submitEditMatch[1], entryFields);
        return json(env, { ok: true, item });
      } catch (err) {
        return json(env, { error: String(err) }, 502);
      }
    }

    return withCors(env, new Response("Not found", { status: 404 }));
  },
};
