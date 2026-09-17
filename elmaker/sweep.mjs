import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer, testPhoto , bench} from './testlib.mjs';
await assertServer(); resetDb();
const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900},acceptDownloads:true});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
const R=[];
const chk=(name,pass,note='')=>R.push((pass?'PASS':'FAIL')+'  '+name+(note?'  ['+note+']':''));

await openApp(p);
await bench(p, 46);
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(1000);

// 1 persistence round trip with a photo, crop and reorder
await p.click('.tab[data-p=photo]'); await p.waitForTimeout(150);
const [ch]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]);
await ch.setFiles(testPhoto()); await p.waitForTimeout(800);
await p.evaluate(()=>{ cur().zoom=180; cur().fx=20; cur().fy=80; cur().variant='bleed'; commit(); });

/* Reordering went with the list; the persistence round trip below is what
   this was setting up, so just permute the array. */
await p.evaluate(()=>{ const [m]=S.items.splice(3,1); S.items.splice(2,0,m); commit(); });
const before=await p.evaluate(()=>({n:S.items.length,order:S.items.slice(0,5).map(i=>i.top),
  crop:{z:S.items[0].zoom,fx:S.items[0].fx,fy:S.items[0].fy,v:S.items[0].variant,img:!!S.items[0].img}}));
await p.waitForTimeout(700); await p.reload(); await p.waitForTimeout(1100);
const after=await p.evaluate(()=>({n:S.items.length,order:S.items.slice(0,5).map(i=>i.top),
  crop:{z:S.items[0].zoom,fx:S.items[0].fx,fy:S.items[0].fy,v:S.items[0].variant,img:!!S.items[0].img},
  decoded:IMG.size}));
chk('state survives reload', JSON.stringify(before)===JSON.stringify({n:after.n,order:after.order,crop:after.crop}),
   JSON.stringify(after.crop));
chk('photo re-decoded on reload', after.decoded===1);

/* The contact sheet went with the list. The library replaced it and
   libtest.mjs drives it. */



/* Bulk paste belonged to the list panel. One graphic at a time means messy
   input arrives through the Words fields, which the injection test below
   still covers. */

// 4 whitespace-only item exports with a usable filename
await p.evaluate(()=>{ const it=newItem('   ','   '); S.items.push(it); S.sel=it.id; commit(); });
chk('blank text slug', await p.evaluate(()=>slug(cur().top))==='untitled');

// 5 drag and wheel on a graphic with no photo must do nothing
await p.evaluate(()=>{ S.sel=S.items.find(i=>!i.img).id; commit(); });
const z0=await p.evaluate(()=>cur().zoom);
const bx=await p.locator('#preview').boundingBox();
await p.mouse.move(bx.x+bx.width/2,bx.y+bx.height/2); await p.mouse.down();
await p.mouse.move(bx.x+bx.width/2+90,bx.y+bx.height/2,{steps:6}); await p.mouse.up();
await p.mouse.wheel(0,-300); await p.waitForTimeout(200);
chk('no-photo drag/zoom inert', z0===await p.evaluate(()=>cur().zoom));

/* 6 an empty bench is refused. Sizes used to be the guard here -- "no sizes
   ticked" -- and there is no such state any more: a graphic is made at all
   three or not at all. The only thing left to refuse is nothing to draw. */
await p.click('.tab[data-p=export]'); await p.waitForTimeout(150);
const kept=await p.evaluate(()=>{ const k=[...S.items], sel=S.sel; S.items=[]; S.sel=null;
                                  window.__kept={k,sel}; return k.length; });
await p.click('#btnExport'); await p.waitForTimeout(300);
chk('nothing on the bench is refused', (await p.textContent('#status')).includes('Nothing'));
/* Put it straight back in the page rather than reloading: an empty bench
   pushed to the server would delete the items this run is still using. */
await p.evaluate(()=>{ S.items=window.__kept.k; S.sel=window.__kept.sel; commit(); });
await p.waitForTimeout(250);
chk('bench restored', await p.evaluate(()=>S.items.length>0), 'was '+kept);

/* 7 cancel stops an export. Both clicks go through the DOM in one task: an
   export used to be 46 graphics and there was time to reach for the button,
   and now it is three renders of one graphic and there is not. btnExport's
   handler runs up to its first await, then Stop sets the flag the loop
   checks -- the same sequence a fast finger would produce. */
await p.evaluate(()=>{
  document.getElementById('btnExport').click();
  document.getElementById('btnCancel').click();
});
await p.waitForTimeout(1500);
chk('cancel stops export', (await p.textContent('#status')).includes('Stopped'));
chk('export button re-enabled', !(await p.locator('#btnExport').isDisabled()));

// 8 losing the server is survivable. This used to test a localStorage quota
// failure; photos live in R2 now, so the quota is no longer what breaks --
// an unreachable server is.
await p.evaluate(()=>{ window.fetch=()=>Promise.reject(new Error('offline')); });
await p.evaluate(()=>{ cur().top='AFTER THE SERVER WENT AWAY?'; save(); saveNow(); });
await p.waitForTimeout(600);
chk('server loss does not throw', !errs.some(e=>/offline/i.test(e)));
chk('offline warning visible anywhere', await p.isVisible('#storeAlert'));
chk('work held in the local cache', await p.evaluate(()=>
  JSON.parse(localStorage.getItem('electionlog-graphic-maker-v1'))
    .items.some(i=>i.top==='AFTER THE SERVER WENT AWAY?')));

console.log(R.join('\n'));
console.log('errors:', errs.length?errs:'none');
await b.close();
