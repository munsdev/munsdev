/* One-time migration: the 45 graphics that predate the library.
 *
 *   node migrate.mjs                      # against a local wrangler dev
 *   SM_BASE=https://socialmaker.muns.dev node migrate.mjs
 *
 * A migration is not a feature. It exists because creation is one graphic at
 * a time now, so there is no in-app path to bring the old editor's list
 * across, and nobody should retype 45 lines and re-crop nine photos.
 *
 * It reads the editor's own state from /api/state rather than driving the
 * editor UI, so it keeps working after the editor is reshaped. Rendering
 * goes through the page's real render() -- there is no second renderer here
 * and there must never be one.
 *
 * Safe to re-run: a graphic whose title is already in the collection is
 * skipped, so an interrupted run resumes rather than duplicating.
 */
import { chromium } from 'playwright';
import { BASE, launchOpts, openApp, assertServer } from './testlib.mjs';

const INTO = process.env.SM_COLLECTION || 'See It, Log It';
const DRY  = process.argv.includes('--dry-run');

await assertServer();
const b = await chromium.launch(launchOpts);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', e => console.error('  page error:', e.message));
await openApp(p);

const plan = await p.evaluate(async (name) => {
  const st = await (await api('/api/state')).json();
  const cols = (await (await api('/api/collections')).json()).collections || [];
  const col = cols.find(c => c.name === name);
  if (!col) return { error: 'no collection named "' + name + '"' };
  const existing = new Set(
    ((await (await api('/api/collections/' + col.id + '/graphics')).json()).graphics || [])
      .map(g => (g.title || '').trim())
  );
  const items = (st.items || []).map(it => ({
    ...it,
    title: String(it.top).replace(/\n/g, ' ').trim(),
  }));
  return {
    collection: col,
    total: items.length,
    todo: items.filter(it => !existing.has(it.title)),
    skipped: items.filter(it => existing.has(it.title)).length,
  };
}, INTO);

if (plan.error) { console.error(plan.error); await b.close(); process.exit(1); }

console.log(`collection : ${plan.collection.name}`);
console.log(`in editor  : ${plan.total}`);
console.log(`already in : ${plan.skipped}`);
console.log(`to migrate : ${plan.todo.length}`);
if (DRY || !plan.todo.length) {
  if (DRY) console.log('\n--dry-run, nothing written');
  await b.close();
  process.exit(0);
}

let done = 0;
const failed = [];
for (const it of plan.todo) {
  const r = await p.evaluate(async ({ it, cid }) => {
    try {
      /* Photos are in R2 already; point S.images at them so ensurePhoto can
         decode before rendering. Without this effVariant() downgrades stack
         to type and the whole migration renders the wrong layout, silently. */
      if (it.img && !S.images[it.img]) S.images[it.img] = '/img/' + it.img;
      const res = await saveToLibrary(it, cid);
      return { ok: true, sizes: res.sizes.length };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }, { it, cid: plan.collection.id });

  if (r.ok) { done++; console.log(`  ok   ${it.title}  (${r.sizes} sizes)`); }
  else { failed.push(it.title); console.log(`  FAIL ${it.title}  ${r.error}`); }
}

console.log(`\nmigrated ${done} of ${plan.todo.length}`);
if (failed.length) { console.log('failed:'); failed.forEach(t => console.log('  ' + t)); }
await b.close();
process.exit(failed.length ? 1 : 0);
