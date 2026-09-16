/* Drives the real save-to-library flow in a browser: photo upload, brand
   swap, save, and the restyle path. */
import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer, testPhoto } from './testlib.mjs';
await assertServer();
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS ':'FAIL ')+n+(note?'   ['+note+']':''));

const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
/* The sweep check below deliberately asks for a render that should be gone,
   so its own 404 is not a failure. */
let expect404=false;
p.on('console',m=>{
  if(m.type()!=='error') return;
  if(expect404 && /404/.test(m.text())) return;
  errs.push('CONSOLE '+m.text());
});
await openApp(p);

// brands reached the client
const brands=await p.evaluate(()=>BRANDS.length);
chk('20 brands loaded', brands===20, String(brands));

// make a collection
await p.click('.tab[data-p=library]'); await p.waitForTimeout(250);
await p.evaluate(async()=>{
  const c=await (await api('/api/collections',{method:'POST',...asJson({name:'See It, Log It'})})).json();
  COLLECTIONS.push({...c,count:0}); fillCollections();
  document.getElementById('fCollection').value=c.id;
});
chk('collection selectable', !!(await p.inputValue('#fCollection')));

// attach a photo so the stack layout is exercised, not downgraded
await p.click('.tab[data-p=photo]'); await p.waitForTimeout(200);
const ch=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]).then(r=>r[0]);
await ch.setFiles(testPhoto()); await p.waitForTimeout(2500);
chk('photo attached', await p.evaluate(()=>!!cur().img));

// save it
await p.click('.tab[data-p=library]'); await p.waitForTimeout(250);
await p.click('#btnSaveLib');
await p.waitForFunction(()=>/Saved\.|could not|Could not/.test(document.getElementById('libStatus').textContent),null,{timeout:90000});
const st=await p.textContent('#libStatus');
chk('save reports success', /Saved\./.test(st), st.trim());

// the row is finished and its renders really serve
const saved=await p.evaluate(async()=>{
  const cid=document.getElementById('fCollection').value;
  const d=await (await api('/api/collections/'+cid+'/graphics')).json();
  const g=d.graphics[0];
  const codes={};
  for(const s of g.sizes){
    codes[s]=(await fetch('/r/'+g.id+'/'+g.rev+'/'+s+'.png',{credentials:'same-origin'})).status;
  }
  return {g, codes};
});
chk('all three sizes recorded', saved.g.sizes.length===3, saved.g.sizes.join(','));
chk('every render serves 200', Object.values(saved.codes).every(c=>c===200), JSON.stringify(saved.codes));
chk('recipe stored', saved.g.top===(await p.evaluate(()=>cur().top)));
chk('photo recorded on the row', !!saved.g.photo_sha);
chk('alt text written', (saved.g.alt||'').length>40);
chk('brand recorded', saved.g.brand_id==='mk2', String(saved.g.brand_id));
chk('starts at rev 1', saved.g.rev===1);

// PNG is really a PNG
const sig=await p.evaluate(async(u)=>{
  const r=await fetch(u,{credentials:'same-origin'});
  const a=new Uint8Array(await r.arrayBuffer()).slice(0,8);
  return {type:r.headers.get('content-type'), sig:[...a].join(',')};
}, '/r/'+saved.g.id+'/'+saved.g.rev+'/1080x1350.png');
chk('served as image/png', sig.type==='image/png', sig.type);
chk('real PNG bytes', sig.sig.startsWith('137,80,78,71'), sig.sig);

// swap the brand: the font must actually load and the palette must change
const before=await p.evaluate(()=>({g:B.ground,a:B.accent,d:B.display}));
await p.selectOption('#fBrand','terminal');
await p.waitForFunction(()=>/Previewing in/.test(document.getElementById('libStatus').textContent),null,{timeout:30000});
const after=await p.evaluate(()=>({g:B.ground,a:B.accent,d:B.display,loaded:document.fonts.check('400 40px "IBM Plex Mono"')}));
chk('brand palette swapped', after.g!==before.g && after.a!==before.a, before.g+' -> '+after.g);
chk('brand font loaded', after.loaded===true);
chk('renderer uses new face', after.d==='IBM Plex Mono', after.d);

// restyle the saved graphic under the new brand
expect404=true;
const re=await p.evaluate(async()=>{
  const cid=document.getElementById('fCollection').value;
  const d=await (await api('/api/collections/'+cid+'/graphics')).json();
  const rev=await restyleGraphic(d.graphics[0]);
  const d2=await (await api('/api/collections/'+cid+'/graphics')).json();
  const g=d2.graphics[0];
  /* no-store, because renders are served immutable and this page already
     fetched rev 1 above -- a plain fetch would answer from cache and tell us
     nothing about what is in the bucket. */
  const now=(await fetch('/r/'+g.id+'/'+g.rev+'/1080x1350.png',{credentials:'same-origin',cache:'no-store'})).status;
  const old=(await fetch('/r/'+g.id+'/1/1080x1350.png',{credentials:'same-origin',cache:'no-store'})).status;
  return {rev, g, now, old};
});
chk('restyle bumped the revision', re.g.rev===2, 'rev '+re.g.rev);
chk('restyled brand recorded', re.g.brand_id==='terminal', String(re.g.brand_id));
chk('new revision serves', re.now===200, String(re.now));
chk('old revision swept', re.old===404, String(re.old));
expect404=false;

console.log(R.join('\n'));
console.log('FAILURES:', R.filter(x=>x.startsWith('FAIL')).length);
console.log('errors:', errs.length?errs:'none');
await b.close();
