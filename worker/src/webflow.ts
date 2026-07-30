import { md5 } from "js-md5";
import type { Env } from "./types";

const API_BASE = "https://api.webflow.com/v2";

function authHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}`,
    "Content-Type": "application/json",
    "accept-version": "2.0.0",
  };
}

interface AssetUploadResponse {
  id: string;
  hostedUrl: string;
  uploadUrl: string;
  uploadDetails: Record<string, string>;
}

/**
 * Uploads a photo to Webflow's Assets API and returns the asset id to
 * reference from a CMS item's Image field.
 *
 * NOTE: Webflow's asset-upload flow (register asset -> get presigned S3
 * upload target -> POST the file there) and the exact shape a CMS Image
 * field expects (`{ fileId: "<assetId>" }` below) should be re-verified
 * against the current Webflow v2 API docs once WEBFLOW_SITE_ID and
 * WEBFLOW_COLLECTION_ID are filled in and there's a real collection to test
 * against — this is written from the documented v2 shape but hasn't been
 * exercised against a live site yet.
 */
export async function uploadPhotoAsset(
  env: Env,
  fileBuffer: ArrayBuffer,
  fileName: string,
  contentType: string
): Promise<{ fileId: string; hostedUrl: string }> {
  const fileHash = md5(fileBuffer);

  const registerRes = await fetch(`${API_BASE}/sites/${env.WEBFLOW_SITE_ID}/assets`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({ fileName, fileHash }),
  });
  if (!registerRes.ok) {
    throw new Error(`Webflow asset registration failed: ${registerRes.status} ${await registerRes.text()}`);
  }
  const asset = (await registerRes.json()) as AssetUploadResponse;

  const uploadForm = new FormData();
  for (const [key, value] of Object.entries(asset.uploadDetails)) {
    uploadForm.append(key, value);
  }
  uploadForm.append("file", new Blob([fileBuffer], { type: contentType }), fileName);

  const uploadRes = await fetch(asset.uploadUrl, { method: "POST", body: uploadForm });
  if (!uploadRes.ok) {
    throw new Error(`Asset upload to storage failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  return { fileId: asset.id, hostedUrl: asset.hostedUrl };
}

export interface EntryFields {
  photoFileId?: string;
  date: string; // ISO 8601
  status: string; // rich text HTML
}

function toFieldData(env: Env, fields: EntryFields, name: string, slug: string) {
  const fieldData: Record<string, unknown> = {
    name,
    slug,
    [env.DATE_FIELD_SLUG]: fields.date,
    [env.STATUS_FIELD_SLUG]: fields.status,
  };
  if (fields.photoFileId) {
    fieldData[env.PHOTO_FIELD_SLUG] = { fileId: fields.photoFileId };
  }
  return fieldData;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function nameAndSlugFromDate(date: string): { name: string; slug: string } {
  const d = new Date(date);
  const label = d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return { name: `Update - ${label}`, slug: `update-${slugify(date)}` };
}

export async function createItem(env: Env, fields: EntryFields): Promise<{ id: string }> {
  const { name, slug } = nameAndSlugFromDate(fields.date);
  const res = await fetch(`${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({
      isArchived: false,
      isDraft: false,
      fieldData: toFieldData(env, fields, name, slug),
    }),
  });
  if (!res.ok) {
    throw new Error(`Webflow item creation failed: ${res.status} ${await res.text()}`);
  }
  const item = (await res.json()) as { id: string };
  await publishItems(env, [item.id]);
  return item;
}

export async function updateItem(env: Env, itemId: string, fields: EntryFields): Promise<{ id: string }> {
  const existing = await getItem(env, itemId);
  const { name, slug } = existing.fieldData as { name: string; slug: string };
  const res = await fetch(`${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items/${itemId}`, {
    method: "PATCH",
    headers: authHeaders(env),
    body: JSON.stringify({ fieldData: toFieldData(env, fields, name, slug) }),
  });
  if (!res.ok) {
    throw new Error(`Webflow item update failed: ${res.status} ${await res.text()}`);
  }
  const item = (await res.json()) as { id: string };
  await publishItems(env, [item.id]);
  return item;
}

export async function getItem(env: Env, itemId: string): Promise<{ id: string; fieldData: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items/${itemId}`, {
    headers: authHeaders(env),
  });
  if (!res.ok) {
    throw new Error(`Webflow item fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Publishing changed in Webflow's API around the v2 transition; some site
 * plans require a follow-up site-publish call rather than (or in addition
 * to) this item-publish endpoint. Verify against the live collection once
 * it exists — if items save but don't go live, this is the first place to
 * check.
 */
export async function publishItems(env: Env, itemIds: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items/publish`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({ itemIds }),
  });
  if (!res.ok) {
    throw new Error(`Webflow item publish failed: ${res.status} ${await res.text()}`);
  }
}
