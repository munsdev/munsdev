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

// The keys on `uploadDetails` are camelCase (e.g. xAmzAlgorithm), but S3
// requires the real multipart field names below. Confirmed against a live
// upload -- sending the camelCase keys as-is gets silently rejected by S3
// and was the cause of every /submit failing.
const S3_FORM_FIELD_NAMES: Record<string, string> = {
  acl: "acl",
  bucket: "bucket",
  xAmzAlgorithm: "X-Amz-Algorithm",
  xAmzCredential: "X-Amz-Credential",
  xAmzDate: "X-Amz-Date",
  key: "key",
  policy: "Policy",
  xAmzSignature: "X-Amz-Signature",
  successActionStatus: "success_action_status",
  contentType: "Content-Type",
  cacheControl: "Cache-Control",
};

/**
 * Uploads a photo to Webflow's Assets API and returns the hosted URL to
 * reference from a CMS item's Image field (Image fields take `{ url }`,
 * confirmed against the live API -- `{ fileId }` is rejected with a
 * validation error).
 */
export async function uploadPhotoAsset(
  env: Env,
  fileBuffer: ArrayBuffer,
  fileName: string,
  contentType: string
): Promise<{ hostedUrl: string }> {
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
    const fieldName = S3_FORM_FIELD_NAMES[key] ?? key;
    uploadForm.append(fieldName, value);
  }
  uploadForm.append("file", new Blob([fileBuffer], { type: contentType }), fileName);

  const uploadRes = await fetch(asset.uploadUrl, { method: "POST", body: uploadForm });
  if (!uploadRes.ok) {
    throw new Error(`Asset upload to storage failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  return { hostedUrl: asset.hostedUrl };
}

export interface EntryFields {
  photoUrl?: string;
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
  if (fields.photoUrl) {
    fieldData[env.PHOTO_FIELD_SLUG] = { url: fields.photoUrl };
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

export async function createItem(env: Env, fields: EntryFields): Promise<{ id: string; slug: string }> {
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
  const item = (await res.json()) as { id: string; fieldData: { slug: string } };
  await publishItems(env, [item.id]);
  return { id: item.id, slug: item.fieldData.slug };
}

/** Resolves a CMS item's public slug to its internal item id. */
async function getItemIdBySlug(env: Env, slug: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items?slug=${encodeURIComponent(slug)}`,
    { headers: authHeaders(env) }
  );
  if (!res.ok) {
    throw new Error(`Webflow item lookup failed: ${res.status} ${await res.text()}`);
  }
  const { items } = (await res.json()) as { items: { id: string }[] };
  if (items.length === 0) {
    throw new Error(`No item found with slug "${slug}"`);
  }
  return items[0].id;
}

export async function updateItem(env: Env, slug: string, fields: EntryFields): Promise<{ id: string; slug: string }> {
  const itemId = await getItemIdBySlug(env, slug);
  const existing = await getItemById(env, itemId);
  const { name, slug: existingSlug } = existing.fieldData as { name: string; slug: string };
  const res = await fetch(`${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items/${itemId}`, {
    method: "PATCH",
    headers: authHeaders(env),
    body: JSON.stringify({ fieldData: toFieldData(env, fields, name, existingSlug) }),
  });
  if (!res.ok) {
    throw new Error(`Webflow item update failed: ${res.status} ${await res.text()}`);
  }
  const item = (await res.json()) as { id: string; fieldData: { slug: string } };
  await publishItems(env, [item.id]);
  return { id: item.id, slug: item.fieldData.slug };
}

async function getItemById(env: Env, itemId: string): Promise<{ id: string; fieldData: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/collections/${env.WEBFLOW_COLLECTION_ID}/items/${itemId}`, {
    headers: authHeaders(env),
  });
  if (!res.ok) {
    throw new Error(`Webflow item fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getItem(env: Env, slug: string): Promise<{ id: string; fieldData: Record<string, unknown> }> {
  const itemId = await getItemIdBySlug(env, slug);
  return getItemById(env, itemId);
}

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
