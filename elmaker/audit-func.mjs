import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer, testPhoto , bench} from './testlib.mjs';
await assertServer(); resetDb();
const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900},acceptDownloads:true});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS ':'FAIL ')+n+(note?'   ['+note+']':''));
const S=()=>p.evaluate(()=>({n:S.items.length,sel:S.sel,top:cur()?.top,bot:cur()?.bot,
  v:cur()?.variant,al:cur()?.align,z:cur()?.zoom,sc:cur()?.scrim,img:!!cur()?.img,
  fx:cur()?.fx,fy:cur()?.fy,pv:S.pv,sizes:{...S.sizes},g:S.guides,cap:S.caption}));
await openApp(p);
await bench(p, 46);

// header
await p.click('#btnHelp'); await p.waitForTimeout(250);
chk('Rules opens', await p.isVisible('#dlgHelp'));
await p.click('#helpClose'); await p.waitForTimeout(200);
chk('Rules closes', !(await p.isVisible('#dlgHelp')));

/* The list panel is gone: the maker is one graphic at a time, and
   hometest.mjs covers the create flow that replaced it. The bench is seeded
   directly above so the rest of this audit still exercises the renderer and
   every control that survived. */

let a;
// words
await p.click('.tab[data-p=text]'); await p.waitForTimeout(200);
await p.fill('#fTop','TOP TEST?'); await p.fill('#fBot','BOTTOM TEST.'); await p.waitForTimeout(400);
a=await S(); chk('Top line field', a.top==='TOP TEST?'); chk('Bottom line field', a.bot==='BOTTOM TEST.');

// layout
await p.click('.tab[data-p=layout]'); await p.waitForTimeout(200);
for(const v of ['bleed','band','type','stack']){
  await p.click(`#segVariant button[data-v=${v}]`); await p.waitForTimeout(160);
  chk('Layout '+v, (await S()).v===v);
}
for(const al of ['center','left']){
  await p.click(`#segAlign button[data-a=${al}]`); await p.waitForTimeout(160);
  chk('Align '+al, (await S()).al===al);
}

// photo
await p.click('.tab[data-p=photo]'); await p.waitForTimeout(200);
const [ch]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]);
await ch.setFiles(testPhoto()); await p.waitForTimeout(800);
chk('Photo drop zone', (await S()).img);
await p.evaluate(()=>{cur().variant='bleed';commit();}); await p.waitForTimeout(200);
await p.locator('#fZoom').fill('220'); await p.waitForTimeout(250);
chk('Zoom slider', (await S()).z===220);
await p.locator('#fScrim').fill('40'); await p.waitForTimeout(250);
chk('Darken slider', (await S()).sc===40);
await p.evaluate(()=>{cur().fx=10;cur().fy=90;commit();});
await p.click('#btnRecentre'); await p.waitForTimeout(250);
a=await S(); chk('Recentre', a.fx===50&&a.fy===50&&a.z===100);
await p.click('#btnFillAll'); await p.waitForTimeout(300);
chk('Use photo for all', await p.evaluate(()=>S.items.every(i=>!!i.img)));
await p.click('#toastUndo'); await p.waitForTimeout(250);
chk('Undo photo-for-all', await p.evaluate(()=>S.items.some(i=>!i.img)));
await p.locator('.lib .p .x').first().click({force:true}); await p.waitForTimeout(300);
chk('Delete image', await p.evaluate(()=>Object.keys(S.images).length===0));
await p.click('#toastUndo'); await p.waitForTimeout(300);
chk('Undo delete image', await p.evaluate(()=>Object.keys(S.images).length===1));

// sizes
await p.click('.tab[data-p=sizes]'); await p.waitForTimeout(200);
const chips=await p.$$('#sizes .chip');
await chips[2].click(); await p.waitForTimeout(200);
chk('Size chip toggles', (await S()).sizes['1080x1920']===true);
await p.click('#btnGuides'); await p.waitForTimeout(250);
chk('Guides on', (await S()).g===true);
chk('Guides label changes', (await p.textContent('#btnGuides')).includes('Hide'));
await p.click('#btnGuides'); await p.waitForTimeout(200);

// preview size switcher
for(const s of ['1080','1920','1350']){
  await p.click(`.stage-sizes .chip:text-is("${s}")`); await p.waitForTimeout(200);
  chk('Preview switch '+s, (await S()).pv.endsWith(s));
}

// nav
/* Stepping between graphics went with the list. The bar now names the one
   graphic you have open and whether it is saved. */
await p.evaluate(()=>{ S.sel=S.items[0].id; commit(); }); await p.waitForTimeout(200);
chk('Bar names the open graphic', /unsaved/.test((await p.textContent('#editingWhat')).trim()),
    (await p.textContent('#editingWhat')).trim());

/* The contact sheet went with the list: browsing is the library's job now,
   and libtest.mjs covers it. */


// export
await p.click('.tab[data-p=export]'); await p.waitForTimeout(200);
/* The caption field went with captions.txt: alt text lives on the graphic
   and is shown in the library instead. */
const d1=p.waitForEvent('download',{timeout:30000});
await p.click('#btnOne'); const f1=await d1;
chk('Just this one', /\.png$/.test(f1.suggestedFilename()), f1.suggestedFilename());
await p.click('#btnCopy'); await p.waitForTimeout(400);
chk('Copy to clipboard reports back', ((await p.textContent('#status')).length>0));
await p.evaluate(()=>{ S.items=S.items.slice(0,3); commit(); });
const d2=p.waitForEvent('download',{timeout:60000});
await p.click('#btnExport'); const f2=await d2;
await f2.saveAs('/tmp/audit.zip');
chk('Generate everything', /\.zip$/.test(f2.suggestedFilename()), await p.textContent('#status'));

console.log(R.join('\n'));
console.log('FAILURES:', R.filter(x=>x.startsWith('FAIL')).length);
console.log('errors:', errs.length?errs:'none');
await b.close();
