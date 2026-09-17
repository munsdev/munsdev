/* Exhaustive UI audit. Drives every visible control in every state the app
   can be in and reports anything that throws, does nothing, is unreachable,
   or contradicts what the UI says. Diagnostic, not a pass/fail suite. */
import { chromium } from 'playwright';
import { CHROMIUM, openApp, assertServer, resetDb, testPhoto } from './testlib.mjs';
await assertServer(); resetDb();

const problems=[]; const note=(where,what)=>problems.push(where+' :: '+what);
const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900}});
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{ if(m.type()==='error'){ const t=m.text(); if(!/challenge-platform|cloudflareinsights|Refused to (execute|load)/.test(t)) errs.push('CONSOLE '+t.slice(0,140)); }});
p.on('dialog',d=>d.accept());
/* A stray native file chooser blocks the page and every later click times
   out with no explanation. */
p.on('filechooser',async fc=>{ try{ await fc.setFiles([]); }catch(e){} });

/* Starting a graphic on top of an unsaved one now asks first. */
const okConfirm=async()=>{
  if(await p.evaluate(()=>document.getElementById('dlgConfirm').open)){
    await p.click('#confOk'); await p.waitForTimeout(300); return true;
  }
  return false;
};
const vis=async sel=>{ try{ return await p.locator(sel).first().isVisible(); }catch(e){ return false; } };
const clickIf=async(sel,label)=>{
  const before=errs.length;
  if(!await vis(sel)) { note(label,'control not visible: '+sel); return false; }
  try{ await p.locator(sel).first().click({timeout:4000}); }
  catch(e){
    const why=await p.evaluate(()=>({
      dialogs:[...document.querySelectorAll('dialog')].filter(d=>d.open).map(d=>d.id),
      overlays:['home','libview','grid','brandview'].filter(id=>{const n=document.getElementById(id);return n&&!n.hidden;})
    })).catch(()=>({dialogs:['?'],overlays:['?']}));
    note(label,'click blocked on '+sel+' | open dialogs: '+(why.dialogs.join(',')||'none')+
         ' | overlays: '+(why.overlays.join(',')||'none'));
    return false;
  }
  await p.waitForTimeout(220);
  /* A modal dialog makes the rest of the page inert; leaving one open would
     make every later click in this audit time out for no reason. */
  /* dlgStart and dlgConfirm are driven deliberately by this audit, so they
     are not auto-closed here. */
  for(const d of ['dlgAsk','dlgPlatforms']){
    if(await p.evaluate(x=>{const n=document.getElementById(x);return !!(n&&n.open);},d)){
      await p.evaluate(x=>document.getElementById(x).close(),d);
      await p.waitForTimeout(150);
    }
  }
  if(errs.length>before) note(label,'error raised by '+sel+': '+errs[errs.length-1].slice(0,100));
  return true;
};

await openApp(p);

/* ---------- 1. HOME ---------- */
if(!await vis('#home')) note('home','does not open on an empty bench');
for(const id of ['#homeNew','#homeBrowse']) if(!await vis(id)) note('home', id+' missing');
if(await vis('#homeClose')) note('home','"Back to the graphic" offered with nothing on the bench');

/* dialog cancel must not strand you */
await clickIf('#homeNew','home');
if(!await p.evaluate(()=>document.getElementById('dlgStart').open)) note('home','start dialog did not open');
await clickIf('#startCancel','home');
if(await p.evaluate(()=>document.getElementById('dlgStart').open)) note('home','cancel left the dialog open');
if(!await vis('#home')) note('home','cancel left home hidden with no graphic');

/* ---------- 2. TYPE-ONLY PATH ---------- */
await clickIf('#homeNew','type-path'); await clickIf('#startType','type-path');
await okConfirm();
await p.waitForTimeout(400);
const tv=await p.evaluate(()=>{
  const seg=document.getElementById('segVariant');
  const kids=[...seg.children];
  const shown=kids.filter(x=>!x.hidden);
  const cs=getComputedStyle(seg);
  return { shown:shown.map(x=>x.dataset.v), hidden:kids.filter(x=>x.hidden).map(x=>x.dataset.v),
           cols:cs.gridTemplateColumns, variant:cur().variant,
           anyHiddenStillVisible:kids.some(x=>x.hidden && x.getBoundingClientRect().width>0) };
});
if(tv.shown.sort().join()!=='slab,split,stamp,type') note('type-path','wrong layouts offered: '+tv.shown);
if(tv.anyHiddenStillVisible) note('type-path','hidden layout buttons still occupy space');
await p.evaluate(()=>{ if(openPanel!=='layout') showPanel('layout'); }); await p.waitForTimeout(280);
const tgap=await p.evaluate(()=>{const k=[...document.getElementById('segVariant').children]
  .filter(x=>x.getBoundingClientRect().width>0);
  const w=[...new Set(k.map(x=>Math.round(x.getBoundingClientRect().width)))];
  return {n:k.length,widths:w.length};});
