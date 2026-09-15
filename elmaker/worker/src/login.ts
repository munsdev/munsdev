/* The gate page. Deliberately self-contained and tiny: it is the only thing
   served to someone who has not proved they know the password, so it shares
   no code, no fonts and no state with the app itself. */
export function loginPage(failed: boolean): Response {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>ElectionLog Graphic Maker</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:#121A24;color:#fff;
    font:500 16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  form{width:100%;max-width:320px}
  h1{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#E9A81C;margin:0 0 4px}
  p{margin:0 0 20px;color:#9aa4b0;font-size:14px}
  label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#9aa4b0;margin-bottom:6px}
  input{width:100%;padding:12px 14px;font:inherit;color:#fff;background:#0b1118;
    border:1px solid #2a3543;border-radius:8px}
  input:focus{outline:2px solid #E9A81C;outline-offset:1px;border-color:transparent}
  button{width:100%;margin-top:12px;padding:12px 14px;font:600 16px/1 inherit;
    color:#121A24;background:#E9A81C;border:0;border-radius:8px;cursor:pointer}
  button:hover{background:#f4b52e}
  .err{margin:12px 0 0;color:#ff9b9b;font-size:14px}
</style></head><body>
<form method="POST" action="/login">
  <h1>ElectionLog</h1>
  <p>Graphic maker. Internal tool.</p>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Enter</button>
  ${failed ? '<p class="err">That is not the password.</p>' : ""}
</form></body></html>`;
  return new Response(html, {
    status: failed ? 401 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
