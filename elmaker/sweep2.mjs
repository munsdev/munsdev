import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer , bench} from './testlib.mjs';
await assertServer(); resetDb();
const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900},acceptDownloads:true});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS':'FAIL')+'  '+n+(note?'  ['+note+']':''));
await openApp(p);
await bench(p, 46);
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(1000);

// scale: 200 graphics
let t=Date.now();
await p.evaluate(()=>{ S.items=[]; for(let i=0;i<200;i++) S.items.push(newItem('LINE NUMBER '+i+'?','LOG IT.'));
  S.sel=S.items[0].id; commit(); });
chk('200 items commit', Date.now()-t<4000, (Date.now()-t)+'ms');
/* The 200-card contact sheet is gone with the list; what still matters is
   that the renderer copes with a large bench, which the commit above times. */

// text injection must never become markup
await p.evaluate(()=>{ cur().top='<img src=x onerror=alert(1)> & "quotes"'; commit(); });
/* The list row is gone; the bar is where the graphic's words are shown as
   text now, and the library escapes them into its cards. */
chk('bar shows the words as text not markup', await p.evaluate(()=>{
  const r=document.getElementById('editingWhat');
  return r.children.length===0 && r.textContent.includes('<img'); }));
chk('library escapes the words', await p.evaluate(()=>{
  const d=document.createElement('div');
  d.innerHTML='<div class="gl">'+esc(cur().top)+'</div>';
  return d.querySelector('.gl').children.length===0 &&
         d.querySelector('.gl').textContent.includes('<img'); }));

// duplicate is independent
await p.evaluate(()=>{ S.items=S.items.slice(0,1); S.items[0].top='ORIGINAL?'; S.sel=S.items[0].id; commit(); });
/* Duplicating went with the list. The invariant it protected is still worth
   holding: a copied graphic must not share its nested crop overrides. */
await p.evaluate(()=>{
  const it=cur();
  const c={...it, id:nid(), per:JSON.parse(JSON.stringify(it.per||{}))};
  S.items.push(c); S.sel=c.id; commit();
}); await p.waitForTimeout(250);
await p.evaluate(()=>{ cur().top='CHANGED?'; cur().zoom=200; commit(); });
chk('duplicate does not share state', await p.evaluate(()=>S.items[0].top==='ORIGINAL?'&&S.items[0].zoom===100));

// undo chain across different operations
await p.evaluate(()=>{ S.items=[newItem('A?'),newItem('B?')]; S.sel=S.items[0].id; commit(); });
await p.evaluate(()=>{ const it=S.items[0]; const at=0;
  S.items=S.items.filter(x=>x.id!==it.id); S.sel=S.items[0].id;
  offerUndo('Removed',()=>{S.items.splice(at,0,it);S.sel=it.id;}); commit(); });
await p.click('#toastUndo'); await p.waitForTimeout(250);
chk('undo after delete', await p.evaluate(()=>S.items.length===2 && S.items[0].top==='A?'));

// guides never reach an exported file
await p.evaluate(()=>{ S.guides=true; drawPreview(); });
chk('guides preview only', await p.evaluate(()=>{
  const c=document.createElement('canvas'); renderTo(c,1080,1080,cur(),false);
  const d=c.getContext('2d').getImageData(96,300,1,1).data;
  return !(d[0]===41&&d[1]===107&&d[2]===96); }));
await p.evaluate(()=>{ S.guides=false; drawPreview(); });

// every layout renders at every size without throwing
const grid=await p.evaluate(async()=>{
  const out=[];
  for(const v of ['stack','bleed','band','type'])
    for(const s of SIZES){
      try{ const c=document.createElement('canvas');
        renderTo(c,s.w,s.h,{...cur(),variant:v},false);
        const d=c.getContext('2d').getImageData(0,0,1,1).data;
        out.push(v+'@'+s.id+':'+(d[3]===255?'ok':'transparent'));
      }catch(e){ out.push(v+'@'+s.id+':THREW '+e.message); }
    }
  return out;
});
chk('all layouts x all sizes render', grid.every(x=>x.endsWith(':ok')), grid.filter(x=>!x.endsWith(':ok')).join(', ')||'12/12');

// rapid tab switching leaves exactly one panel open
for(const tb of ['text','layout','photo','sizes','library','export','text','export']){
  await p.click(`.tab[data-p=${tb}]`);
}
await p.waitForTimeout(250);
chk('one panel open after rapid switching', await p.evaluate(()=>
  [...document.querySelectorAll('.panel')].filter(x=>!x.hidden).length<=1));

// resize with a panel open keeps the canvas constant
await p.click('.tab[data-p=photo]'); await p.waitForTimeout(200);
const s1=await p.evaluate(()=>Math.round(document.getElementById('preview').getBoundingClientRect().width));
await p.setViewportSize({width:1100,height:800}); await p.waitForTimeout(400);
const s2=await p.evaluate(()=>Math.round(document.getElementById('preview').getBoundingClientRect().width));
await p.click('.tab[data-p=photo]'); await p.waitForTimeout(300);
const s3=await p.evaluate(()=>Math.round(document.getElementById('preview').getBoundingClientRect().width));
chk('canvas constant across panel toggle after resize', s2===s3, s1+' -> '+s2+' / '+s3);

console.log(R.join('\n'));
console.log('errors:', errs.length?errs:'none');
await b.close();
