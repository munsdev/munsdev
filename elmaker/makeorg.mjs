/* Make the four "To organizations" graphics.
 *
 *   SM_BASE=https://socialmaker.muns.dev node makeorg.mjs
 *
 * It drives the app's own save path, so these are ordinary graphics: the
 * recipe is stored, all three sizes render, alt text is written. Re-running
 * skips any line already in the collection.
 */
import { chromium } from 'playwright';
import { launchOpts, openApp, assertServer } from './testlib.mjs';

const LINES = [
  ['ALREADY WATCHING?',   'SEND US THE LOG.'],
  ['NO REPORTING SYSTEM?', 'USE OURS.'],
  ['KNOW AN OBSERVER?',   'SEND THEM OUR WAY.'],
  ['ALREADY FILING REPORTS?', 'LOG IT TOO.'],
];
const INTO = 'To organizations';

await assertServer();
const b = await chromium.launch(launchOpts);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', e => console.error('  page error:', e.message));
await openApp(p);

const plan = await p.evaluate(async ({ name, lines }) => {
  const cols = (await (await api('/api/collections')).json()).collections || [];
  const col = cols.find(c => c.name === name);
  if (!col) return { error: 'no collection named "' + name + '"' };
  const have = new Set(((await (await api('/api/collections/' + col.id + '/graphics')).json()).graphics || [])
    .map(g => (g.title || '').trim()));
  return { col, todo: lines.filter(([top]) => !have.has(top)), skipped: lines.filter(([top]) => have.has(top)).length };
}, { name: INTO, lines: LINES });

if (plan.error) { console.error(plan.error); await b.close(); process.exit(1); }
console.log(`collection : ${plan.col.name}`);
console.log(`already in : ${plan.skipped}`);
console.log(`to make    : ${plan.todo.length}`);

let made = 0; const failed = [];
for (const [top, bot] of plan.todo) {
  const r = await p.evaluate(async ({ top, bot, cid }) => {
    try {
      /* These are type-only: the outreach set carries no photography. */
      const it = { ...newItem(top, bot), variant: 'type', align: 'center' };
      S.items = [it]; S.sel = it.id; S.withPhoto = false;
      const res = await saveToLibrary(it, cid);
      S.items = []; S.sel = null;
      return { ok: true, sizes: res.sizes.length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, { top, bot, cid: plan.col.id });
  if (r.ok) { made++; console.log(`  ok   ${top} / ${bot}  (${r.sizes} sizes)`); }
  else { failed.push(top); console.log(`  FAIL ${top}  ${r.error}`); }
}
console.log(`\nmade ${made} of ${plan.todo.length}`);
await b.close();
process.exit(failed.length ? 1 : 0);
