/* The CSP is now set by the Worker, not a _headers file, so this test reads
   it off a real response instead of parsing config. It exists to prove that
   exports still download under it -- that is the thing a tightened policy
   silently breaks. */
import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer } from './testlib.mjs';
await assertServer(); resetDb();

/* The tool talks to its own origin and nowhere else. If a directive here
   ever needs a third-party host, something is pulling in code from outside
   and that is the bug, not the policy -- see HANDOFF section 8. */
const MUST_HAVE = [
  "default-src 'none'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
];

const b = await chromium.launch({ executablePath: CHROMIUM });
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const viol = [], errs = [];
p.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) viol.push(t); });
p.on('pageerror', e => errs.push(e.message));

await openApp(p);

const csp = await p.evaluate(async () => (await fetch('/', { credentials: 'same-origin' })).headers.get('content-security-policy'));
console.log('CSP served:', csp);
let bad = 0;
for (const d of MUST_HAVE) {
  const ok = csp && csp.includes(d);
  if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'FAIL ') + 'directive: ' + d);
}
/* A host that is not us has no business in here. */
const foreign = (csp || '').match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s;]+/g);
console.log((foreign ? 'FAIL ' : 'PASS ') + 'no third-party hosts' + (foreign ? ' [' + foreign + ']' : ''));
if (foreign) bad++;

console.log('fonts loaded:', await p.evaluate(() => document.fonts.check('400 40px "ElectionLog Display"')));

await p.click('.tab[data-p=list]'); await p.waitForTimeout(180);
await p.click('#btnSeed'); await p.waitForTimeout(400);
await p.evaluate(() => { S.items = S.items.slice(0, 2); commit(); });

const dl = p.waitForEvent('download', { timeout: 60000 });
await p.click('.tab[data-p=export]'); await p.waitForTimeout(150);
await p.click('#btnExport');
const d = await dl; await d.saveAs('/tmp/csp.zip');
console.log('zip download under CSP:', d.suggestedFilename());

const dl2 = p.waitForEvent('download', { timeout: 30000 });
await p.click('#btnOne');
console.log('png download under CSP:', (await dl2).suggestedFilename());

console.log('CSP violations:', viol.length ? viol : 'none');
console.log('errors:', errs.length ? errs : 'none');
console.log('FAILURES:', bad);
await b.close();
