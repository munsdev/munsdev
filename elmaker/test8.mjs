import { chromium } from 'playwright';
import { CHROMIUM, openApp, resetDb, assertServer , bench} from './testlib.mjs';
await assertServer(); resetDb();
const b=await chromium.launch({executablePath:CHROMIUM});
const errs=[];
async function canvasSize(p){ return p.evaluate(()=>{const r=document.getElementById('preview').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}}); }

for(const c of [{n:'desktop',w:1400,h:900,mob:false},{n:'laptop',w:1180,h:760,mob:false},
                {n:'iph14',w:390,h:844,mob:true},{n:'iphSE',w:375,h:667,mob:true},{n:'and',w:360,h:740,mob:true}]){
  const p=await b.newPage({viewport:{width:c.w,height:c.h},isMobile:c.mob,hasTouch:c.mob,deviceScaleFactor:c.mob?2:1});
  p.on('pageerror',e=>errs.push(c.n+': '+e.message));
  await openApp(p);
  await bench(p, 46);

  const sizes=[]; sizes.push(['closed',await canvasSize(p)]);
  for(const t of ['text','layout','photo','sizes','library','export']){
    await p.click(`.tab[data-p=${t}]`); await p.waitForTimeout(180);
    sizes.push([t,await canvasSize(p)]);
  }
  await p.click(`.tab[data-p=export]`); await p.waitForTimeout(180); // close
  sizes.push(['closed2',await canvasSize(p)]);
  const uniq=new Set(sizes.map(s=>s[1].w+'x'+s[1].h+'@'+s[1].x+','+s[1].y));
  console.log(c.n, 'canvas', sizes[0][1].w+'x'+sizes[0][1].h,
              '| constant:', uniq.size===1, uniq.size>1?JSON.stringify(sizes):'');
  const over = await p.evaluate(()=>({
    bodyScroll:document.body.scrollWidth-document.body.clientWidth,
    tabsFit:(()=>{const t=document.getElementById('tabs');return t.scrollWidth<=t.clientWidth+1})(),
    railVisible:document.querySelector('.rail').getBoundingClientRect().height>10
  }));
  console.log('   ', JSON.stringify(over));
  await p.click('.tab[data-p=photo]'); await p.waitForTimeout(200);
  await p.screenshot({path:`q-${c.n}.png`});
  await p.close();
}
console.log('errors:', errs.length?errs:'none');
await b.close();
