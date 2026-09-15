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

/* Wipe the local D1 so each run starts on an empty database and the app
   seeds its 46 lines, the way it did when state lived in localStorage.
   --local is deliberate: this must never be pointed at the real database. */
export function resetDb() {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'socialmaker-db', '--local', '-y',
    '--command', 'DELETE FROM items; DELETE FROM projects; DELETE FROM images;'],
    { cwd: 'worker', stdio: 'pipe', env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || 'proxy-injected' } });
}

export async function assertServer() {
  try {
    const r = await fetch(BASE + '/login');
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
  await p.waitForSelector('body.ready', { timeout: 15000 });
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
