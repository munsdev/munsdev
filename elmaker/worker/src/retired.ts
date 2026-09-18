/* The editor has moved into the ElectionLog team hub and this deployment no
   longer makes graphics. What is left is a notice and a read-only door.

   The notice is served without the password, on purpose: it says only that a
   tool moved and where to, and anyone still holding the bookmark should be
   able to find out without first remembering a password they no longer need.

   The graphics themselves stay behind the gate, and the D1 rows and R2 objects
   are untouched. They have not been copied into the hub yet, so this is still
   the only copy of the campaign's 50 finished graphics -- see "What is built,
   and what is not" in the hub's README for what moving them involves. Do not
   delete the database or the bucket until that has run. */

export const MOVED_TO = "https://team.electionlog.org/social/";

export function retiredPage(): Response {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Moved — ElectionLog Graphic Maker</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:#121A24;color:#fff;
    font:500 16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{width:100%;max-width:420px}
  h1{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#E9A81C;margin:0 0 4px}
  p{margin:0 0 16px;color:#9aa4b0;font-size:14px}
  a.go{display:block;margin-top:20px;padding:12px 14px;text-align:center;text-decoration:none;
    font:600 16px/1 inherit;color:#121A24;background:#E9A81C;border-radius:8px}
  a.go:hover{background:#f4b52e}
  .small{font-size:13px;color:#7F8C99}
  b{color:#fff;font-weight:600}
</style></head><body>
<main>
  <h1>ElectionLog</h1>
  <p>The graphic maker has moved into the team hub. It is the
     <b>Social media content</b> tool there, and it signs
     you in with your email address instead of the shared password.</p>
  <p class="small">Graphics already saved here have not been moved across yet.
     Ask Casey if you need one of them.</p>
  <a class="go" href="${MOVED_TO}">Open the team hub</a>
</main></body></html>`;
  return new Response(html, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

/* Nothing here writes any more. A refusal rather than a quiet no-op, so a
   script still pointed at this deployment fails where it can be seen. */
export function retiredWrite(): Response {
  return new Response(
    JSON.stringify({ error: "This tool has moved", moved_to: MOVED_TO }),
    { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
