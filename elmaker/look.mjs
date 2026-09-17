/* The viewport sweep. Not a test -- it makes pictures to LOOK at, which is
   the only way some things (a button under the tab bar, a card at the wrong
   aspect, a column of empty black) ever get noticed.

     node look.mjs            all six viewports -> /tmp/look
     node look.mjs ip14 se    just those

   Each viewport runs the whole arc: home, every panel, a photo, a save, the
   library, one graphic. resetDb() first, so it needs a local dev server. */
import { chromium } from 'playwright';
import fs from 'fs';
import { CHROMIUM, openApp, resetDb, testPhoto } from './testlib.mjs';

const VPS = {
  desk: [1440, 900], lap: [1280, 800], tab: [820, 1180],
  ip14: [390, 844],  se: [375, 667],   land: [844, 390],
};
const want = process.argv.slice(2).filter(a => VPS[a]);
const pick = want.length ? want : Object.keys(VPS);
const OUT = '/tmp/look';
fs.mkdirSync(OUT, { recursive: true });

resetDb();
const b = await chromium.launch({ executablePath: CHROMIUM });
for (const tag of pick) {
  const [width, height] = VPS[tag];
  const p = await b.newPage({ viewport: { width, height } });
  p.on('filechooser', async fc => { try { await fc.setFiles([]) } catch (e) {} });
  await openApp(p);
  const shot = n => p.screenshot({ path: `${OUT}/${tag}-${n}.png` });

  await shot('1home');
  await p.evaluate(() => startGraphic(true)); await p.waitForTimeout(500);
  await shot('2editor');
  for (const pan of ['text', 'layout', 'photo', 'library', 'export']) {
    await p.evaluate(x => showPanel(x), pan); await p.waitForTimeout(250);
    await shot('3' + pan);
  }
  await p.evaluate(() => showPanel('photo')); await p.waitForTimeout(200);
  const ch = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]).then(r => r[0]);
  await ch.setFiles(testPhoto()); await p.waitForTimeout(2600);
  await shot('4photo-in');
  await p.evaluate(async () => {
    const c = await (await api('/api/collections', { method: 'POST', ...asJson({ name: 'See It, Log It' }) })).json();
    COLLECTIONS.push({ ...c, count: 0 }); fillCollections();
    document.getElementById('fCollection').value = c.id;
  });
  await p.evaluate(() => showPanel('library')); await p.waitForTimeout(200);
  await p.click('#btnSaveLib');
  await p.waitForFunction(() => /Saved\.|ould not/.test(document.getElementById('libStatus').textContent),
                          null, { timeout: 120000 });
  await p.waitForTimeout(1800);
  await shot('5lib-collection');
  await p.locator('#libWrap .gcard').first().click().catch(() => {}); await p.waitForTimeout(1200);
  await shot('6lib-graphic');
  await p.click('#libBack').catch(() => {}); await p.waitForTimeout(400);
  await p.click('#libBack').catch(() => {}); await p.waitForTimeout(600);
  await shot('7lib-home');
  await p.close();
  console.log('done ' + tag);
}
await b.close();