if(tgap.n!==tv.shown.length) note('type-path','laid-out buttons ('+tgap.n+') do not match offered ('+tv.shown.length+')');
if(tgap.widths>1) note('type-path','offered layouts have uneven widths -> gaps');
/* every offered layout must actually apply */
for(const v of tv.shown){
  await p.evaluate(x=>{ if(openPanel!=='layout') showPanel('layout'); }, null);
  await p.waitForTimeout(150);
  const ok=await clickIf(`#segVariant button[data-v=${v}]`,'type-path');
  if(ok){ const got=await p.evaluate(()=>cur().variant); if(got!==v) note('type-path','clicking '+v+' set '+got); }
}
/* the photo panel must not offer photo things */
await p.evaluate(()=>{ if(openPanel!=='photo') showPanel('photo'); }); await p.waitForTimeout(250);
if(await vis('#photoBlock')) note('type-path','photo drop zone shown for a type-only graphic');
if(await vis('#tuneBlock')) note('type-path','per-size crop bar shown with no photo');
if(await vis('#cropBlock')) note('type-path','crop controls shown with no photo');

/* ---------- 3. PHOTO PATH ---------- */
await clickIf('#btnHome','photo-path'); await p.waitForTimeout(300);
await clickIf('#homeNew','photo-path'); await clickIf('#startPhoto','photo-path');
await okConfirm();
await p.waitForTimeout(400);
const pv=await p.evaluate(()=>{
  const seg=document.getElementById('segVariant'); const kids=[...seg.children];
  return { shown:kids.filter(x=>!x.hidden).map(x=>x.dataset.v),
           cols:getComputedStyle(seg).gridTemplateColumns.split(' ').length, variant:cur().variant };
});
if(pv.shown.sort().join()!=='band,bleed,stack') note('photo-path','wrong layouts offered: '+pv.shown);
await p.evaluate(()=>{ if(openPanel!=='layout') showPanel('layout'); }); await p.waitForTimeout(280);
const pgap=await p.evaluate(()=>{const k=[...document.getElementById('segVariant').children]
  .filter(x=>x.getBoundingClientRect().width>0);
  return {n:k.length,widths:[...new Set(k.map(x=>Math.round(x.getBoundingClientRect().width)))].length};});
if(pgap.n!==pv.shown.length) note('photo-path','laid-out buttons ('+pgap.n+') do not match offered ('+pv.shown.length+')');
if(pgap.widths>1) note('photo-path','offered layouts have uneven widths -> gaps');
await p.evaluate(()=>{ if(openPanel!=='photo') showPanel('photo'); }); await p.waitForTimeout(250);
if(!await vis('#photoBlock')) note('photo-path','photo drop zone missing when a photo was promised');
/* before a photo is attached, crop controls should not pretend to work */
if(await vis('#cropBlock')) note('photo-path','crop controls active before any photo is attached');

const ch=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]).then(r=>r[0]);
await ch.setFiles(testPhoto()); await p.waitForTimeout(2600);
if(!await p.evaluate(()=>!!cur().img)) note('photo-path','photo did not attach');
if(!await vis('#cropBlock')) note('photo-path','crop controls still hidden after attaching a photo');
if(!await vis('#tuneBlock')) note('photo-path','per-size crop bar hidden after attaching a photo');

/* ---------- 4. EVERY VISIBLE CONTROL IN EVERY PANEL ---------- */
const closeOverlays=async()=>{
  await p.evaluate(()=>{
    for(const id of ['libview','home','grid','brandview']){ const n=document.getElementById(id); if(n) n.hidden=true; }
  });
  await p.waitForTimeout(120);
};
for(const panel of ['text','layout','photo','sizes','library','export']){
  await closeOverlays();
  await p.evaluate(x=>{ if(openPanel!==x) showPanel(x); }, panel);
  await p.waitForTimeout(260);
  const ctrls=await p.evaluate(pn=>{
    const root=document.getElementById('p-'+pn); if(!root) return null;
    return [...root.querySelectorAll('button,select,input[type=range],textarea,input[type=file]')]
      .filter(n=>n.offsetParent!==null)
      .map(n=>({tag:n.tagName,id:n.id||'',txt:(n.textContent||'').trim().slice(0,22),
                dis:n.disabled,
                w:Math.round(n.getBoundingClientRect().width),h:Math.round(n.getBoundingClientRect().height)}));
  }, panel);
  if(ctrls===null){ note('panel:'+panel,'panel element #p-'+panel+' does not exist'); continue; }
  for(const c of ctrls){
    if(c.h>0 && c.h<28) note('panel:'+panel,'small target '+(c.id||c.txt)+' '+c.w+'x'+c.h);
    if(c.dis) note('panel:'+panel,'disabled control offered: '+(c.id||c.txt));
  }
  /* click every button that is not destructive */
  for(const c of ctrls.filter(x=>x.tag==='BUTTON' && !/clear|delete|remove/i.test(x.id+x.txt))){
    if(!c.id) continue;
    await clickIf('#'+c.id,'panel:'+panel);
    await closeOverlays();
    await p.evaluate(x=>{ if(openPanel!==x) showPanel(x); }, panel);
    await p.waitForTimeout(140);
  }
}

