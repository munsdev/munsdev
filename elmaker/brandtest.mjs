/* The brand editor: browse, edit, the contrast refusal, and saving. */
import { chromium } from 'playwright';
import { CHROMIUM, openApp, assertServer, resetDb } from './testlib.mjs';
await assertServer(); resetDb();
const R=[]; const chk=(n,ok,note='')=>R.push((ok?'PASS ':'FAIL ')+n+(note?'   ['+note+']':''));
const b=await chromium.launch({executablePath:CHROMIUM});
const p=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
/* The refusal check below deliberately asks the Worker to reject an edit,
   so its 422 is the point, not a failure. */
let expect422=false;
p.on('console',m=>{
  if(m.type()!=='error') return;
  const t=m.text();
  if(expect422 && /422/.test(t)) return;
  errs.push('CONSOLE '+t.slice(0,120));
});
await openApp(p);

// reachable from home
await p.evaluate(()=>{ S.items=[]; S.sel=null; commit(); showHome(); }); await p.waitForTimeout(400);
chk('Brand styles offered on home', await p.locator('#homeBrands').isVisible());
await p.click('#homeBrands'); await p.waitForTimeout(900);
chk('brand view opens', !(await p.locator('#brandview').isHidden()));
const n=await p.locator('#brandWrap .bcard').count();
chk('all 20 styles listed', n===20, String(n));
chk('the one in use is marked', /in use/.test(await p.textContent('#brandWrap .bcard.on')||''));

// open one
await p.locator('#brandWrap .bcard').first().click(); await p.waitForTimeout(900);
chk('editor opens', await p.locator('#bSave').isVisible());
chk('preview drew every layout', await p.evaluate(()=>{
  const c=document.getElementById('bCanvas'); return c && c.width>1000 && c.height>700; }));
const rows=await p.locator('.brow').count();
chk('every colour role editable', rows===8, String(rows));

// a change repaints the preview
const before=await p.evaluate(()=>document.getElementById('bCanvas').toDataURL().length);
await p.fill('#h_accent','#FF0000'); await p.waitForTimeout(700);
const after=await p.evaluate(()=>document.getElementById('bCanvas').toDataURL().length);
chk('editing a colour repaints the preview', before!==after);
chk('colour input follows the hex', (await p.inputValue('#c_accent')).toLowerCase()==='#ff0000');

// the contrast gate refuses and says why
await p.evaluate(()=>{ const el=document.getElementById('h_accent'); el.value='#2A2A2A';
  el.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(400);
expect422=true;
await p.click('#bSave'); await p.waitForTimeout(1200);
expect422=false;
const warn=await p.textContent('#bWarn');
chk('unreadable edit refused', /Not saved/.test(warn||''), (warn||'').slice(0,60));
chk('refusal names the failing pair', /:1/.test(warn||''));

// revert, then a legitimate save
await p.click('#bRevert'); await p.waitForTimeout(600);
await p.fill('#h_accent','#FFC83D'); await p.waitForTimeout(600);
await p.click('#bSave'); await p.waitForTimeout(1500);
chk('legitimate edit saves', !/Not saved/.test(await p.textContent('#bWarn')||''));
const persisted=await p.evaluate(async()=>{
  const bs=(await (await api('/api/brands')).json()).brands;
  return bs.find(x=>x.accent==='#FFC83D')?true:false;
});
chk('saved to the database', persisted);

// typeface switching loads a real face
await p.selectOption('#bFace','Anton'); await p.waitForTimeout(1200);
chk('typeface applies', await p.evaluate(()=>document.fonts.check('400 40px "Anton"')));

await p.click('#brandBack'); await p.waitForTimeout(500);
chk('back returns to the list', (await p.locator('#brandWrap .bcard').count())===20);
await p.click('#brandClose'); await p.waitForTimeout(300);
chk('closes', await p.locator('#brandview').isHidden());

console.log(R.join('\n'));
console.log('FAILURES:', R.filter(x=>x.startsWith('FAIL')).length);
console.log('errors:', errs.length?errs:'none');
await b.close();
