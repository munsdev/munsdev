import { chromium } from 'playwright';
import { CHROMIUM, openApp, resetDb, assertServer, testPhoto , bench} from './testlib.mjs';
await assertServer(); resetDb();
const b=await chromium.launch({executablePath:CHROMIUM});
const VIEWS=[
  {n:'desktop 1400x900', w:1400,h:900,mob:false,min:24},
  {n:'laptop 1180x760',  w:1180,h:760,mob:false,min:24},
  {n:'phone 390x844',    w:390, h:844,mob:true, min:32},
  {n:'phone SE 375x667', w:375, h:667,mob:true, min:32},
  {n:'landscape 844x390',w:844, h:390,mob:true, min:28}
];
const PANELS=['layout','photo','library','export'];
const problems=[];
for(const v of VIEWS){
  const p=await b.newPage({viewport:{width:v.w,height:v.h},isMobile:v.mob,hasTouch:v.mob});
  p.on('pageerror',e=>problems.push(v.n+' PAGEERROR '+e.message));
  await openApp(p);
  await bench(p, 46);
  await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(900);

  // give it a photo so the Photo panel is fully populated
  await p.click('.tab[data-p=photo]'); await p.waitForTimeout(200);
  const [ch]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]);
  await ch.setFiles(testPhoto()); await p.waitForTimeout(700);
  await p.evaluate(()=>{ cur().variant='bleed'; commit(); });

  for(const panel of PANELS){
    await p.click(`.tab[data-p=${panel}]`); await p.waitForTimeout(220);
    const bad=await p.evaluate(({panel,min})=>{
      const out=[];
      const scope=[document.querySelector('header.top'),document.querySelector('.rail'),
                   document.querySelector('.bar'),document.getElementById('drawer'),
                   document.querySelector('.stage-sizes')].filter(Boolean);
      const els=[];
      scope.forEach(s=>els.push(...s.querySelectorAll('button,input,textarea,[role=button]')));
      const firstRow=document.querySelector('.item');
      const seen=new Set();
      for(const el of els){
        if(el.offsetParent===null && getComputedStyle(el).position!=='fixed') continue;
        // only audit the first list row; the rest are identical clones
        const row=el.closest('.item');
        if(row && row!==firstRow) continue;
        // skip anything scrolled out of its own scrolling container
        let clipped=false;
        for(let a=el.parentElement;a;a=a.parentElement){
          const cs=getComputedStyle(a);
          if(/auto|scroll|hidden/.test(cs.overflowX+cs.overflowY)){
            const ar=a.getBoundingClientRect(), er=el.getBoundingClientRect();
            if(er.bottom<ar.top+1||er.top>ar.bottom-1||er.right<ar.left+1||er.left>ar.right-1){clipped=true;break;}
          }
        }
        if(clipped) continue;
        const r=el.getBoundingClientRect();
        if(r.width===0||r.height===0) continue;
        const id=el.id||el.className.toString().split(' ')[0]+':'+(el.textContent||'').trim().slice(0,14);
        const push=m=>{const k=id+'|'+m.split(' ')[0]; if(!seen.has(k)){seen.add(k); out.push(panel+' | '+id+' | '+m);}};
        if(r.height<min||r.width<min) push('small '+Math.round(r.width)+'x'+Math.round(r.height));
        if(r.right>innerWidth+1||r.left<-1||r.bottom>innerHeight+1||r.top<-1) push('offscreen');
        const cx=r.left+r.width/2, cy=r.top+r.height/2;
        const hit=document.elementFromPoint(cx,cy);
        if(hit && el!==hit && !el.contains(hit) && !hit.contains(el))
          push('covered by '+(hit.id||String(hit.className).split(' ')[0]||hit.tagName));
      }
      return out;
    },{panel,min:v.min});
    bad.forEach(x=>problems.push(v.n+' :: '+x));
  }
  /* The contact sheet went with the list; the library replaced it and
     libtest.mjs drives it. */
  // the Rules card
  await p.click('#btnHelp'); await p.waitForTimeout(300);
  const dlg=await p.evaluate(()=>{const d=document.getElementById('dlgHelp');
    const r=d.getBoundingClientRect();
    return {fits:r.top>=-1&&r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1,
            h:Math.round(r.height), vh:innerHeight, scrolls:d.scrollHeight>d.clientHeight};});
  if(!dlg.fits && !dlg.scrolls) problems.push(v.n+' :: rules card overflows the screen ('+dlg.h+' of '+dlg.vh+')');
  await p.click('#helpClose'); await p.waitForTimeout(150);
  const bodyOver=await p.evaluate(()=>document.body.scrollWidth-document.body.clientWidth);
  if(bodyOver>0) problems.push(v.n+' :: page scrolls sideways by '+bodyOver);
  await p.close();
}
const uniq=[...new Set(problems)];
console.log(uniq.length? uniq.join('\n') : 'no geometry problems found');
console.log('---', uniq.length, 'unique issues');
await b.close();
