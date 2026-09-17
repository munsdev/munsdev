/* Drives the real save-to-library flow in a browser: photo upload, save,
   and the revision mechanism the Worker commits renders through. */
import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer, testPhoto , bench} from './testlib.mjs';
await assertServer();
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS ':'FAIL ')+n+(note?'   ['+note+']':''));

const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
/* The revision checks below deliberately ask for a render that should be
   gone (404) and commit a revision that was never uploaded (409), so those
   two responses are the test working rather than the app failing. */
let expectFail=false;
p.on('console',m=>{
  if(m.type()!=='error') return;
  if(expectFail && /\b(404|409)\b/.test(m.text())) return;
  errs.push('CONSOLE '+m.text());
});
await openApp(p);
/* Boot leaves the bench empty now, so put a graphic on it. hometest.mjs
   covers the real create flow. */
await bench(p, 1);

// brand styles are gone, front and back. Asking for the route that used to
// serve them is another deliberate 404.
chk('no brand picker', await p.evaluate(()=>!document.getElementById('fBrand')));
expectFail=true;
chk('brands API is gone', await p.evaluate(async()=>
  (await fetch('/api/brands',{credentials:'same-origin'})).status===404));
await p.waitForTimeout(200);
expectFail=false;

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

// save it. The bench is cleared once a graphic is finished, so read the
// words before they go.
const wordsBefore=await p.evaluate(()=>cur().top);
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
chk('recipe stored', saved.g.top===wordsBefore, saved.g.top);
chk('photo recorded on the row', !!saved.g.photo_sha);
chk('alt text written', (saved.g.alt||'').length>40);
chk('starts at rev 1', saved.g.rev===1);
chk('every size is a real shape', ['1080x1080','1080x1350','1080x1920']
     .every(x=>saved.g.sizes.includes(x)), saved.g.sizes.join(','));

// PNG is really a PNG
const sig=await p.evaluate(async(u)=>{
  const r=await fetch(u,{credentials:'same-origin'});
  const a=new Uint8Array(await r.arrayBuffer()).slice(0,8);
  return {type:r.headers.get('content-type'), sig:[...a].join(',')};
}, '/r/'+saved.g.id+'/'+saved.g.rev+'/1080x1350.png');
chk('served as image/png', sig.type==='image/png', sig.type);
chk('real PNG bytes', sig.sig.startsWith('137,80,78,71'), sig.sig);

/* Nothing in the app re-renders a finished graphic any more -- restyling was
   what did -- but the Worker still commits renders through a revision, and
   that is what keeps a half-written set from ever being served. Drive it
   directly: rev 2 lands, the row moves, rev 1 is swept. */
expectFail=true;
const re=await p.evaluate(async(id)=>{
  const c=document.createElement('canvas');
  const put=async(rev,size)=>{
    const [w,h]=size.split('x').map(Number);
    c.width=w; c.height=h;
    const g=c.getContext('2d'); g.fillStyle='#E9A81C'; g.fillRect(0,0,w,h);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    await api('/api/graphics/'+id+'/renders/'+rev+'/'+size,
              {method:'PUT',headers:{'Content-Type':'image/png'},body:blob});
  };
  const sizes=['1080x1080','1080x1350','1080x1920'];
  for(const s of sizes) await put(2,s);
  /* A rev the bucket has not got must be refused, or a graphic could point
     at renders that are not there. */
  const bogus=await fetch('/api/graphics/'+id+'/finish',
    {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({sizes,rev:3})});
  await api('/api/graphics/'+id+'/finish',
    {method:'POST',...asJson({sizes,rev:2})});
  const row=await (await api('/api/graphics/'+id)).json();
  /* no-store, because renders are served immutable and this page already
     fetched rev 1 above -- a plain fetch would answer from cache and tell us
     nothing about what is in the bucket. */
  const now=(await fetch('/r/'+id+'/2/1080x1350.png',{credentials:'same-origin',cache:'no-store'})).status;
  const old=(await fetch('/r/'+id+'/1/1080x1350.png',{credentials:'same-origin',cache:'no-store'})).status;
  return {bogus:bogus.status, rev:row.graphic?row.graphic.rev:row.rev, now, old};
}, saved.g.id);
chk('a rev with no renders is refused', re.bogus===409, String(re.bogus));
chk('revision moved to 2', re.rev===2, 'rev '+re.rev);
chk('new revision serves', re.now===200, String(re.now));
chk('old revision swept', re.old===404, String(re.old));
expectFail=false;

console.log(R.join('\n'));
console.log('FAILURES:', R.filter(x=>x.startsWith('FAIL')).length);
console.log('errors:', errs.length?errs:'none');
await b.close();