await closeOverlays();
/* ---------- 5. HEADER + GLOBAL ---------- */
for(const id of ['#btnHome','#btnLibrary','#btnHelp']) if(!await vis(id)) note('header', id+' not visible');
if(await vis('#btnGrid')) note('header','contact-sheet button still visible after removal');
await clickIf('#btnHelp','header');
if(!await vis('#dlgHelp')) note('header','Rules dialog did not open');
await clickIf('#helpClose','header');

/* ---------- 6. STALE / CONTRADICTORY UI ---------- */
const stale=await p.evaluate(()=>{
  const out=[];
  const counter=document.getElementById('editingWhat');
  if(counter && counter.offsetParent!==null && /\d+\s*\/\s*\d+/.test(counter.textContent)) out.push('list-style counter still shown: "'+counter.textContent.trim()+'"');
  for(const id of ['btnPrev','btnNext','btnAdd','btnAdd2','btnDupe','btnClear','btnSeed','btnSeed2','bulkAdd'])
    { const n=document.getElementById(id); if(n&&n.offsetParent!==null) out.push('list-era control still reachable: #'+id); }
  const ex=document.getElementById('btnExport');
  if(ex&&ex.offsetParent!==null && /everything|all graphics/i.test(ex.textContent)) out.push('export still talks about a batch: "'+ex.textContent.trim()+'"');
  const rail=document.querySelector('.rail');
  if(rail&&rail.offsetParent!==null) out.push('rail still visible');
  return out;
});
stale.forEach(x=>note('stale',x));

/* ---------- 7. AFTER SAVE ---------- */
await p.evaluate(()=>{ if(openPanel!=='library') showPanel('library'); }); await p.waitForTimeout(250);
await p.evaluate(async()=>{
  const c=await (await api('/api/collections',{method:'POST',...asJson({name:'UX audit'})})).json();
  COLLECTIONS.push({...c,count:0}); fillCollections(); document.getElementById('fCollection').value=c.id;
});
await clickIf('#btnSaveLib','after-save');
await p.waitForFunction(()=>/Saved\.|ould not/.test(document.getElementById('libStatus').textContent),null,{timeout:90000}).catch(()=>{});
await p.waitForTimeout(1500);
const after=await p.evaluate(()=>({
  bench:S.items.length, libOpen:!document.getElementById('libview').hidden,
  homeOpen:!document.getElementById('home').hidden,
  drawerOpen:!!openPanel,
  previewText:(document.getElementById('pvSize')||{}).textContent
}));
if(after.bench!==0) note('after-save','bench not cleared');
if(after.drawerOpen) note('after-save','an editor panel is still open with nothing to edit ('+after.drawerOpen+')');

/* ---------- 8. LIBRARY ---------- */
if(after.libOpen){
  const lib=await p.evaluate(()=>({
    cards:document.querySelectorAll('#libWrap .gcard').length,
    back:!document.getElementById('libBack').hidden,
    sel:!document.getElementById('libSelect').hidden,
    restyle:!document.getElementById('libRestyle').hidden
  }));
  if(!lib.cards) note('library','no cards after saving into this collection');
  await p.locator('#libWrap .gcard').first().click().catch(()=>{});
  await p.waitForTimeout(700);
  const one=await p.evaluate(()=>({
    plats:document.querySelectorAll('#libPlat button').length,
    shot:!!document.getElementById('libShot'),
    one:!!document.getElementById('libOne'), pack:!!document.getElementById('libPack'),
    selVisible:!document.getElementById('libSelect').hidden,
    restyleVisible:!document.getElementById('libRestyle').hidden
  }));
  if(one.plats!==7) note('library','platform bar shows '+one.plats+' platforms');
  if(one.selVisible) note('library','"Select" offered while viewing a single graphic');
  if(one.restyleVisible) note('library','"Restyle collection" offered while viewing a single graphic');
}

console.log('--- PROBLEMS ---');
problems.forEach(x=>console.log('  '+x));
console.log('total:',problems.length);
console.log('--- JS ERRORS ---');
console.log(errs.length?errs.slice(0,10).join('\n'):'none');
await b.close();
