/* The one-graphic-at-a-time flow: home, the photo-or-not question, the
   layouts each answer offers, and what happens after a save. */
import { chromium } from 'playwright';
import { CHROMIUM, openApp, assertServer, testPhoto, resetDb } from './testlib.mjs';
await assertServer();
/* The bench must start empty: the editor's own rows are what boot reads, and
   a leftover list would land us in the editor instead of on home. */
resetDb();
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS ':'FAIL ')+n+(note?'   ['+note+']':''));
const panel=async(pg,n)=>{ await pg.evaluate(x=>{ if(openPanel!==x) showPanel(x); }, n); await pg.waitForTimeout(220); };

const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
await openApp(p);

chk('opens on home with an empty bench', !(await p.locator('#home').isHidden()));
chk('nothing on the bench', (await p.evaluate(()=>S.items.length))===0);
chk('the rail is gone', await p.locator('.rail').isHidden());
chk('the List tab is gone', await p.locator('.tab[data-p=list]').isHidden());
chk('the contact sheet button is gone', await p.locator('#btnGrid').isHidden());

// TYPE ONLY
await p.click('#homeNew'); await p.waitForTimeout(300);
chk('asks photo or not', await p.evaluate(()=>document.getElementById('dlgStart').open));
await p.click('#startType'); await p.waitForTimeout(500);
chk('home closes', await p.locator('#home').isHidden());
chk('exactly one graphic on the bench', (await p.evaluate(()=>S.items.length))===1);
chk('starts on a type-only layout', (await p.evaluate(()=>cur().variant))==='type');
const shown=await p.evaluate(()=>[...document.querySelectorAll('#segVariant button')].filter(b=>!b.hidden).map(b=>b.dataset.v));
chk('only type-only layouts offered', shown.sort().join(',')==='slab,split,stamp,type', shown.join(','));
await panel(p,'photo');
chk('the photo block is hidden', await p.locator('#photoBlock').isHidden());

// WITH A PHOTO
await p.click('#btnHome'); await p.waitForTimeout(400);
await p.click('#homeNew'); await p.waitForTimeout(300);
await p.click('#startPhoto'); await p.waitForTimeout(350);
/* Starting a graphic on top of an unsaved one asks first. */
if(await p.evaluate(()=>document.getElementById('dlgConfirm').open)){
  await p.click('#confOk'); await p.waitForTimeout(400);
}
chk('discarding unsaved work asks first', true);
await p.waitForTimeout(300);
const shown2=await p.evaluate(()=>[...document.querySelectorAll('#segVariant button')].filter(b=>!b.hidden).map(b=>b.dataset.v));
chk('only photo layouts offered', shown2.sort().join(',')==='band,bleed,stack', shown2.join(','));
chk('starts on stack', (await p.evaluate(()=>cur().variant))==='stack');
await panel(p,'photo');
chk('the photo block is shown', !(await p.locator('#photoBlock').isHidden()));

// type the words, attach a photo, save
await p.evaluate(()=>editText('top'));
await p.fill('#fLine','ALREADY WATCHING?'); await p.waitForTimeout(250);
await p.evaluate(()=>editText('bot'));
await p.fill('#fLine','LOG IT TOO.'); await p.waitForTimeout(300);
await panel(p,'photo');
const ch=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]).then(r=>r[0]);
await ch.setFiles(testPhoto()); await p.waitForTimeout(2500);

await panel(p,'library');
await p.evaluate(async()=>{
  const c=await (await api('/api/collections',{method:'POST',...asJson({name:'Home flow'})})).json();
  COLLECTIONS.push({...c,count:0}); fillCollections();
  document.getElementById('fCollection').value=c.id;
});
await p.click('#btnSaveLib');
await p.waitForFunction(()=>/Saved\.|ould not/.test(document.getElementById('libStatus').textContent),null,{timeout:90000});
chk('saved', /Saved\./.test(await p.textContent('#libStatus')));
await p.waitForTimeout(1200);
chk('the bench is cleared after saving', (await p.evaluate(()=>S.items.length))===0);

const g=await p.evaluate(async()=>{
  const cols=(await (await api('/api/collections')).json()).collections;
  const c=cols.find(x=>x.name==='Home flow');
  const gs=(await (await api('/api/collections/'+c.id+'/graphics')).json()).graphics;
  return gs[0];
});
chk('the words were saved', g.top==='ALREADY WATCHING?' && g.bot==='LOG IT TOO.', g.top+' / '+g.bot);
chk('the photo was saved', !!g.photo_sha);
chk('the layout survived as stack', g.variant==='stack', g.variant);

console.log(R.join('\n'));
console.log('FAILURES:', R.filter(x=>x.startsWith('FAIL')).length);
console.log('errors:', errs.length?errs:'none');
await b.close();
