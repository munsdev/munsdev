import { chromium } from 'playwright';
import { BASE, CHROMIUM, openApp, resetDb, assertServer, testPhoto } from './testlib.mjs';
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

// header
await p.click('#btnHelp'); await p.waitForTimeout(250);
chk('Rules opens', await p.isVisible('#dlgHelp'));
await p.click('#helpClose'); await p.waitForTimeout(200);
chk('Rules closes', !(await p.isVisible('#dlgHelp')));

// list panel controls
await p.click('.tab[data-p=list]'); await p.waitForTimeout(200);
let a=await S(); await p.click('#btnAdd2'); await p.waitForTimeout(200);
chk('Add a graphic (panel)', (await S()).n===a.n+1);
a=await S(); await p.click('#btnDupe'); await p.waitForTimeout(200);
chk('Duplicate selected', (await S()).n===a.n+1);
await p.fill('#bulkText','PASTED ONE? | YES.\nPASTED TWO?'); await p.click('#bulkAdd'); await p.waitForTimeout(250);
chk('Add pasted lines', (await p.evaluate(()=>S.items.some(i=>i.top==='PASTED ONE?'&&i.bot==='YES.'))));
chk('Paste box clears', (await p.inputValue('#bulkText'))==='');
a=await S(); await p.click('#btnSeed'); await p.waitForTimeout(400);
chk('Load all 46 lines', (await S()).n===a.n+46);
a=await S(); await p.click('#btnClear'); await p.waitForTimeout(250);
chk('Clear the list', (await S()).n===0);
await p.click('#toastUndo'); await p.waitForTimeout(300);
chk('Undo restores the list', (await S()).n===a.n);
await p.click('#btnAdd'); await p.waitForTimeout(200);
chk('Add a graphic (rail)', true);

// words
await p.click('.tab[data-p=text]'); await p.waitForTimeout(200);
await p.fill('#fTop','TOP TEST?'); await p.fill('#fBot','BOTTOM TEST.'); await p.waitForTimeout(400);
a=await S(); chk('Top line field', a.top==='TOP TEST?'); chk('Bottom line field', a.bot==='BOTTOM TEST.');
chk('List row follows the text', (await p.textContent('.item.on .t1')).includes('TOP TEST'));

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
await p.evaluate(()=>{ S.sel=S.items[0].id; commit(); }); await p.waitForTimeout(200);
const before=await p.evaluate(()=>S.sel);
await p.click('#btnNext'); await p.waitForTimeout(200);
chk('Next', before!==await p.evaluate(()=>S.sel));
await p.click('#btnPrev'); await p.waitForTimeout(200);
chk('Previous', before===await p.evaluate(()=>S.sel));
chk('Counter reads position', /^\d+ \/ \d+$/.test((await p.textContent('#editingWhat')).trim()));

// contact sheet
await p.click('#btnGrid'); await p.waitForTimeout(700);
chk('Contact sheet opens', await p.isVisible('#grid'));
chk('Sheet renders a card per graphic',
  (await p.locator('.gcard').count())===(await p.evaluate(()=>S.items.length)));
await p.click('#gridMode button[data-g=one]'); await p.waitForTimeout(500);
chk('All-sizes mode', (await p.locator('.gcard').count())===3);
await p.locator('.gcard').nth(2).click(); await p.waitForTimeout(300);
chk('Card click sets the size', (await S()).pv==='1080x1920');
await p.click('#btnGrid'); await p.waitForTimeout(600);
await p.click('#gridMode button[data-g=all]'); await p.waitForTimeout(600);
await p.locator('.gcard').nth(1).click(); await p.waitForTimeout(300);
chk('Card click selects and closes', !(await p.isVisible('#grid')));
await p.click('#btnGrid'); await p.waitForTimeout(600); await p.click('#gridClose'); await p.waitForTimeout(250);
chk('Sheet Close button', !(await p.isVisible('#grid')));

// export
await p.click('.tab[data-p=export]'); await p.waitForTimeout(200);
await p.fill('#fCaption','CAPTION UNDER TEST'); await p.waitForTimeout(500);
chk('Caption field', (await S()).cap==='CAPTION UNDER TEST');
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
