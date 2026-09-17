/* Look at production. Same idea as look.mjs, but read-only and against the
   real library: SM_BASE=https://socialmaker.muns.dev node prodshot.mjs */
import { chromium } from 'playwright';
import { launchOpts, openApp } from './testlib.mjs';
import fs from 'fs';
fs.mkdirSync('/tmp/prod',{recursive:true});
const b=await chromium.launch(launchOpts);
for(const [tag,w,h] of [['desk',1440,900],['ip14',390,844],['land',844,390]]){
  let done=false;
  for(let tries=0;tries<3 && !done;tries++){
    const p=await b.newPage({viewport:{width:w,height:h}});
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    try{
      await openApp(p);
      await p.waitForTimeout(1500);
      await p.screenshot({path:`/tmp/prod/${tag}-home.png`});
      await p.evaluate(()=>openLib()); await p.waitForTimeout(3000);
      await p.screenshot({path:`/tmp/prod/${tag}-lib.png`});
      await p.locator('#libWrap .gcard').first().click(); await p.waitForTimeout(4000);
      await p.screenshot({path:`/tmp/prod/${tag}-col.png`});
      await p.locator('#libWrap .gcard').first().click(); await p.waitForTimeout(3000);
      await p.screenshot({path:`/tmp/prod/${tag}-one.png`});
      console.log(tag,'errors:',errs.length?errs:'none');
      done=true;
    }catch(e){ console.log(tag,'retry',tries+1,String(e.message).slice(0,60)); }
    await p.close();
  }
}
await b.close();
