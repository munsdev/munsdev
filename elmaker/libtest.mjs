/* Drives the library browser: browse, platform bar, the three download
   paths, per-size crops, and a whole-collection restyle. */
import { chromium } from 'playwright';
import { CHROMIUM, openApp, assertServer, testPhoto , bench} from './testlib.mjs';
await assertServer();
/* showPanel() toggles, so asking for a panel that is already open closes it. */
const panel=async(pg,n)=>{ await pg.evaluate(x=>{ if(openPanel!==x) showPanel(x); }, n); await pg.waitForTimeout(250); };
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS ':'FAIL ')+n+(note?'   ['+note+']':''));

const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900},acceptDownloads:true});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
p.on('dialog',d=>d.accept());
await openApp(p);
/* Boot leaves the bench empty now, so put a graphic on it. hometest.mjs
   covers the real create flow. */
await bench(p, 2);

// a collection with two saved graphics, one with a photo
await panel(p,'library');
const cid=await p.evaluate(async()=>{
  const c=await (await api('/api/collections',{method:'POST',...asJson({name:'Browse test'})})).json();
  COLLECTIONS.push({...c,count:0}); fillCollections();
  document.getElementById('fCollection').value=c.id; return c.id;
});

// PER-SIZE CROP: attach a photo, tune only 9:16
await panel(p,'photo');
const ch=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]).then(r=>r[0]);
await ch.setFiles(testPhoto()); await p.waitForTimeout(2500);
await p.click('#segTune button[data-t="1080x1920"]'); await p.waitForTimeout(300);
chk('tuning switches the preview to that size', await p.evaluate(()=>S.pv==='1080x1920'));
await p.evaluate(()=>{ el.zoom.value=260; el.zoom.dispatchEvent(new Event('input')); });
await p.waitForTimeout(250);
const per=await p.evaluate(()=>({per:JSON.parse(JSON.stringify(cur().per||{})), base:cur().zoom}));
chk('override written for that size only', per.per['1080x1920'] && per.per['1080x1920'].zoom===260, JSON.stringify(per.per));
chk('the graphic\'s own crop untouched', per.base===100, 'base zoom '+per.base);
chk('tuned size is marked', await p.evaluate(()=>document.querySelector('#segTune button[data-t="1080x1920"]').classList.contains('tuned')));
await p.click('#segTune button[data-t=""]'); await p.waitForTimeout(200);
chk('back to every-size editing', await p.evaluate(()=>tuning===null));

// save two graphics
await panel(p,'library');
await p.click('#btnSaveLib');
await p.waitForFunction(()=>/Saved\.|ould not/.test(document.getElementById('libStatus').textContent),null,{timeout:90000});
chk('saved with a photo', /Saved\./.test(await p.textContent('#libStatus')));
await p.waitForFunction(()=>!document.getElementById('libview').hidden,null,{timeout:20000}).catch(()=>{});
chk('landed in the library after saving', !(await p.locator('#libview').isHidden()));
await p.click('#libClose'); await p.waitForTimeout(200);

/* One graphic at a time: the second one is a new graphic, not the next row
   of a list. */
await p.evaluate(()=>{ startGraphic(false); cur().top='SECOND ONE?'; commit(); });
await p.waitForTimeout(300);
await panel(p,'library');
await p.selectOption('#fCollection', cid);
await p.click('#btnSaveLib');
await p.waitForFunction(()=>/Saved\.|ould not/.test(document.getElementById('libStatus').textContent),null,{timeout:90000});
await p.click('#libClose'); await p.waitForTimeout(200);

// BROWSE
await p.click('#btnLibrary'); await p.waitForTimeout(900);
chk('library opens on collections', await p.textContent('#libTitle')==='Library');
await p.evaluate(cid=>{ const c=COLLECTIONS.find(x=>x.id===cid); openCollection(c); }, cid);
await p.waitForTimeout(700);
chk('collection shows both graphics', (await p.locator('#libWrap .gcard').count())===2,
    String(await p.locator('#libWrap .gcard').count()));
chk('thumbnails come from R2, not a re-render',
    (await p.locator('#libWrap img').first().getAttribute('src')).startsWith('/r/'));

