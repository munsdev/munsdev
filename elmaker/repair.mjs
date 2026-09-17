/* One-off repair of the production library, run once on 2026-09-17.
 *
 *   SM_BASE=https://socialmaker.muns.dev node repair.mjs
 *
 * Three things went wrong while the library was being built, all of them
 * visible in the collection once the browser started showing designs:
 *
 *   1. Test runs pointed at production left a stray "LONG LINE?" graphic in
 *      See It, Log It. It was the newest row, so it became the collection's
 *      cover.
 *   2. The same runs restyled four real graphics into another brand. Brand
 *      styles are gone, so those four were the only things in the library
 *      not in the house style.
 *   3. POWER OUT? / LOG IT. never made it through the migration: 45 of the
 *      campaign's 46 lines were there.
 *
 * It is safe to re-run: each step checks first and does nothing if the
 * library is already right.
 */
import { chromium } from 'playwright';
import { launchOpts, openApp, assertServer } from './testlib.mjs';

const COLLECTION = 'See It, Log It';
const MISSING = ['POWER OUT?', 'LOG IT.'];

await assertServer();
const b = await chromium.launch(launchOpts);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', e => console.error('  page error:', e.message));
await openApp(p);

const load = () => p.evaluate(async (name) => {
  const cols = (await (await api('/api/collections')).json()).collections || [];
  const col = cols.find(c => c.name === name);
  if (!col) return { error: 'no collection named "' + name + '"' };
  const graphics = (await (await api('/api/collections/' + col.id + '/graphics')).json()).graphics || [];
  return { col, graphics };
}, COLLECTION);

let { col, graphics, error } = await load();
if (error) { console.error(error); await b.close(); process.exit(1); }
console.log(`${col.name}: ${graphics.length} graphics`);

/* 1. the stray. The real LONG LINE? is the campaign's first line and sits at
      rev 1; the test one is the one that was restyled. */
const strays = graphics.filter(g => g.top === 'LONG LINE?' && (g.rev || 1) > 1);
for (const g of strays) {
  const r = await p.evaluate(id => api('/api/graphics/' + id, { method: 'DELETE' }).then(x => x.status), g.id);
  console.log(`  deleted stray ${g.id} (${r})`);
}
if (!strays.length) console.log('  no stray to delete');

/* 2. the four in the wrong style. Re-render every size and commit rev+1:
      the old renders keep serving until the whole set has landed. */
({ col, graphics } = await load());
const offBrand = graphics.filter(g => (g.rev || 1) > 1);
for (const g of offBrand) {
  const r = await p.evaluate(async (g) => {
    try {
      const it = { ...newItem(g.top, g.bot), id: g.id, variant: g.variant, align: g.align,
                   img: g.photo_sha, scrim: g.scrim, zoom: 100, fx: 50, fy: 50 };
      if (g.photo_sha && !S.images[g.photo_sha]) S.images[g.photo_sha] = '/img/' + g.photo_sha;
      if (!await ensurePhoto(it)) throw new Error('photo missing');
      const renders = await renderAll(it, SIZES, g.per_size);
      const rev = (g.rev || 1) + 1;
      for (const r of renders) {
        await api('/api/graphics/' + g.id + '/renders/' + rev + '/' + r.size,
                  { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: r.blob });
      }
      await api('/api/graphics/' + g.id + '/finish',
                { method: 'POST', ...asJson({ sizes: renders.map(r => r.size), rev }) });
      return { ok: true, rev };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, g);
  console.log(r.ok ? `  redrawn in the house style: ${g.title} (rev ${r.rev})`
                   : `  FAILED ${g.title}: ${r.error}`);
}
if (!offBrand.length) console.log('  everything already in the house style');

/* 3. the line that never landed. */
({ col, graphics } = await load());
if (graphics.some(g => g.top === MISSING[0])) {
  console.log(`  ${MISSING[0]} is already there`);
} else {
  const r = await p.evaluate(async ({ top, bot, cid }) => {
    try {
      const it = { ...newItem(top, bot), variant: 'type', align: 'center' };
      S.items = [it]; S.sel = it.id; S.withPhoto = false;
      const res = await saveToLibrary(it, cid);
      S.items = []; S.sel = null;
      return { ok: true, sizes: res.sizes.length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, { top: MISSING[0], bot: MISSING[1], cid: col.id });
  console.log(r.ok ? `  made ${MISSING[0]} (${r.sizes} sizes)` : `  FAILED ${MISSING[0]}: ${r.error}`);
}

({ col, graphics } = await load());
console.log(`\n${col.name}: ${graphics.length} graphics, ` +
            `${graphics.filter(g => (g.sizes || []).length === 3).length} with all three sizes`);
await b.close();
