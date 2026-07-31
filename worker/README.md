# Poolman Worker

Cloudflare Worker that lets one authenticated person post/edit "status update"
entries (photo + date/time + rich text) into a Webflow CMS collection, without
touching Webflow's own editor. The Worker holds the Webflow API token and CMS
write logic; the front end is a single script injected into the Webflow site.

## How it fits together

- **Webflow** hosts the public page and the CMS collection (source of truth
  for displaying entries). Also hosts the trigger buttons this Worker wires
  up.
- **This Worker** hosts the login/session/upload API and serves `/client.js`,
  a small script the Webflow page loads via a `<script src="...">` tag.
- **No R2/D1.** Photos pass straight through the Worker to Webflow's Assets
  API in a single request; nothing is persisted on the Cloudflare side beyond
  short-lived session tokens in KV.

## Webflow markup contract

Three attributes, no others:

- `data-poolman-login` — the one login/logout button. Script sets its label
  and click behavior; you don't need to build anything else around it.
- `data-poolman-add` — the "new entry" button. Only present in the DOM while
  logged in (script removes/restores it).
- `data-poolman-edit="{{item's Slug}}"` — an edit button inside your
  Collection List item template, with the value bound to that item's Slug
  field via Webflow's own dynamic-data binding (not the internal item id).
  Same visibility behavior as `-add`.

Everything else (login form, upload form, rich text field, confirm step) is
built by `client.js` at runtime — nothing else to construct in Webflow.

Add this once, in Site Settings > Custom Code (footer), or on just the status
page:

```html
<script src="https://api.reflectingpool.us/client.js"></script>
```

## One-time setup

1. **KV namespace** for sessions:
   ```
   npx wrangler kv namespace create SESSIONS
   ```
   Put the returned id into `wrangler.toml` under `kv_namespaces`.

2. **Secrets**:
   ```
   npx wrangler secret put AUTH_PAIRS
   # value: admin:admin,Poolman:Washington

   npx wrangler secret put WEBFLOW_API_TOKEN
   # a Webflow API token (Site Settings > Apps & Integrations > API access)
   # scoped to CMS read/write + Assets read/write for this site
   ```

3. **Webflow config** in `wrangler.toml` `[vars]`, once the site/collection
   exist:
   - `WEBFLOW_SITE_ID`
   - `WEBFLOW_COLLECTION_ID`
   - `PHOTO_FIELD_SLUG` / `DATE_FIELD_SLUG` / `STATUS_FIELD_SLUG` — must match
     the actual field slugs in the collection (Image, Date, Rich Text fields
     respectively).

4. **DNS / route**: the Worker needs to run on a subdomain of the same zone
   Webflow serves the site on (e.g. `api.reflectingpool.us`), so the session
   cookie — scoped to `Domain=.reflectingpool.us` — is visible to both. Set
   this up as a Worker route/custom domain once the zone is on Cloudflare
   DNS.

5. **Deploy**:
   ```
   npm install
   npx wrangler deploy
   ```

## Verified against the live collection

`src/webflow.ts` was exercised directly against the real Webflow API to
confirm two things that were previously just documented guesses:

- Image fields take `{ url: "<hosted url>" }`, not `{ fileId }` -- the
  latter is rejected with a validation error.
- `POST .../items/publish` alone is sufficient to make an item live; no
  follow-up site-publish call is needed.

Also: the `uploadDetails` object from the Assets API has camelCase keys
(`xAmzAlgorithm`, etc.) that must be mapped to the real S3 multipart field
names (`X-Amz-Algorithm`, etc.) before uploading -- sending the camelCase
keys as-is gets silently rejected by S3. This was the cause of every
`/submit` failing; `uploadPhotoAsset` now does that mapping.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/client.js` | — | serves the front-end script |
| POST | `/login` | — | `{username, password}` → sets session cookie |
| POST | `/logout` | — | clears session |
| GET | `/session` | — | `{loggedIn}` |
| GET | `/item/:id` | session | fetch existing entry for the edit modal |
| POST | `/submit` | session | create a new entry (multipart: `photo`, `date`, `status`) |
| PATCH | `/submit/:id` | session | update an existing entry |

Every session-gated route re-checks the cookie server-side — the Webflow-side
attribute hiding is UX only, not the actual security boundary.