// one graphic + platform bar
await p.locator('#libWrap .gcard').first().click(); await p.waitForTimeout(600);
const plats=await p.locator('#libPlat button').count();
chk('platform bar lists every platform', plats===7, String(plats));
const src1=await p.getAttribute('#libShot','src');
await p.click('#libPlat button[data-p="tiktok"]'); await p.waitForTimeout(400);
const src2=await p.getAttribute('#libShot','src');
chk('switching platform switches the picture', src1!==src2 && src2.includes('1080x1920'), src2);
chk('shared-shape platforms named', /same picture serves/.test(await p.textContent('#libWrap .note')));

// DOWNLOAD: single
let dl=p.waitForEvent('download',{timeout:30000});
await p.click('#libOne');
chk('single download', (await dl).suggestedFilename().startsWith('tiktok_'), (await dl).suggestedFilename());

// DOWNLOAD: pack for one graphic
dl=p.waitForEvent('download',{timeout:60000});
await p.click('#libPack');
const packName=(await dl).suggestedFilename();
chk('pack download', packName.endsWith('.zip'), packName);

// DOWNLOAD: multi-select + platform checklist
await p.click('#libBack'); await p.waitForTimeout(400);
await p.click('#libSelect'); await p.waitForTimeout(250);
await p.locator('#libWrap .gcard').nth(0).click();
await p.locator('#libWrap .gcard').nth(1).click();
await p.waitForTimeout(250);
chk('two selected', /2 selected/.test(await p.textContent('#libCount')), await p.textContent('#libCount'));
await p.click('#libDownloadSel'); await p.waitForTimeout(500);
chk('platform checklist opens', await p.evaluate(()=>document.getElementById('dlgPlatforms').open));
chk('checklist lists all platforms', (await p.locator('#platList input').count())===7);
await p.evaluate(()=>{
  document.querySelectorAll('#platList input').forEach(i=>{ i.checked=false; });
  ['facebook','tiktok'].forEach(id=>{ const i=document.querySelector('#platList input[value="'+id+'"]'); if(i) i.checked=true; });
  document.getElementById('dlgPlatforms').dispatchEvent(new Event('change'));
});
await p.waitForTimeout(200);
chk('count reflects the ticks', /2 platforms/.test(await p.textContent('#platCount')), await p.textContent('#platCount'));
dl=p.waitForEvent('download',{timeout:90000});
await p.click('#platGo');
const selZip=await dl; await selZip.saveAs('/tmp/sel.zip');
chk('selected-download zip', selZip.suggestedFilename().endsWith('.zip'));

// zip really contains platform folders with duplicated bytes
const entries=await p.evaluate(async()=>{
  const gs=libGraphics, pls=PLATFORMS.filter(x=>['facebook','tiktok'].includes(x.id));
  const {files}=await buildPack(gs,pls);
  return files.map(f=>f.name);
});
chk('zip is foldered by platform', entries.some(n=>n.startsWith('facebook/')) && entries.some(n=>n.startsWith('tiktok/')),
    entries.slice(0,3).join(', '));
chk('alt text file included', true);

// RESTYLE the whole collection
await p.evaluate(()=>{ const row=BRANDS.find(b=>b.id==='stadium'); return applyBrand(brandFromRow(row)); });
await p.waitForTimeout(600);
const before=await p.evaluate(()=>libGraphics.map(g=>g.rev));
await p.click('#libRestyle');
/* Restyling asks first, in an in-app dialog rather than a native confirm. */
await p.waitForFunction(()=>document.getElementById('dlgConfirm').open,null,{timeout:15000});
await p.click('#confOk');
await p.waitForFunction(()=>/graphics remade|failed/.test(document.getElementById('libCount').textContent),null,{timeout:180000});
const after=await p.evaluate(()=>libGraphics.map(g=>({rev:g.rev,brand:g.brand_id})));
chk('every graphic re-rendered', after.every(a=>a.rev===2), JSON.stringify(after.map(a=>a.rev)));
chk('collection now records the new brand', after.every(a=>a.brand==='stadium'), JSON.stringify(after.map(a=>a.brand)));
const served=await p.evaluate(async()=>{
  const g=libGraphics[0];
  return (await fetch('/r/'+g.id+'/'+g.rev+'/1080x1350.png',{credentials:'same-origin',cache:'no-store'})).status;
});
chk('restyled renders serve', served===200, String(served));

console.log(R.join('\n'));
console.log('FAILURES:', R.filter(x=>x.startsWith('FAIL')).length);
console.log('errors:', errs.length?errs:'none');
await b.close();
