/* Shared harness. The app is no longer a file you can open: it needs the
   Worker for its state, so every test drives a real server.

   Start one first, in ./worker:   npx wrangler dev --port 8787
   then run the tests from here.   SM_BASE overrides the address. */
import { execFileSync } from 'child_process';
import fs from 'fs';
import zlib from 'zlib';

export const BASE = process.env.SM_BASE || 'http://127.0.0.1:8787';
export const PASSWORD = process.env.SM_PASSWORD || 'VOTE';
export const CHROMIUM = '/opt/pw-browsers/chromium';

/* Reaching a remote SM_BASE from a sandboxed session means going through the
   egress proxy. Node's built-in fetch and Chromium both ignore HTTPS_PROXY
   unless told, and localhost must bypass it or wrangler dev is unreachable. */
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const REMOTE = !/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(BASE);
/* The egress proxy re-terminates TLS, so Chromium sees its CA and not the
   real one. Rather than turning verification off, pin that single CA by its
   public-key hash: every other certificate is still checked normally.
   SM_PROXY_CA_SPKI overrides it if the CA is ever rotated. */
const CA_SPKI = process.env.SM_PROXY_CA_SPKI || 'KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=';
export const launchOpts = (PROXY && REMOTE)
  ? {
      executablePath: CHROMIUM,
      proxy: { server: PROXY, bypass: 'localhost,127.0.0.1' },
      args: ['--ignore-certificate-errors-spki-list=' + CA_SPKI],
    }
  : { executablePath: CHROMIUM };

/* Wipe the local D1 so each run starts empty -- the library included.
   Leaving collections behind made runs depend on each other: a save would
   succeed unexpectedly, open the library overlay, and every later click in
   that run would fail against an overlay nobody asked for.
   --local is deliberate: this must never be pointed at the real database. */
export function resetDb() {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'socialmaker-db', '--local', '-y',
    '--command', 'DELETE FROM items; DELETE FROM projects; DELETE FROM images; ' +
                 'DELETE FROM graphics; DELETE FROM collections;'],
    { cwd: 'worker', stdio: 'pipe', env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || 'proxy-injected' } });
}

export async function assertServer() {
  try {
    const r = await fetch(BASE + '/login', PROXY && REMOTE ? { dispatcher: undefined } : undefined);
    if (!r.ok) throw new Error(String(r.status));
  } catch (e) {
    console.error('No server at ' + BASE + '. Start one: cd worker && npx wrangler dev --port 8787');
    process.exit(1);
  }
}

/** Log in through the real gate, then wait for the app to finish booting. */
export async function openApp(p, { clearLocal = true } = {}) {
  await p.goto(BASE + '/login');
  await p.fill('#p', PASSWORD);
  await Promise.all([p.waitForURL(u => !String(u).includes('/login')), p.click('button[type=submit]')]);
  if (clearLocal) {
    await p.evaluate(() => localStorage.clear());
    await p.reload();
  }
  /* A cold Worker plus a font fetch can take a while on the first hit; a
     local dev server never does. */
  await p.waitForSelector('body.ready', { timeout: REMOTE ? 45000 : 15000 });
  await p.waitForTimeout(400);
  return p;
}

/* A photo to drop on the canvas. Generated rather than committed so the
   repo carries no stray binary, and big enough (2400px) that the upload
   path actually exercises the downscale to MAXPX. */
export function testPhoto() {
  const path = '/tmp/socialmaker-testphoto.png';
  if (fs.existsSync(path)) return path;
  const w = 2400, h = 1600;
  const row = (y) => {
    const px = [];
    for (let x = 0; x < w; x++) {
      px.push((x * 255 / w) | 0, (y * 255 / h) | 0, ((x ^ y) & 0xff));
    }
    return Buffer.from([0, ...px]);
  };
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => row(y)));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
  return path;
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Put graphics on the bench without going through the UI.
 *
 * The maker is one graphic at a time now, so there is no longer a button
 * that loads 46 lines. The renderer tests still need a populated bench --
 * they are testing drawing and geometry, not the create flow -- so they seed
 * it directly. hometest.mjs is what covers the real create flow.
 */
export async function bench(p, n = 1) {
  await p.evaluate((count) => {
    S.items = ALL_LINES.slice(0, count).map(([a, b]) => newItem(a, b));
    S.sel = S.items[0].id;
    /* The renderer and geometry suites need every layout reachable: they are
       testing drawing, not the photo question. The create flow's filtering is
       hometest.mjs's job. */
    if (typeof limitVariants === 'function') limitVariants(true);
    document.querySelectorAll('#segVariant button').forEach(b => { b.hidden = false; });
    const pb = document.getElementById('photoBlock'); if (pb) pb.hidden = false;
    const tb = document.getElementById('tuneBlock'); if (tb) tb.hidden = false;
    const home = document.getElementById('home');
    if (home) home.hidden = true;
    commit();
  }, n);
  /* save() debounces by 800ms. A suite that seeds the bench and reloads
     inside that window reloads into an EMPTY bench -- which opens the home
     overlay and makes every later click land on it instead of the app. Wait
     for the push to be confirmed (LAST is the server's last word) rather
     than guessing at a sleep. */
  await p.waitForFunction((count) => LAST.size === count, n, { timeout: 20000 });
  await p.waitForTimeout(150);
}
