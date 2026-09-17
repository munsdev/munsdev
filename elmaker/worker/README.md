# socialmaker — the Worker behind the graphic maker

> **Closed.** The graphic maker moved into the ElectionLog team hub and is the
> *Social media content* tool at `team.electionlog.org/social/`. This Worker no
> longer serves the app: it answers with a notice (`src/retired.ts`), refuses
> every write with a 410, and keeps the password gate over the reads a
> migration needs — `/api/state`, `/api/collections`,
> `/api/collections/<id>/graphics`, `/api/graphics/<id>`, `/r/…`, `/img/…` and
> `/thumb/…`.
>
> **The D1 database and the R2 bucket still hold the only copy of the 50
> finished graphics.** They have not been copied into the hub. Do not delete
> them. Once they have been, this Worker and its resources can go in one step;
> until then this is an archive with the door locked and the lights off.
>
> `api.ts`, `images.ts` and `library.ts` still carry their write functions.
> Nothing routes to them any more — they are left because a migration will
> want to read through the same shapes, and deleting them would only make that
> harder.


The graphic maker used to be one HTML file with no network at all. It now has
a server, because photos could not survive a reload without one. Everything it
talks to is same-origin; no third-party host appears anywhere.

## Shape

```
socialmaker.muns.dev
├─ /login       the only route that is not behind the password
├─ /            the app (compiled into the Worker bundle as a text module)
├─ /api/*       D1: the project row, the items, the image index
└─ /img|thumb/  R2 bytes, proxied rather than served from a public bucket
```

## The password

One shared password gates the whole thing. `/login` compares it in constant
time against the `GATE_PASSWORD` secret and sets an HttpOnly, Secure,
SameSite=Lax cookie holding `<expiry>.<hmac>` signed with `GATE_SECRET`. The
token is stateless, so there is no KV round trip on every request, and it
cannot be forged without the secret.

What this buys, precisely: the site will not be found, indexed or casually
used. It is not access control. There is no per-person revocation and no audit
trail, and a campaign password leaks eventually. If that ever matters, put
Cloudflare Access in front of it — no app code has to change.

The image routes are behind the gate too. Gating only the page would leave
every photo and every line of unapproved copy readable to anyone who guessed
a URL.

## Images

Content-addressed: the sha256 of the downscaled bytes is the key, so the same
photo used on six graphics is one object. The client hashes first and asks
`GET /api/have/<sha>` before uploading, so a repeat costs one small request.
The Worker recomputes the digest and rejects a mismatch.

Bytes are proxied through the Worker rather than served from a public bucket.
That keeps the password meaningful, keeps `img-src` at `'self'`, and — because
the images stay same-origin — leaves `canvas.toBlob()` untainted. A
cross-origin image would make the export throw and take the whole zip with it.

## Deploying

```
cd ..      && node build.mjs     # writes worker/src/page.html
cd worker  && npx wrangler deploy
```

The page is compiled into the Worker bundle rather than served from an assets
binding: one artifact, one deploy, nothing to get out of step with the code
that serves it. `build.mjs` must run first — `src/page.html` is generated and
is not in git.

First-time setup (already done for the live Worker):

```
npx wrangler d1 execute socialmaker-db --remote --file=./schema.sql
npx wrangler secret put GATE_PASSWORD
npx wrangler secret put GATE_SECRET      # 32 random bytes, hex
```

## Running the tests

The app needs a server now, so the tests drive a real one:

```
cd worker && npx wrangler dev --port 8787     # leave running
cd ..     && node audit-func.mjs              # and the rest
```

`testlib.mjs` logs in through the real gate and wipes the **local** D1 between
runs, so each starts on an empty database and the app seeds its 46 lines.
`SM_BASE` points the tests somewhere else if needed.
