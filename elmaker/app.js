/* ===========================================================
   ElectionLog Graphic Maker
   Words and layouts in D1, photos in R2, the whole thing behind one
   password. Everything it talks to is same-origin -- see HANDOFF section 1.
   =========================================================== */
'use strict';

/* Roles, never colour names. The renderer asks for "the type on the accent",
   so HANDOFF section 4's rule that gold carries dark text is a property of
   the style that can be checked, not three constants at three call sites.
   There is one style and it is not editable in the app: brand styles were
   taken out, and this is what is left of them -- the vocabulary the drawing
   code speaks. Every draw reads through B. */
const B={
  id:'mk2', name:'ElectionLog (house)',
  ground:'#121A24', onGround:'#FFFFFF', accent:'#E9A81C', onAccent:'#121A24',
  muted:'#999999', bar:'#FAFAFA', onBar:'#121A24', accentOnBar:'#E9A81C',
  display:'ElectionLog Display'
};
const FD='"'+B.display+'"';
const FM='"ElectionLog Mono"';

const rgbOf=h=>{
  const n=parseInt(String(h).replace('#',''),16);
  return [(n>>16)&255,(n>>8)&255,n&255];
};
/* The scrim and the legibility floor paint with the ground, so they follow
   the style instead of a navy hardcoded as a decomposed rgb triple. */
const groundRGB=()=>rgbOf(B.ground).join(',');
const lumOf=h=>{ const [r,g,b]=rgbOf(h); return 0.2126*r+0.7152*g+0.0722*b; };

const MAXPX=2000;                 // longest edge kept for a photo

/* Every graphic is made at all three. Nothing picks a subset: `aspect` is
   only how a size is named in the UI, where "4:5" reads and "1350" does not. */
const SIZES=[
  {id:'1080x1080', w:1080,h:1080, aspect:'1:1',  label:'1080 x 1080',
   platforms:'Instagram, Facebook, Bluesky (1080 x 1080)'},
  {id:'1080x1350', w:1080,h:1350, aspect:'4:5',  label:'1080 x 1350',
   platforms:'Instagram, Threads, Facebook (1080 x 1350)'},
  {id:'1080x1920', w:1080,h:1920, aspect:'9:16', label:'1080 x 1920',
   platforms:'Stories, Reels, TikTok (1080 x 1920)'}
];

/* A size is a shape; a platform is a place. Several platforms want the same
   shape, so they share the render and only the download folders duplicate it. */
const PLATFORMS=[
  /* `short` is for the platform bar, where a three-line label looked broken;
     `name` is what the checklist and the download folders use. */
  {id:'instagram-feed',  short:'IG feed',  name:'Instagram feed',         size:'1080x1350'},
  {id:'instagram-story', short:'IG story', name:'Instagram story / reel', size:'1080x1920'},
  {id:'facebook',        short:'Facebook', name:'Facebook',               size:'1080x1080'},
  {id:'threads',         short:'Threads',  name:'Threads',                size:'1080x1350'},
  {id:'bluesky',         short:'Bluesky',  name:'Bluesky',                size:'1080x1080'},
  {id:'tiktok',          short:'TikTok',   name:'TikTok',                 size:'1080x1920'},
  {id:'youtube-shorts',  short:'Shorts',   name:'YouTube Shorts',         size:'1080x1920'}
];

/* ---------- state ---------- */
let S={
  items:[], sel:null,
  /* No size picker: a graphic is made at all three, always. `pv` is only
     which one you are looking at. */
  images:{}, pv:'1080x1350', guides:false,
  caption:'ElectionLog is a public record of election problems, written by the people who saw them. '+
          'Site opens shortly. Bookmark it now: electionlog.org'
};
const IMG=new Map();
let uid=Date.now();
const nid=()=> 'i'+(++uid).toString(36);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function newItem(top,bot){
  return {id:nid(), top:top||'LONG LINE?', bot:bot||'LOG IT.',
          variant:'stack', align:'center', img:null, zoom:100, fx:50, fy:50, scrim:70,
          per:{}};
}

/* A crop that works square loses someone's head at 9:16, so each size may
   carry its own zoom/fx/fy. A size with no override uses the graphic's own
   crop, which is why `per` stays empty until somebody actually tunes one. */
function forSize(it, sizeId){
  const o=(it&&it.per)?it.per[sizeId]:null;
  if(!o) return it;
  return {...it, zoom:o.zoom??it.zoom, fx:o.fx??it.fx, fy:o.fy??it.fy};
}
/* Which crop the controls are editing: the graphic's own, or one size's. */
let tuning=null;
function cropTarget(it){
  if(!tuning) return it;
  if(!it.per) it.per={};
  if(!it.per[tuning]) it.per[tuning]={zoom:it.zoom, fx:it.fx, fy:it.fy};
  return it.per[tuning];
}
function cropView(it){ return tuning ? (it.per&&it.per[tuning]) || it : it; }

/* ---------- persistence ---------- */
/* Words and layouts go to D1, photos to R2. localStorage stays on as a
   write-through cache, so typing is still instant and a dropped connection
   costs nothing: the diff below simply resends on the next attempt. */
const KEY='electionlog-graphic-maker-v1';
let saveT=null, retryT=null, pushing=false, pushAgain=false, online=true;

/* What the server last confirmed. Everything else is derived by diffing
   against it, so no call site has to remember to mark anything dirty. */
const LAST=new Map();
let lastProj='';

function itemsNow(){
  const m=new Map();
  S.items.forEach((it,ord)=>m.set(it.id, JSON.stringify({...it, ord})));
  return m;
}
function projNow(){
  return JSON.stringify({caption:S.caption, pv:S.pv,
                         guides:S.guides, sel:S.sel});
}

function cacheNow(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
function loadCache(){
  try{
    const raw=localStorage.getItem(KEY); if(!raw) return false;
    const d=JSON.parse(raw); if(!d||!Array.isArray(d.items)) return false;
    S={...S,...d}; return true;
  }catch(e){ return false }
}

async function api(path, opts){
  const r=await fetch(path, {credentials:'same-origin', ...opts});
  if(r.status===401){ location.href='/login'; throw new Error('signed out'); }
  if(!r.ok) throw new Error(path+' -> '+r.status);
  return r;
}
const asJson=body=>({headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});

/* One push carries every changed item and every deletion. Items go whole --
   an item is ten short fields -- but only the changed ones go, so two people
   editing different graphics no longer overwrite each other. */
async function pushNow(){
  if(pushing){ pushAgain=true; return; }
  pushing=true;
  try{
    const now=itemsNow(), proj=projNow();
    const changed=[...now].filter(([id,j])=>LAST.get(id)!==j).map(([,j])=>JSON.parse(j));
    const gone=[...LAST.keys()].filter(id=>!now.has(id));

    if(gone.length)    await api('/api/items/delete',{method:'POST',...asJson({ids:gone})});
    if(changed.length) await api('/api/items',       {method:'PUT', ...asJson({items:changed})});
    if(proj!==lastProj)await api('/api/project',     {method:'PUT', ...asJson(JSON.parse(proj))});

    /* Only now is it safe to forget: LAST is the retry queue. */
    LAST.clear(); for(const [id,j] of now) LAST.set(id,j);
    lastProj=proj;
    if(!online){ online=true; showOffline(); }
  }catch(e){
    if(online){ online=false; showOffline(); }
    clearTimeout(retryT); retryT=setTimeout(pushNow, 5000);
  }finally{
    pushing=false;
    if(pushAgain){ pushAgain=false; setTimeout(pushNow,0); }
  }
}

function saveNow(){ cacheNow(); pushNow(); }
function save(){ cacheNow(); clearTimeout(saveT); saveT=setTimeout(pushNow,800); }

/* Closing the tab inside the debounce window would otherwise drop the last
   edit: the cache would hold it but the next load takes the server's copy.
   keepalive lets these outlive the page. The payload is a few KB, well under
   the 64KB keepalive ceiling. */
function flush(){
  const now=itemsNow(), proj=projNow();
  const changed=[...now].filter(([id,j])=>LAST.get(id)!==j).map(([,j])=>JSON.parse(j));
  const gone=[...LAST.keys()].filter(id=>!now.has(id));
  const send=(path,method,body)=>{
    try{ fetch(path,{method, credentials:'same-origin', keepalive:true,
                     headers:{'Content-Type':'application/json'},
                     body:JSON.stringify(body)}); }catch(e){}
  };
  if(gone.length)     send('/api/items/delete','POST',{ids:gone});
  if(changed.length)  send('/api/items','PUT',{items:changed});
  if(proj!==lastProj) send('/api/project','PUT',JSON.parse(proj));
}
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden') flush();
});

/* This strip used to warn that photos were too big for localStorage. Photos
   are in R2 now, so the only thing left worth shouting about is the server
   being unreachable. Header level, because it was invisible inside a panel. */
function showOffline(){
  const msg='Cannot reach the server. Your work is being held in this browser '+
    'and will be sent when the connection comes back. Do not close this tab.';
  for(const id of ['storeWarn','storeAlert']){
    const n=document.getElementById(id); if(!n) continue;
    n.hidden=online;
    if(!online) n.textContent=msg;
  }
}

/* ---------- image helpers ---------- */
/* Photos are content-addressed: the sha256 of the downscaled bytes is the
   key, so the same photo dropped six times is one object in the bucket.
   They are served back from /img/<sha> on this same origin, which is what
   keeps the export canvas untainted -- a cross-origin image would make
   canvas.toBlob() throw and take the whole zip with it. */
function decode(src){
  return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; });
}
async function hydrate(){
  await Promise.all(Object.keys(S.images).map(async sha=>{
    try{ IMG.set(sha, await decode(S.images[sha])); }
    catch(e){ delete S.images[sha]; }
  }));
}
async function sha256(blob){
  const h=await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const canvasBlobAs=(c,type,q)=>new Promise(r=>c.toBlob(r,type,q));

/* Keep PNG as PNG. Re-encoding a transparent image as JPEG turns the
   transparency black, which is a silent way to ruin someone's logo. */
async function shrink(file){
  const src=URL.createObjectURL(file);
  try{
    const im=await decode(src);
    const keepAlpha=/png|webp|gif|svg/i.test(file.type||'');
    const mime=keepAlpha?'image/png':'image/jpeg';
    const s=Math.min(1, MAXPX/Math.max(im.width,im.height));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.width*s)); c.height=Math.max(1,Math.round(im.height*s));
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    return {blob: await canvasBlobAs(c,mime,0.88), mime, w:c.width, h:c.height};
  } finally { URL.revokeObjectURL(src); }
}
/* Stored next to the original so opening the app pulls a few KB per photo
   for the list cards instead of every 2000px original. */
async function thumbBlob(blob){
  const src=URL.createObjectURL(blob);
  try{
    const im=await decode(src);
    const s=72/Math.max(im.width,im.height);
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.width*s)); c.height=Math.max(1,Math.round(im.height*s));
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    return canvasBlobAs(c,'image/jpeg',0.7);
  } finally { URL.revokeObjectURL(src); }
}
const THUMB=new Map();

/* ===========================================================
   TEXT FITTING
   =========================================================== */
/* One line in = one line out. The only break is a safety cap on
   runaway lines, counted in characters, never mid-word. */
const MAX_CHARS=32;
function wrapLine(line){
  if(!line.trim()) return [''];
  const t=line.trim();
  if(t.length<=MAX_CHARS) return [t];
  const words=t.split(/\s+/); const out=[]; let cur='';
  for(const w of words){
    const j=cur?cur+' '+w:w;
    if(j.length<=MAX_CHARS || !cur) cur=j;
    else { out.push(cur); cur=w; }
  }
  if(cur) out.push(cur);
  return out;
}
function blockMetrics(ctx, lines, size, lh){
  const m=ctx.measureText('HXO');
  const cap=m.actualBoundingBoxAscent || size*0.72;
  let w=0; for(const l of lines) w=Math.max(w, ctx.measureText(l).width);
  return {cap, w, h:(lines.length-1)*size*lh + cap};
}
function fitText(ctx, text, fontFam, weight, box, lh, capSize){
  const hard=String(text||'').toUpperCase().split('\n');
  let lo=10, hi=Math.min(capSize||9999, Math.floor(box.h*1.25)), best=null;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    ctx.font=weight+' '+mid+'px '+fontFam;
    let lines=[];
    for(const hl of hard) lines=lines.concat(wrapLine(hl));
    const bm=blockMetrics(ctx,lines,mid,lh);
    if(bm.h<=box.h && bm.w<=box.w){ best={size:mid,lines,...bm}; lo=mid+1; }
    else hi=mid-1;
  }
  if(!best){
    ctx.font=weight+' 10px '+fontFam;
    let lines=[]; for(const hl of hard) lines=lines.concat(wrapLine(hl));
    best={size:10,lines,...blockMetrics(ctx,lines,10,lh)};
  }
  return best;
}
/* Returns the rectangle it actually painted into, in canvas pixels. That is
   what makes the words tappable: the layout box is much bigger than the type
   inside it, and hit-testing the box would swallow taps meant for the photo. */
function drawFit(ctx, fit, fontFam, weight, box, lh, align, color, vAlign){
  ctx.font=weight+' '+fit.size+'px '+fontFam;
  ctx.fillStyle=color; ctx.textBaseline='alphabetic';
  ctx.textAlign = align==='center' ? 'center' : 'left';
  const x = align==='center' ? box.x+box.w/2 : box.x;
  let y0 = box.y + fit.cap;
  if(vAlign==='center') y0 = box.y + (box.h - fit.h)/2 + fit.cap;
  else if(vAlign==='bottom') y0 = box.y + box.h - fit.h + fit.cap;
  let wide=0;
  fit.lines.forEach((ln,i)=>{
    ctx.fillText(ln, x, y0 + i*fit.size*lh);
    wide=Math.max(wide, ctx.measureText(ln).width);
  });
  wide=Math.min(wide||box.w, box.w);
  return {x: align==='center' ? box.x+box.w/2-wide/2 : box.x,
          y: y0-fit.cap, w:wide, h:Math.max(fit.h, fit.size)};
}

/* ===========================================================
   GEOMETRY
   =========================================================== */
function metrics(W,H){
  const M=Math.round(W*0.0889);
  const tall=(H/W)>=1.6;
  const safeT = tall ? Math.round(H*0.125) : M;
  const safeB = tall ? Math.round(H*0.125) : M;
  const barH  = Math.round(W*0.098);
  const barY  = tall ? (H - safeB - barH) : (H - barH);
  return {M,tall,safeT,safeB,barH,barY,contentTop:safeT,
          contentBot:barY-Math.round(M*0.55), ch:(barY-Math.round(M*0.55))-safeT};
}
/* Layouts that never take a photo. */
const TEXT_ONLY=new Set(['type','split','slab','stamp']);
function effVariant(it){
  const img=it.img?IMG.get(it.img):null;
  return (it.variant==='stack' && !img) ? 'type' : it.variant;
}
/* The single source of truth for where the photo sits.
   render() and the drag handler both use this, so they cannot drift apart. */
function photoRect(it,W,H){
  const m=metrics(W,H), V=effVariant(it);
  if(V==='bleed') return {x:0,y:0,w:W,h:H};
  if(V==='band'){ return {x:0,y:0,w:W,h:m.contentTop+Math.round(m.ch*0.42)}; }
  if(TEXT_ONLY.has(V)) return null;
  const sq=(H/W)<1.2;                                  // square needs a taller band
  const gap=Math.round(m.ch*0.045);
  const topH=Math.round(m.ch*(sq?0.25:0.29)), botH=Math.round(m.ch*(sq?0.125:0.15));
  return {x:m.M, y:m.contentTop+topH+gap, w:W-m.M*2, h:m.ch-topH-botH-gap*2};
}
function coverBox(img,r,zoom){
  const s=Math.max(r.w/img.width, r.h/img.height)*(zoom/100);
  return {dw:img.width*s, dh:img.height*s};
}
function drawCover(ctx,img,r,zoom,fx,fy){
  const {dw,dh}=coverBox(img,r,zoom);
  const dx=r.x+(r.w-dw)*(fx/100), dy=r.y+(r.h-dh)*(fy/100);
  ctx.save(); ctx.beginPath(); ctx.rect(r.x,r.y,r.w,r.h); ctx.clip();
  ctx.drawImage(img,dx,dy,dw,dh); ctx.restore();
}

function drawBar(ctx,W,H,m){
  ctx.fillStyle=B.bar; ctx.fillRect(0,m.barY,W,m.barH);
  const maxW=W-m.M*2, maxH=m.barH*0.50, cy=m.barY+m.barH/2;
  const parts=[['ELECTION',B.onBar],['LOG',B.accentOnBar],['.ORG',B.muted]];
  const widthAt=sz=>{ ctx.font='400 '+sz+'px '+FD;
    return parts.reduce((a,p)=>a+ctx.measureText(p[0]).width,0); };
  let size=Math.round(maxH*1.34);
  while(size>8 && widthAt(size)>maxW) size=Math.floor(size*0.94);
  ctx.font='400 '+size+'px '+FD;
  const total=widthAt(size);
  ctx.font='400 '+size+'px '+FD;
  const cap=ctx.measureText('H').actualBoundingBoxAscent||size*0.72;
  let x=(W-total)/2, y=cy+cap/2;
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  for(const [t,c] of parts){ ctx.fillStyle=c; ctx.fillText(t,x,y); x+=ctx.measureText(t).width; }
}

function scrimGrad(ctx,W,H,strength){
  const a=strength/100; if(a<=0) return;
  const c=groundRGB();
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,   'rgba('+c+','+(a*0.95).toFixed(3)+')');
  g.addColorStop(0.34,'rgba('+c+','+(a*0.26).toFixed(3)+')');
  g.addColorStop(0.55,'rgba('+c+','+(a*0.38).toFixed(3)+')');
  g.addColorStop(0.78,'rgba('+c+','+(a*0.82).toFixed(3)+')');
  g.addColorStop(1,   'rgba('+c+','+(a*0.98).toFixed(3)+')');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}

/* Measured legibility floor: sample what actually landed behind the type
   and darken that strip until it can be read. Runs whatever the slider says. */
function ensureContrast(ctx,W,H,box,target){
  const x=Math.max(0,Math.round(box.x)), y=Math.max(0,Math.round(box.y));
  const w=Math.min(W-x,Math.round(box.w)), h=Math.min(H-y,Math.round(box.h));
  if(w<=0||h<=0) return;
  let d; try{ d=ctx.getImageData(x,y,w,h).data; }catch(e){ return; }
  let sum=0,n=0;
  for(let i=0;i<d.length;i+=4*23){ sum+=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; n++; }
  const lum=sum/Math.max(1,n);
  if(lum<=target) return;
  /* The floor is the luma of the paint itself -- it used to be 21, hand-tuned
     to the house navy, and a ground of any other lightness cannot darken
     past its own colour -- pretending otherwise overshoots the alpha. */
  const floor=lumOf(B.ground);
  const a=Math.min(0.88,Math.max(0,(lum-target)/Math.max(1,lum-floor)));
  const c=groundRGB();
  const pad=Math.round(h*0.42);
  const g=ctx.createLinearGradient(0,y-pad,0,y+h+pad);
  g.addColorStop(0,'rgba('+c+',0)');
  g.addColorStop(0.22,'rgba('+c+','+a.toFixed(3)+')');
  g.addColorStop(0.78,'rgba('+c+','+a.toFixed(3)+')');
  g.addColorStop(1,'rgba('+c+',0)');
  ctx.fillStyle=g; ctx.fillRect(0,y-pad,W,h+pad*2);
}

/* ===========================================================
   RENDER
   =========================================================== */
function render(ctx,W,H,it,guides){
  /* Where the two lines actually land, so a tap on the canvas can find them.
     Stamped on the context because render() is also called for the exports,
     and only the preview's rectangles are of any use to a pointer. */
  const R={top:null,bot:null};
  ctx.__rects=R;
  const m=metrics(W,H);
  const img = it.img ? IMG.get(it.img) : null;
  const V=effVariant(it);
  const pr=photoRect(it,W,H);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=B.ground; ctx.fillRect(0,0,W,H);
  const bw=W-m.M*2, lh=0.96;

  if(V==='bleed'){
    if(img) drawCover(ctx,img,pr,it.zoom,it.fx,it.fy);
    scrimGrad(ctx,W,H,img?it.scrim:0);
    const topBox={x:m.M,y:m.contentTop,w:bw,h:Math.round(m.ch*0.46)};
    const botBox={x:m.M,y:m.contentBot-Math.round(m.ch*0.17),w:bw,h:Math.round(m.ch*0.17)};
    const topFit=fitText(ctx,it.top,FD,'400',topBox,lh);
    const botFit=fitText(ctx,it.bot,FD,'400',botBox,lh);
    if(img){
      ensureContrast(ctx,W,H,{x:m.M,y:topBox.y,w:bw,h:Math.min(topBox.h,topFit.h*1.08)},104);
      ensureContrast(ctx,W,H,{x:m.M,y:botBox.y+botBox.h-botFit.h,w:bw,h:botFit.h*1.08},84);
    }
    R.top=drawFit(ctx, topFit, FD,'400',topBox,lh,it.align,B.onGround,'top');
    R.bot=drawFit(ctx, botFit, FD,'400',botBox,lh,it.align,B.accent,'bottom');
  }

  else if(V==='band'){
    if(img) drawCover(ctx,img,pr,it.zoom,it.fx,it.fy);
    else { ctx.fillStyle=B.ground; ctx.fillRect(pr.x,pr.y,pr.w,pr.h); }
    const photoBottom=pr.y+pr.h, bandH=Math.round(m.ch*0.30);
    ctx.fillStyle=B.accent; ctx.fillRect(0,photoBottom,W,bandH);
    const tb={x:m.M,y:photoBottom+Math.round(bandH*0.14),w:bw,h:Math.round(bandH*0.72)};
    R.top=drawFit(ctx, fitText(ctx,it.top,FD,'400',tb,lh), FD,'400',tb,lh,it.align,B.onAccent,'center');
    const bb={x:m.M,y:photoBottom+bandH+Math.round(m.ch*0.05),w:bw,
              h:m.contentBot-(photoBottom+bandH)-Math.round(m.ch*0.05)};
    if(bb.h>40) R.bot=drawFit(ctx, fitText(ctx,it.bot,FD,'400',bb,lh), FD,'400',bb,lh,it.align,B.onGround,'center');
  }

  else if(V==='type'){
    /* a full bleed rule: a short dash floating in the corner read as an accident */
    const rh=Math.max(8,Math.round(W*0.014));
    ctx.fillStyle=B.accent; ctx.fillRect(0,m.contentTop,W,rh);
    const topBox={x:m.M,y:m.contentTop+rh+Math.round(m.ch*0.06),w:bw,h:Math.round(m.ch*0.58)};
    const botBox={x:m.M,y:m.contentBot-Math.round(m.ch*0.20),w:bw,h:Math.round(m.ch*0.20)};
    R.top=drawFit(ctx, fitText(ctx,it.top,FD,'400',topBox,lh), FD,'400',topBox,lh,it.align,B.onGround,'top');
    R.bot=drawFit(ctx, fitText(ctx,it.bot,FD,'400',botBox,lh), FD,'400',botBox,lh,it.align,B.accent,'bottom');
  }

  /* --- text only: the canvas cut in half, dark question over gold answer --- */
  else if(V==='split'){
    const splitY=Math.round(m.contentTop+m.ch*0.52);
    ctx.fillStyle=B.accent; ctx.fillRect(0,splitY,W,m.barY-splitY);
    const pad=Math.round(m.ch*0.07);
    const tb={x:m.M,y:m.contentTop,w:bw,h:(splitY-m.contentTop)-pad};
    const bb={x:m.M,y:splitY+pad*0.7,w:bw,h:(m.barY-splitY)-pad*1.4};
    R.top=drawFit(ctx, fitText(ctx,it.top,FD,'400',tb,lh), FD,'400',tb,lh,it.align,B.onGround,'center');
    R.bot=drawFit(ctx, fitText(ctx,it.bot,FD,'400',bb,lh), FD,'400',bb,lh,it.align,B.onAccent,'center');
  }

  /* --- text only: gold sheet, the answer reversed out of a dark block --- */
  else if(V==='slab'){
    ctx.fillStyle=B.accent; ctx.fillRect(0,0,W,H);
    const sqs=(H/W)<1.2;
    const blockH=Math.round(m.ch*(sqs?0.31:0.26)), blockY=m.contentBot-blockH;
    const tb={x:m.M,y:m.contentTop,w:bw,h:(blockY-m.contentTop)-Math.round(m.ch*0.07)};
    R.top=drawFit(ctx, fitText(ctx,it.top,FD,'400',tb,lh), FD,'400',tb,lh,it.align,B.onAccent,'top');
    ctx.fillStyle=B.ground; ctx.fillRect(0,blockY,W,blockH);
    const bb={x:m.M,y:blockY+Math.round(blockH*0.17),w:bw,h:Math.round(blockH*0.66)};
    R.bot=drawFit(ctx, fitText(ctx,it.bot,FD,'400',bb,lh), FD,'400',bb,lh,it.align,B.accent,'center');
  }

  /* --- text only: a gold rule drawn all the way round, type centred inside --- */
  else if(V==='stamp'){
    const lw=Math.max(4,Math.round(W*0.009));
    const fx=Math.round(m.M*0.60);
    const fy=m.tall ? Math.round(m.safeT*0.74) : fx;
    const fb=m.barY-Math.round(m.M*0.45);
    ctx.strokeStyle=B.accent; ctx.lineWidth=lw;
    ctx.strokeRect(fx+lw/2, fy+lw/2, W-fx*2-lw, (fb-fy)-lw);
    const inx=fx+Math.round(W*0.06), inw=W-inx*2;
    const inH=(fb-fy)*0.82, inY=fy+(fb-fy)*0.09;
    const tb={x:inx,y:Math.round(inY),w:inw,h:Math.round(inH*0.60)};
    const bb={x:inx,y:Math.round(inY+inH*0.66),w:inw,h:Math.round(inH*0.34)};
    R.top=drawFit(ctx, fitText(ctx,it.top,FD,'400',tb,lh), FD,'400',tb,lh,it.align,B.onGround,'center');
    R.bot=drawFit(ctx, fitText(ctx,it.bot,FD,'400',bb,lh), FD,'400',bb,lh,it.align,B.accent,'bottom');
  }

  else { /* stack */
    const sq=(H/W)<1.2;
    const topH=Math.round(m.ch*(sq?0.25:0.29)), botH=Math.round(m.ch*(sq?0.125:0.15));
    const topBox={x:m.M,y:m.contentTop,w:bw,h:topH};
    const botBox={x:m.M,y:pr.y+pr.h+Math.round(m.ch*0.045),w:bw,h:botH};
    R.top=drawFit(ctx, fitText(ctx,it.top,FD,'400',topBox,lh), FD,'400',topBox,lh,it.align,B.onGround,'center');
    drawCover(ctx,img,pr,it.zoom,it.fx,it.fy);
    R.bot=drawFit(ctx, fitText(ctx,it.bot,FD,'400',botBox,lh), FD,'400',botBox,lh,it.align,B.accent,'center');
  }

  drawBar(ctx,W,H,m);

  if(guides){
    ctx.save();
    ctx.strokeStyle='rgba(41,107,96,.95)'; ctx.setLineDash([16,12]); ctx.lineWidth=Math.max(2,W*0.003);
    ctx.strokeRect(m.M,m.safeT,W-m.M*2,m.barY-m.safeT);
    ctx.restore();
  }
}

let previewCtx=null;
function renderTo(canvas,W,H,it,guides){
  canvas.width=W; canvas.height=H;
  const ctx = (canvas.id==='preview' && previewCtx) ? previewCtx : canvas.getContext('2d');
  ctx.textRendering='geometricPrecision';
  render(ctx,W,H,it,guides);
  return canvas;
}

/* ===========================================================
   ZIP (store only: PNGs are already compressed)
   =========================================================== */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0}return t})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC[(c^u8[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function dosTime(d){return ((d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2))&0xFFFF}
function dosDate(d){return (((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF}
function zip(files){
  const enc=new TextEncoder(), now=new Date(), t=dosTime(now), dt=dosDate(now);
  const chunks=[], central=[]; let offset=0;
  for(const f of files){
    const name=enc.encode(f.name), data=f.data, c=crc32(data);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0,true);
    lh.setUint16(8,0,true); lh.setUint16(10,t,true); lh.setUint16(12,dt,true);
    lh.setUint32(14,c,true); lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true);
    lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
    chunks.push(new Uint8Array(lh.buffer),name,data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0,true); ch.setUint16(10,0,true); ch.setUint16(12,t,true); ch.setUint16(14,dt,true);
    ch.setUint32(16,c,true); ch.setUint32(20,data.length,true); ch.setUint32(24,data.length,true);
    ch.setUint16(28,name.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true); ch.setUint32(42,offset,true);
    central.push(new Uint8Array(ch.buffer),name);
    offset+=30+name.length+data.length;
  }
  let csize=0; for(const c of central) csize+=c.length;
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,csize,true); end.setUint32(16,offset,true); end.setUint16(20,0,true);
  return new Blob([...chunks,...central,new Uint8Array(end.buffer)],{type:'application/zip'});
}

function slug(s){
  return String(s||'untitled').toLowerCase().replace(/['"]/g,'').replace(/[^a-z0-9]+/g,'-')
         .replace(/^-+|-+$/g,'').slice(0,44) || 'untitled';
}
const VNAME={stack:'a photo with the line above it',bleed:'a full-frame photo',band:'a gold band',
  type:'plain type on a dark ground',
  split:'a dark upper half above a gold lower half',
  slab:'a gold ground with the second line reversed out of a dark block',
  stamp:'plain type inside a gold rule drawn all the way round'};
function altText(it){
  const top=String(it.top).replace(/\n/g,' ').trim(), bot=String(it.bot).replace(/\n/g,' ').trim();
  return 'ElectionLog graphic. Large type reading "'+top+'" with "'+bot+'" below, set on '+
         VNAME[effVariant(it)]+'. The ElectionLog.org mark sits in a white bar along the bottom.';
}
function caption(it){
  const top=String(it.top).replace(/\n/g,' ').trim(), bot=String(it.bot).replace(/\n/g,' ').trim();
  return top+' '+bot+'\n\n'+(S.caption||'').trim();
}

/* ===========================================================
   UI
   =========================================================== */
const $=s=>document.querySelector(s);
const el={
  editing:$('#editingWhat'),
  segV:$('#segVariant'), segA:$('#segAlign'),
  drop:$('#drop'), lib:$('#lib'), cropBlock:$('#cropBlock'),
  zoom:$('#fZoom'), scrim:$('#fScrim'), vZoom:$('#vZoom'), vScrim:$('#vScrim'),
  darkenField:$('#darkenField'), darkenNote:$('#darkenNote'),
  pvSwitch:$('#pvSwitch'), pvSize:$('#pvSize'),
  line:$('#fLine'), lineLabel:$('#lineLabel'), lineTitle:$('#lineTitle'),
  textmark:$('#textmark'), frame:$('#frame'),
  canvas:$('#preview'), status:$('#status'), exportCount:$('#exportCount'),
  dragHint:$('#dragHint'),
  toast:$('#toast'), toastText:$('#toastText')
};
previewCtx = el.canvas.getContext('2d',{willReadFrequently:true});
const cur=()=> S.items.find(i=>i.id===S.sel) || null;

function status(msg,kind){ el.status.textContent=msg||''; el.status.className='status'+(kind?' '+kind:''); }

/* ---------- undo ---------- */
/* The toast can be flicked away in either direction. Swiping only dismisses
   it; it never triggers the undo, which is what the button is for. */
let undoFn=null, undoGone=null, undoT=null;
let tDrag=false, tStartX=0, tX=0, tMoved=0;

function hideToast(){
  clearTimeout(undoT);
  /* The undo window closed without being used: make the removal real. */
  const gone=undoGone; undoFn=null; undoGone=null; if(gone) gone();
  el.toast.hidden=true;
  el.toast.style.transition='none';
  el.toast.style.transform=''; el.toast.style.opacity='';
  requestAnimationFrame(()=>{ el.toast.style.transition=''; });
}
function offerUndo(text, fn, onExpire){
  undoFn=fn; undoGone=onExpire||null; el.toastText.textContent=text;
  el.toast.style.transition='none';
  el.toast.style.transform=''; el.toast.style.opacity='';
  el.toast.hidden=false;
  requestAnimationFrame(()=>{ el.toast.style.transition=''; });
  clearTimeout(undoT); undoT=setTimeout(hideToast, 4500);
}
el.toast.addEventListener('pointerdown',e=>{
  if(el.toast.hidden) return;
  tDrag=true; tStartX=e.clientX; tX=0; tMoved=0;
  el.toast.style.transition='none';
  clearTimeout(undoT);                    // do not vanish mid-swipe
});
window.addEventListener('pointermove',e=>{
  if(!tDrag) return;
  tX=e.clientX-tStartX; tMoved=Math.abs(tX);
  el.toast.style.transform='translateX('+tX+'px)';
  el.toast.style.opacity=String(Math.max(0, 1-tMoved/220));
});
window.addEventListener('pointerup',()=>{
  if(!tDrag) return;
  tDrag=false;
  el.toast.style.transition='';
  const w=el.toast.getBoundingClientRect().width||240;
  if(tMoved > Math.min(90, w*0.35)){
    el.toast.style.transform='translateX('+(tX>0 ? w+80 : -(w+80))+'px)';
    el.toast.style.opacity='0';
    setTimeout(hideToast,170);
  }else{
    el.toast.style.transform=''; el.toast.style.opacity='';
    if(!el.toast.hidden){ clearTimeout(undoT); undoT=setTimeout(hideToast,4500); }
  }
});
$('#toastUndo').addEventListener('click',()=>{
  if(tMoved>6) return;                    // that was a swipe, not a tap
  const fn=undoFn; undoGone=null; hideToast();   // undone, so nothing to finalise
  if(fn){ fn(); commit(); }
});

/* ---------- canvas sizing ---------- */
/* The frame is the reserved content box: it is the same size whether a panel
   is open or not, so the graphic is sized once and never jumps. */
function fitCanvasToStage(){
  const fr=document.getElementById('frame'); if(!fr) return;
  const r=fr.getBoundingClientRect(), cs=getComputedStyle(fr);
  const availW=Math.max(40,r.width -parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight));
  const availH=Math.max(40,r.height-parseFloat(cs.paddingTop) -parseFloat(cs.paddingBottom));
  const s=Math.min(availW/el.canvas.width, availH/el.canvas.height);
  el.canvas.style.width=Math.floor(el.canvas.width*s)+'px';
  el.canvas.style.height=Math.floor(el.canvas.height*s)+'px';
}
window.addEventListener('resize',fitCanvasToStage);

function drawPreview(){
  const it=cur();
  const sz=SIZES.find(s=>s.id===S.pv)||SIZES[1];
  el.pvSize.textContent=sz.label;
  if(!it){
    el.canvas.width=sz.w; el.canvas.height=sz.h;
    previewCtx.fillStyle=B.ground; previewCtx.fillRect(0,0,sz.w,sz.h);
    previewCtx.fillStyle=B.muted; previewCtx.textAlign='center'; previewCtx.font='500 34px '+FM;
    previewCtx.fillText('NOTHING SELECTED',sz.w/2,sz.h/2);
    el.dragHint.hidden=true;
    el.canvas.classList.remove('grab'); fitCanvasToStage(); return;
  }
  renderTo(el.canvas,sz.w,sz.h,forSize(it,sz.id),S.guides);
  fitCanvasToStage();
  const room=panRoom(it);
  const movable=!!room;
  el.canvas.classList.toggle('grab', movable && (room.x>1||room.y>1));
  el.dragHint.hidden=!movable;
  if(movable){
    el.dragHint.textContent = (room.x>1||room.y>1)
      ? 'Drag to move  ·  scroll to zoom'
      : 'Zoom in to reposition';
  }
}

/* ===========================================================
   DRAG TO POSITION, SCROLL AND PINCH TO ZOOM
   =========================================================== */
let dragging=false, lastPt=null, movedPx=0, pinch=null;
function canvasScale(){ return el.canvas.width / el.canvas.getBoundingClientRect().width; }

function panBy(it,ddx,ddy){
  const sz=SIZES.find(s=>s.id===S.pv)||SIZES[1];
  const r=photoRect(it,sz.w,sz.h); if(!r) return;
  const img=IMG.get(it.img); if(!img) return;
  const {dw,dh}=coverBox(img,r,it.zoom);
  const spanX=r.w-dw, spanY=r.h-dh;      // negative while the photo overflows
  if(Math.abs(spanX)>1) it.fx=clamp(it.fx + ddx*100/spanX, 0, 100);
  if(Math.abs(spanY)>1) it.fy=clamp(it.fy + ddy*100/spanY, 0, 100);
}
/* Travel available in canvas pixels on each axis. Zero means the photo
   already fits the frame exactly, and the honest advice is to zoom in. */
function panRoom(it){
  const sz=SIZES.find(s=>s.id===S.pv)||SIZES[1];
  const r=it&&it.img?photoRect(it,sz.w,sz.h):null;
  const img=it&&it.img?IMG.get(it.img):null;
  if(!r||!img) return null;
  const {dw,dh}=coverBox(img,r,it.zoom);
  return {x:Math.max(0,dw-r.w), y:Math.max(0,dh-r.h)};
}
function canMove(){
  const it=cur(); if(!it||!it.img||!IMG.get(it.img)) return false;
  const sz=SIZES.find(s=>s.id===S.pv)||SIZES[1];
  return !!photoRect(it,sz.w,sz.h);
}
el.canvas.addEventListener('pointerdown',e=>{
  movedPx=0;
  /* The words come first. Without this a tap on type sitting over a photo
     would start a pan instead, and the one layout where the type IS on the
     photo is the one people reach for most. */
  const hit=hitText(e.clientX,e.clientY);
  if(hit){
    /* preventDefault stops the browser handing focus back to the page when
       the press completes -- without it the field is focused and then
       immediately blurred, and typing goes nowhere. */
    e.preventDefault();
    tappedText=true; editText(hit); return;
  }
  if(editing) stopEditing();
  if(!canMove()) return;
  if(e.pointerType!=='mouse' && pinch) return;
  el.canvas.setPointerCapture(e.pointerId);
  dragging=true; lastPt={x:e.clientX,y:e.clientY};
  el.canvas.classList.add('grabbing');
});
el.canvas.addEventListener('pointermove',e=>{
  if(!dragging||!lastPt) return;
  const it=cur(); if(!it) return;
  const k=canvasScale();
  const ddx=(e.clientX-lastPt.x)*k, ddy=(e.clientY-lastPt.y)*k;
  movedPx+=Math.abs(e.clientX-lastPt.x)+Math.abs(e.clientY-lastPt.y);
  lastPt={x:e.clientX,y:e.clientY};
  panBy(it,ddx,ddy);
  drawPreview();
});
function endDrag(e){
  if(!dragging) return;
  dragging=false; lastPt=null;
  el.canvas.classList.remove('grabbing');
  try{ el.canvas.releasePointerCapture(e.pointerId); }catch(_){}
  save();
}
el.canvas.addEventListener('pointerup',endDrag);
el.canvas.addEventListener('pointercancel',endDrag);

/* A pointer over the words says so, on anything with a real cursor. */
el.canvas.addEventListener('pointermove',e=>{
  if(dragging || e.pointerType!=='mouse') return;
  el.canvas.classList.toggle('overtext', !!hitText(e.clientX,e.clientY));
});
el.canvas.addEventListener('pointerleave',()=>el.canvas.classList.remove('overtext'));

el.canvas.addEventListener('wheel',e=>{
  const it=cur(); if(!it||!canMove()) return;
  e.preventDefault();
  it.zoom=clamp(Math.round(it.zoom + (e.deltaY<0?5:-5)),100,400);
  el.zoom.value=it.zoom; el.vZoom.textContent=it.zoom+'%';
  drawPreview(); save();
},{passive:false});

/* two-finger pinch */
const pts=new Map();
el.canvas.addEventListener('pointerdown',e=>{ pts.set(e.pointerId,e); if(pts.size===2){ dragging=false; pinch=dist(); } });
el.canvas.addEventListener('pointermove',e=>{
  if(!pts.has(e.pointerId)) return;
  pts.set(e.pointerId,e);
  if(pts.size===2 && pinch){
    const it=cur(); if(!it||!canMove()) return;
    const d=dist();
    it.zoom=clamp(Math.round(it.zoom*(d/pinch)),100,400);
    pinch=d;
    el.zoom.value=it.zoom; el.vZoom.textContent=it.zoom+'%';
    drawPreview();
  }
});
function clearPt(e){ pts.delete(e.pointerId); if(pts.size<2){ pinch=null; } }
el.canvas.addEventListener('pointerup',clearPt);
el.canvas.addEventListener('pointercancel',clearPt);
function dist(){ const a=[...pts.values()]; return Math.hypot(a[0].clientX-a[1].clientX,a[0].clientY-a[1].clientY); }

/* renderList stays as a no-op because commit() calls it, so every edit path
   keeps the same shape. Reordering went with the list itself. */
function renderList(){}

function libHighlight(){
  const it=cur();
  [...el.lib.children].forEach(n=>n.classList.toggle('on',
    n.dataset.img ? (it&&it.img===n.dataset.img) : !(it&&it.img)));
}
function renderLib(){
  el.lib.innerHTML='';
  const it=cur();
  if(Object.keys(S.images).length){
    const none=document.createElement('div');
    none.className='p none'+(it&&!it.img?' on':'');
    none.textContent='NO PHOTO';
    none.addEventListener('click',()=>{
      const c=cur(); if(!c) return;
      c.img=null; libHighlight(); renderList(); syncEditor(); drawPreview(); save();
    });
    el.lib.appendChild(none);
  }
  Object.keys(S.images).forEach(id=>{
    const p=document.createElement('div');
    const inUse=!!(it&&it.img===id);
    p.className='p'+(inUse?' on':'');
    p.dataset.img=id;
    p.title='Use this photo';
    p.style.backgroundImage='url('+(THUMB.get(id)||S.images[id])+')';
    /* Delete only ever appears on the photo in use. Seven of these over a row
       of thumbnails is how you lose a picture by aiming at one. */
    p.innerHTML=inUse?'<button class="x" title="Delete this image" aria-label="Delete this image">&times;</button>':'';
    p.addEventListener('click',e=>{
      if(e.target.classList.contains('x')) return;
      const c=cur(); if(!c) return;
      c.img=id;                                  // select only, never unselect
      libHighlight(); renderList(); syncEditor(); drawPreview(); save();
    });
    const xb=p.querySelector('.x');
    if(xb) xb.addEventListener('click',e=>{
      e.stopPropagation();
      const url=S.images[id], img=IMG.get(id), th=THUMB.get(id);
      const used=S.items.filter(i=>i.img===id).map(i=>i.id);
      delete S.images[id]; IMG.delete(id); THUMB.delete(id);
      S.items.forEach(i=>{ if(i.img===id) i.img=null; });
      /* Detach straight away, but leave the bytes in R2 until the toast
         goes. Deleting first would make undo a re-upload. */
      offerUndo('Image removed',()=>{
        S.images[id]=url; IMG.set(id,img); THUMB.set(id,th);
        S.items.forEach(i=>{ if(used.includes(i.id)) i.img=id; });
      }, ()=>{ api('/api/images/'+id,{method:'DELETE'}).catch(()=>{}); });
      commit();
    });
    el.lib.appendChild(p);
  });
}

function syncEditor(){
  const it=cur();
  el.editing.textContent = it
    ? (String(it.top).replace(/\n/g,' ').trim().slice(0,28) || 'Untitled') + ' \u00b7 unsaved'
    : 'Nothing open';
  ['fLine','fZoom','fScrim'].forEach(id=>{ $('#'+id).disabled=!it; });
  if(!it){ el.cropBlock.style.display='none'; return; }
  if(editing && document.activeElement!==el.line) el.line.value=it[editing];
  [...el.segV.children].forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.v===it.variant)));
  [...el.segA.children].forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.a===it.align)));
  const cv=cropView(it);
  el.zoom.value=cv.zoom; el.scrim.value=it.scrim;
  el.vZoom.textContent=cv.zoom+'%'; el.vScrim.textContent=it.scrim+'%';
  syncTuneBar(it);

  const V=effVariant(it), hasPhoto=!!(it.img && IMG.get(it.img));
  el.cropBlock.style.display = (hasPhoto && !TEXT_ONLY.has(V)) ? '' : 'none';
  /* Darkening only does anything where type sits on the photo. Elsewhere it is
     hidden rather than left there doing nothing. */
  const darkenApplies = V==='bleed';
  el.darkenField.hidden = !darkenApplies;
  el.darkenNote.hidden  = darkenApplies;
}
/* ===========================================================
   TAP THE WORDS TO CHANGE THEM
   There is no Words tab. The two lines are the only editable text on a
   graphic, so they are edited where they are: tap one on the canvas and the
   panel opens on that line alone. render() leaves the rectangles it painted
   on the preview context; everything here is hit-testing them.
   =========================================================== */
let editing=null;                       // 'top' | 'bot' | null
let tappedText=false;                   // the click after a tap on the words

/* Canvas pixels per CSS pixel, and the canvas rect, in one go. */
function pvMap(){
  const r=el.canvas.getBoundingClientRect();
  return {r, k: el.canvas.width/Math.max(1,r.width)};
}
/* Which line is under a pointer, if any. The pad is a fingertip: type sits
   tight to its own bounding box and nobody taps dead centre. */
function hitText(clientX, clientY){
  const rects=previewCtx && previewCtx.__rects; if(!rects) return null;
  const {r,k}=pvMap();
  const x=(clientX-r.left)*k, y=(clientY-r.top)*k;
  const pad=28*k;
  for(const which of ['top','bot']){
    const q=rects[which]; if(!q) continue;
    if(x>=q.x-pad && x<=q.x+q.w+pad && y>=q.y-pad && y<=q.y+q.h+pad) return which;
  }
  return null;
}
function editText(which){
  const it=cur(); if(!it) return;
  editing=which;
  el.lineLabel.textContent = which==='top' ? 'Top line' : 'Bottom line';
  el.lineTitle.textContent = which==='top' ? 'Top line' : 'Bottom line';
  el.line.value=it[which];
  el.line.placeholder = which==='top' ? 'LONG LINE?' : 'LOG IT.';
  if(openPanel!=='text') showPanel('text');
  markEditing();
  /* Selecting the lot means the first keystroke replaces the placeholder
     wording, which is what anybody tapping a line called LONG LINE? wants. */
  el.line.focus({preventScroll:true}); el.line.select();
  /* Again on the next frame: opening the panel moves the field, and a press
     that is still in flight can take the focus back with it. */
  requestAnimationFrame(()=>{
    if(editing!==which) return;
    if(document.activeElement!==el.line){ el.line.focus({preventScroll:true}); el.line.select(); }
    markEditing();
  });
}
/* A dotted box on the line being edited, so it is obvious which one the
   panel is pointed at. Drawn as an overlay, not into the canvas, so typing
   does not have to redraw it. */
function markEditing(){
  const box=el.textmark; if(!box) return;
  const rects=previewCtx && previewCtx.__rects;
  const q=editing && rects && rects[editing];
  if(!q || openPanel!=='text'){ box.hidden=true; return; }
  const {r,k}=pvMap(), f=el.frame.getBoundingClientRect(), sc=1/k;
  box.hidden=false;
  box.style.left  =(r.left-f.left + q.x*sc - 6)+'px';
  box.style.top   =(r.top -f.top  + q.y*sc - 6)+'px';
  box.style.width =(q.w*sc + 12)+'px';
  box.style.height=(q.h*sc + 12)+'px';
}
function stopEditing(){
  if(!editing) return;
  editing=null;
  markEditing();
  if(openPanel==='text') closeDrawer();
}

function select(id){ S.sel=id; commit(); }
function commit(){ renderList(); renderLib(); syncEditor(); drawPreview(); save(); }

/* The stage switcher, and nothing else. Which sizes get made is not a
   choice any more -- it is all of them -- so the only thing left to pick is
   which one you are looking at. */
function buildChips(){
  el.pvSwitch.innerHTML='';
  SIZES.forEach(s=>{
    const p=document.createElement('button');
    /* Aspect, not pixel height: "4:5" is the same word the crop bar uses, and
       1350 meant nothing to anybody. */
    p.className='chip'; p.type='button'; p.textContent=s.aspect;
    p.title=s.label;
    p.setAttribute('aria-pressed', String(S.pv===s.id));
    p.addEventListener('click',()=>{ S.pv=s.id; buildChips(); drawPreview(); save(); });
    el.pvSwitch.appendChild(p);
  });
}

/* ---------- wiring ---------- */
el.line.addEventListener('input',()=>{
  const it=cur(); if(!it||!editing) return;
  it[editing]=el.line.value;
  drawPreview(); markEditing(); save();
});
/* Enter is a line break inside a line -- that is how somebody controls where
   it wraps -- so Done is a button and Escape is the way out. */
el.line.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.preventDefault(); stopEditing(); } });
$('#lineDone').addEventListener('click',stopEditing);
$('#lineOther').addEventListener('click',()=>editText(editing==='top'?'bot':'top'));
el.segV.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; const it=cur(); if(!it)return; it.variant=b.dataset.v; commit(); });
el.segA.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; const it=cur(); if(!it)return; it.align=b.dataset.a; commit(); });
el.zoom.addEventListener('input',()=>{ const it=cur(); if(!it)return;
  cropTarget(it).zoom=+el.zoom.value; el.vZoom.textContent=el.zoom.value+'%';
  /* The first nudge is what creates the override, so the bar has to restate
     which sizes now differ -- this path does not go through commit(). */
  syncTuneBar(it);
  drawPreview(); save(); });
el.scrim.addEventListener('input',()=>{ const it=cur(); if(!it)return; it.scrim=+el.scrim.value; el.vScrim.textContent=it.scrim+'%'; drawPreview(); save(); });

$('#btnRecentre').addEventListener('click',()=>{ const it=cur(); if(!it)return;
  const t=cropTarget(it); t.fx=50; t.fy=50; t.zoom=100; commit(); });
/* "Use this photo for all" applied it across the list. One graphic at a
   time means there is no all. */
$('#btnGuides').addEventListener('click',e=>{
  S.guides=!S.guides;
  /* Short label, long aria-label: the eyebrow above it already says what it
     toggles, and "Show safe margins" does not fit beside the alignment
     buttons on a phone in either orientation. */
  e.currentTarget.setAttribute('aria-pressed',String(S.guides));
  e.currentTarget.textContent = S.guides?'Hide':'Show';
  e.currentTarget.setAttribute('aria-label',(S.guides?'Hide':'Show')+' safe margins');
  drawPreview(); save();
});

async function addFiles(files){
  const list=[...files].filter(f=>/^image\//.test(f.type));
  if(!list.length) return;
  status(list.length===1?'Adding image...':'Adding '+list.length+' images...');
  let added=0, failed=0;
  for(const f of list){
    try{
      const {blob,mime,w,h}=await shrink(f);
      const sha=await sha256(blob);
      /* The same photo twice is the same bytes, so ask before uploading. */
      const {have}=await (await api('/api/have/'+sha)).json();
      if(!have){
        await api('/api/images/'+sha+'?w='+w+'&h='+h,
                  {method:'PUT', headers:{'Content-Type':mime}, body:blob});
        await api('/api/thumbs/'+sha,
                  {method:'PUT', headers:{'Content-Type':'image/jpeg'}, body:await thumbBlob(blob)});
      }
      S.images[sha]='/img/'+sha;
      THUMB.set(sha,'/thumb/'+sha);
      IMG.set(sha, await decode(S.images[sha]));
      const it=cur(); if(it && !it.img) it.img=sha;
      added++;
    }catch(e){ failed++; }
  }
  commit();
  if(failed) status(failed+' of '+list.length+' could not be uploaded.','bad');
  else status(added+(added===1?' image added':' images added'),'ok');
}
function hookDrop(node, handler){
  node.addEventListener('click',()=>{
    const i=document.createElement('input'); i.type='file'; i.accept='image/*'; i.multiple=true;
    i.onchange=()=>handler(i.files); i.click();
  });
  node.addEventListener('dragover',e=>{e.preventDefault();node.classList.add('over')});
  node.addEventListener('dragleave',()=>node.classList.remove('over'));
  node.addEventListener('drop',e=>{e.preventDefault();node.classList.remove('over');handler(e.dataTransfer.files)});
}
hookDrop(el.drop, addFiles);

/* Adding, duplicating, seeding, clearing and bulk paste all drove the list.
   One graphic at a time means the home screen's photo question is the only
   way a graphic starts. */
$('#btnHelp').addEventListener('click',()=>$('#dlgHelp').showModal());
$('#helpClose').addEventListener('click',()=>$('#dlgHelp').close());
/* ---------- export ---------- */
let cancelExport=false;
function canvasBlob(c){ return new Promise(r=>c.toBlob(r,'image/png')); }

/* ===========================================================
   SAVE TO LIBRARY
   A graphic is finished when it is saved, and never edited again. The row
   keeps the recipe -- the words, the layout, the crop -- so the library can
   say what a graphic is without decoding a PNG; the PNGs are what everything
   downstream actually uses.
   =========================================================== */

/* toBlob falls back to PNG for a type it cannot encode, silently, and the
   Worker hardcodes image/png on the way in. Check rather than trust. */
async function pngBlob(c){
  const b=await canvasBlob(c);
  if(!b) throw new Error('the browser would not encode this canvas');
  if(b.type && b.type!=='image/png') throw new Error('unexpected encoding '+b.type);
  return b;
}

/* effVariant() quietly downgrades stack to type when the photo is missing,
   so rendering before the image has decoded produces the WRONG LAYOUT with
   no error at all. Everything that renders for real waits on this first. */
async function ensurePhoto(it){
  if(!it.img) return true;
  if(IMG.get(it.img)) return true;
  const url=S.images[it.img];
  if(!url) return false;
  try{ IMG.set(it.img, await decode(url)); return true; }
  catch(e){ return false; }
}

/* Render one graphic at every size and hand back blobs. per_size holds the
   crop overrides for a size; anything absent used the graphic's own crop. */
async function renderAll(it, sizes, perSize){
  const out=[];
  for(const sz of sizes){
    const o=(perSize||{})[sz.id]||{};
    const shot={...it, zoom:o.zoom??it.zoom, fx:o.fx??it.fx, fy:o.fy??it.fy};
    const c=renderTo(document.createElement('canvas'), sz.w, sz.h, shot, false);
    out.push({size:sz.id, blob:await pngBlob(c)});
  }
  return out;
}

async function saveToLibrary(it, collectionId, opts){
  const o=opts||{};
  const sizes=SIZES;                       // always every size: see HANDOFF 10
  const step=o.onStep||(()=>{});
  if(!await ensurePhoto(it)) throw new Error('that photo could not be loaded, so the layout would come out wrong');

  step('Drawing '+sizes.length+' sizes...');
  const renders=await renderAll(it, sizes, o.perSize);

  const created=await (await api('/api/graphics',{method:'POST',...asJson({
    collection_id:collectionId,
    title:String(it.top).replace(/\n/g,' ').trim(),
    top:it.top, bot:it.bot, variant:it.variant, align:it.align,
    photo_sha:it.img||null, scrim:it.scrim,
    per_size:o.perSize||{}, alt:altText(it)
  })})).json();
  const id=created.id;

  /* rev 1: uploads first, commit last. The row only points at these renders
     once every one of them is confirmed in the bucket, so a save that dies
     halfway leaves nothing half-finished in the library. */
  let n=0;
  for(const r of renders){
    step('Uploading '+(++n)+' of '+renders.length+'...');
    await api('/api/graphics/'+id+'/renders/1/'+r.size,
              {method:'PUT', headers:{'Content-Type':'image/png'}, body:r.blob});
  }
  step('Filing it...');
  await api('/api/graphics/'+id+'/finish',{method:'POST',...asJson({
    sizes:renders.map(r=>r.size), rev:1
  })});
  return {id, rev:1, sizes:renders.map(r=>r.size)};
}

function download(blob,name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);
}
function indexOfSel(){ return S.items.findIndex(x=>x.id===S.sel); }
$('#btnOne').addEventListener('click',async()=>{
  const it=cur(); if(!it) return status('Select a graphic first','err');
  const sz=SIZES.find(s=>s.id===S.pv);
  const c=renderTo(document.createElement('canvas'),sz.w,sz.h,it,false);
  const base=String(indexOfSel()+1).padStart(2,'0')+'_'+slug(it.top);
  download(await canvasBlob(c), base+'_'+sz.id+'.png');
  status('Downloaded '+base+'_'+sz.id+'.png','ok');
});
$('#btnCopy').addEventListener('click',async()=>{
  const it=cur(); if(!it) return status('Select a graphic first','err');
  const sz=SIZES.find(s=>s.id===S.pv);
  const c=renderTo(document.createElement('canvas'),sz.w,sz.h,it,false);
  try{
    await navigator.clipboard.write([new ClipboardItem({'image/png':await canvasBlob(c)})]);
    status('Copied to clipboard','ok');
  }catch(e){ status('This browser would not allow the clipboard write. Use download instead.','err'); }
});
$('#btnCancel').addEventListener('click',()=>{ cancelExport=true; status('Stopping...'); });
$('#btnExport').addEventListener('click',async()=>{
  const it=cur();
  if(!it) return status('Nothing on the bench','err');
  const btn=$('#btnExport'), stop=$('#btnCancel');
  btn.disabled=true; stop.hidden=false; cancelExport=false;
  const files=[];
  const base=slug(it.top);
  const work=document.createElement('canvas');
  try{
    let n=0;
    for(const s of SIZES){
      if(cancelExport) break;
      renderTo(work,s.w,s.h,it,false);
      const b=await canvasBlob(work);
      files.push({name:base+'_'+s.id+'.png', data:new Uint8Array(await b.arrayBuffer())});
      n++; status('Rendering '+n+' of '+SIZES.length+'...');
      await new Promise(r=>setTimeout(r,0));
    }
    if(cancelExport){ status('Stopped. Nothing downloaded.','err'); return; }
    const head='ELECTIONLOG GRAPHIC\nGenerated '+new Date().toLocaleString()+'\n'+
      SIZES.map(s=>s.label).join(' / ')+
      '\n\nNothing here is approved copy. Check it before it goes out.\n\n\n'+
      '== '+it.top.replace(/\n/g,' ')+' '+it.bot.replace(/\n/g,' ')+' ==\n'+
      'FILES: '+SIZES.map(s=>base+'_'+s.id+'.png').join(', ')+'\n\n'+
      'CAPTION:\n'+caption(it)+'\n\nIMAGE DESCRIPTION:\n'+altText(it)+'\n';
    files.push({name:'captions.txt', data:new TextEncoder().encode(head)});
    download(zip(files),'electionlog-graphic_'+new Date().toISOString().slice(0,10)+'.zip');
    status(files.length+' files in the zip. Done.','ok');
  }catch(e){
    status('Export failed: '+e.message,'err');
  }finally{ btn.disabled=false; stop.hidden=true; }
});

/* ===========================================================
   DRAWER, TABS AND NAVIGATION
   =========================================================== */
const drawer=document.getElementById('drawer');
const tabs=document.getElementById('tabs');
let openPanel=null;
function showPanel(name){
  if(openPanel===name){ closeDrawer(); return; }
  openPanel=name; drawer.hidden=false;
  /* Any other panel means the words are no longer what is being edited. */
  if(name!=='text'){ editing=null; if(el.textmark) el.textmark.hidden=true; }
  drawer.querySelectorAll('.panel').forEach(p=>{ p.hidden=(p.id!=='p-'+name); });
  tabs.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-expanded', String(t.dataset.p===name)));
  drawer.scrollTop=0;
  document.body.classList.add('drawer-open');
  requestAnimationFrame(()=>drawer.classList.toggle('scrolls', drawer.scrollHeight>drawer.clientHeight+2));
  requestAnimationFrame(drawPreview);
}
function closeDrawer(){
  openPanel=null; drawer.hidden=true;
  editing=null; if(el.textmark) el.textmark.hidden=true;
  document.body.classList.remove('drawer-open');
  tabs.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-expanded','false'));
  requestAnimationFrame(drawPreview);
}
tabs.addEventListener('click',e=>{ const t=e.target.closest('.tab'); if(t) showPanel(t.dataset.p); });
/* only a click on empty stage closes the drawer, never a drag on the graphic */
let pressTarget=null;
document.getElementById('stage').addEventListener('pointerdown',e=>{ pressTarget=e.target; }, true);
document.getElementById('stage').addEventListener('click',e=>{
  const t=pressTarget; pressTarget=null;
  if(!t) return;
  /* only empty stage closes a panel: not a control, and not the graphic after a drag */
  const onEmptyStage = t.id==='stage' || t.id==='frame' || t===el.canvas;
  if(!onEmptyStage) return;
  if(t===el.canvas && movedPx>3) return;
  /* A tap that landed on the words opened the editor a moment ago in
     pointerdown. Closing the panel here would undo it before a finger has
     left the glass. */
  if(tappedText){ tappedText=false; return; }
  if(openPanel) closeDrawer();
});
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')) return;
  if(e.key==='Escape'&&!libView.hidden){ closeLib(); return; }
  if(e.key==='Escape'&&openPanel){ closeDrawer(); return; }
});
try{ new ResizeObserver(()=>{ fitCanvasToStage(); markEditing(); })
       .observe(document.getElementById('frame')); }catch(e){}



/* ===========================================================
   THE WORD LIBRARY
   Every line that survived review, grouped the way it was written.
   Each entry is [top line, bottom line].
   =========================================================== */
const GROUPS=[
 {id:'access', name:'Access', lines:[
   ['LONG LINE?','LOG IT.'],['DOORS LOCKED?','LOG IT.'],['OPENED LATE?','LOG IT.'],
   ['CLOSED EARLY?','LOG IT.'],['SITE MOVED?','LOG IT.'],['SIGN GONE?','LOG IT.'],
   ['WRONG ADDRESS?','LOG IT.']]},
 {id:'equipment', name:'Equipment', lines:[
   ['MACHINE DOWN?','LOG IT.'],['SCANNER JAMMED?','LOG IT.'],['PRINTER OUT?','LOG IT.'],
   ['POWER OUT?','LOG IT.']]},
 {id:'ballots', name:'Ballots', lines:[
   ['RAN OUT OF BALLOTS?','LOG IT.'],['WRONG BALLOT?','LOG IT.'],['NO PROVISIONAL OFFERED?','LOG IT.'],
   ['BALLOT NEVER CAME?','LOG IT.'],['DROP BOX GONE?','LOG IT.'],['DROP BOX LOCKED?','LOG IT.']]},
 {id:'table', name:'At the table', lines:[
   ['TURNED AWAY?','LOG IT.'],['TOLD TO COME BACK?','LOG IT.'],
   ['GIVEN BAD INFO?','LOG IT.'],['RULES CHANGED MID-LINE?','LOG IT.'],['NOBODY IN CHARGE?','LOG IT.']]},
 {id:'door', name:'Getting in the door', lines:[
   ['NO RAMP?','LOG IT.'],['NO CURBSIDE?','LOG IT.'],['NO INTERPRETER?','LOG IT.'],
   ['ACCESSIBLE BOOTH BROKEN?','LOG IT.']]},
 {id:'feel', name:'What it felt like', lines:[
   ['BLOCKED AT THE DOOR?','LOG IT.'],['CAMERAS ON VOTERS?','LOG IT.'],
   ['SHOUTED AT?','LOG IT.'],['FOLLOWED TO YOUR CAR?','LOG IT.']]},
 {id:'pollworker', name:'The poll worker set', lines:[
   ['SHORT-STAFFED?','LOG IT.'],['NO TRAINING?','LOG IT.'],['TOLD TO STOP?','LOG IT.'],
   ['OBSERVER REMOVED?','LOG IT.'],['RULES CHANGED MID-SHIFT?','LOG IT.']]},
 {id:'closer', name:'The closer', lines:[
   ['NOTHING WENT WRONG?','LOG THAT TOO.']]},
 {id:'campaign', name:'Campaign lines', lines:[
   ['SEE IT?','LOG IT!'],
   ['SOMEBODY WRITE THIS DOWN.','LOG IT.'],
   ['BE THE PAPER TRAIL.','LOG IT.'],
   ["I'M WRITING THIS DOWN.",'LOG IT.'],
   ['YOU SAW THAT, RIGHT?','LOG IT.'],
   ["NOBODY'S TAKING NOTES?",'WE ARE.'],
   ['THE TRAIL STARTS WITH YOU.','LOG IT.'],
   ['PUT IT ON THE RECORD.','LOG IT.'],
   ['MAKE A RECORD,','NOT A POST.'],
   ['A POST DISAPPEARS.',"A LOG DOESN'T."]]}
];

/* ALL_LINES is the campaign's 46 lines. Nothing in the app adds them in
   bulk any more -- the migration moved them into the library -- but the test
   harness still seeds a bench from it. */
const ALL_LINES=GROUPS.reduce((a,g)=>a.concat(g.lines),[]);



/* ---------- per-size crop bar ---------- */
function syncTuneBar(it){
  const bar=document.getElementById('segTune'); if(!bar) return;
  [...bar.children].forEach(b=>{
    const id=b.dataset.t||'';
    b.setAttribute('aria-pressed', String(id===(tuning||'')));
    /* Mark a size that has actually been tuned, so it is obvious which ones
       differ from the graphic's own crop. */
    const has=!!(it&&it.per&&it.per[id]);
    b.classList.toggle('tuned', !!id && has);
  });
  const n=document.getElementById('tuneNote');
  if(n) n.textContent = tuning
    ? 'Editing '+tuning.replace('x',' x ')+' only.'
    : 'Tune one size and only that size changes.';
}
document.addEventListener('click',e=>{
  const b=e.target.closest && e.target.closest('#segTune button');
  if(!b) return;
  tuning=b.dataset.t||null;
  /* Showing you a 9:16 crop on a 4:5 preview would be a lie. */
  if(tuning && S.pv!==tuning){ S.pv=tuning; buildChips(); }
  commit();
});

/* ---------- in-app notices and dialogs ---------- */
/* alert(), confirm() and prompt() block the page, look nothing like the rest
   of this, and cannot appear over the library overlay. These replace them. */
let noticeT=null;
function say(msg, kind){
  const n=document.getElementById('notice'), t=document.getElementById('noticeText');
  if(!n||!t) return;
  t.textContent=msg;
  n.className='notice'+(kind?' '+kind:'');
  n.hidden=false;
  clearTimeout(noticeT);
  noticeT=setTimeout(()=>{ n.hidden=true; }, kind==='bad'?6500:4000);
}

const dlgAsk=document.getElementById('dlgAsk');
function ask({title,hint,label,value}){
  return new Promise(res=>{
    document.getElementById('askTitle').textContent=title||'Name';
    document.getElementById('askHint').textContent=hint||'';
    document.getElementById('askLabel').textContent=label||'Name';
    const inp=document.getElementById('askInput');
    inp.value=value||'';
    const done=v=>{ dlgAsk.close(); dlgAsk.removeEventListener('close',onClose); res(v); };
    const onClick=e=>{
      if(e.target.id==='askOk')  { dlgAsk.removeEventListener('click',onClick); done(inp.value.trim()||null); }
      if(e.target.id==='askCancel'){ dlgAsk.removeEventListener('click',onClick); done(null); }
    };
    const onKey=e=>{ if(e.key==='Enter'){ e.preventDefault(); dlgAsk.removeEventListener('keydown',onKey);
      dlgAsk.removeEventListener('click',onClick); done(inp.value.trim()||null); } };
    const onClose=()=>res(null);                 // Escape
    dlgAsk.addEventListener('click',onClick);
    dlgAsk.addEventListener('keydown',onKey);
    dlgAsk.addEventListener('close',onClose,{once:true});
    dlgAsk.showModal();
    setTimeout(()=>inp.focus(),30);
  });
}

const dlgConfirm=document.getElementById('dlgConfirm');
function confirmThat({title,body,ok}){
  return new Promise(res=>{
    document.getElementById('confTitle').textContent=title||'Are you sure?';
    document.getElementById('confBody').innerHTML=body||'';
    document.getElementById('confOk').textContent=ok||'Yes, do it';
    const done=v=>{ dlgConfirm.close(); res(v); };
    const onClick=e=>{
      if(e.target.id==='confOk'){ dlgConfirm.removeEventListener('click',onClick); done(true); }
      if(e.target.id==='confCancel'){ dlgConfirm.removeEventListener('click',onClick); done(false); }
    };
    dlgConfirm.addEventListener('click',onClick);
    dlgConfirm.addEventListener('close',()=>res(false),{once:true});
    dlgConfirm.showModal();
  });
}

/* ---------- library panel ---------- */
let COLLECTIONS=[];
const libStatus=(msg,kind)=>{
  const n=document.getElementById('libStatus'); if(!n) return;
  n.textContent=msg||''; n.className='status'+(kind?' '+kind:'');
};

async function loadLibraryMeta(){
  try{
    COLLECTIONS=(await (await api('/api/collections')).json()).collections||[];
  }catch(e){ COLLECTIONS=[]; }
  fillCollections();
}
function fillCollections(){
  const sel=document.getElementById('fCollection'); if(!sel) return;
  /* Refilling must not silently move you to a different collection. Saving
     reloads the counts, and losing the selection there would file the next
     graphic somewhere you did not choose. */
  const keep=sel.value;
  sel.innerHTML=COLLECTIONS.length
    ? COLLECTIONS.map(c=>'<option value="'+c.id+'">'+esc(c.name)+' ('+c.count+')</option>').join('')
    : '<option value="">No collections yet</option>';
  if(keep && COLLECTIONS.some(c=>c.id===keep)) sel.value=keep;
}
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

document.addEventListener('click', async e=>{
  const t=e.target;
  if(!t) return;

  if(t.id==='btnNewCollection'){
    const name=await ask({title:'New collection', label:'Name',
      hint:'A collection is a folder of finished graphics. You can rename it later.'});
    if(!name) return;
    try{
      const c=await (await api('/api/collections',{method:'POST',...asJson({name})})).json();
      COLLECTIONS.push({...c, count:0}); fillCollections();
      document.getElementById('fCollection').value=c.id;
      libStatus('Collection "'+c.name+'" created.','ok');
    }catch(err){ libStatus('Could not create that collection.','bad'); }
    return;
  }

  if(t.id==='btnSaveLib'){
    const it=cur(); if(!it) return libStatus('Select a graphic first','bad');
    const cid=(document.getElementById('fCollection')||{}).value;
    if(!cid) return libStatus('Make a collection first.','bad');
    t.disabled=true;
    const label=t.textContent;
    t.textContent='Saving...';
    libStatus('Starting...');
    try{
      const r=await saveToLibrary(it, cid, {onStep:m=>libStatus(m)});
      const c=COLLECTIONS.find(x=>x.id===cid); if(c) c.count++;
      fillCollections();
      document.getElementById('fCollection').value=cid;
      libStatus('Saved. '+r.sizes.length+' sizes filed under '+(c?c.name:'the collection')+'.','ok');
      /* Saved means finished: clear the bench, shut the editor, and put you
         in the library looking at what you just made. Leaving a panel open
         over a blank canvas invites edits that cannot go anywhere. */
      S.items=[]; S.sel=null; commit();
      closeDrawer();
      afterSave(cid);
    }catch(err){
      libStatus(String(err.message||err),'bad');
      say(String(err.message||err),'bad');
    }finally{ t.disabled=false; t.textContent=label; }
    return;
  }
});

/* ===========================================================
   THE LIBRARY BROWSER
   Three views behind one overlay: collections, a collection's graphics, and
   one graphic with a platform bar. Browsing reads finished PNGs out of R2 --
   it never re-renders, because a finished graphic is finished.
   =========================================================== */
const libView=document.getElementById('libview');
let libWhere={view:'home', collection:null, graphic:null, platform:null};
let libSelecting=false;
const libSel=new Set();
let libGraphics=[];

const libEl=id=>document.getElementById(id);
const renderURL=(g,size)=>'/r/'+g.id+'/'+(g.rev||1)+'/'+size+'.png';
/* The library browses DESIGNS, not files. A card shows the graphic at the
   shape it was composed in -- 4:5, the one the editor opens on -- so a
   collection reads as a set of designs rather than a pile of exports. The
   per-platform files are one level in, on the graphic itself, which is the
   only place a shape is a decision. */
const DESIGN_SIZE='1080x1350';
const designSize=g=>((g.sizes||[]).includes(DESIGN_SIZE) ? DESIGN_SIZE : (g.sizes||[])[0]);
const designURL=g=>renderURL(g, designSize(g));
const platformsFor=g=>PLATFORMS.filter(pl=>(g.sizes||[]).includes(pl.size));

async function openLib(){
  libView.hidden=false;
  await loadLibraryMeta();
  libWhere={view:'home', collection:null, graphic:null, platform:null};
  drawLib();
}
function closeLib(){ libView.hidden=true; libSelecting=false; libSel.clear(); }

function libChrome(){
  libEl('libBack').hidden = libWhere.view==='home';
  libEl('libSelect').hidden = libWhere.view!=='collection';
  libEl('libDownloadSel').hidden = !(libWhere.view==='collection' && libSelecting);
  libEl('libSelect').textContent = libSelecting ? 'Done' : 'Select';
  libEl('libTitle').textContent =
    libWhere.view==='home' ? 'Library'
    : libWhere.view==='collection' ? libWhere.collection.name
    : (libWhere.graphic.title||'Graphic');
  libEl('libCount').textContent =
    libWhere.view==='home' ? COLLECTIONS.length+' collection'+(COLLECTIONS.length===1?'':'s')
    : libWhere.view==='collection'
        ? (libSelecting ? libSel.size+' selected'
                        : libGraphics.length+' graphic'+(libGraphics.length===1?'':'s'))
    : '';
}

function drawLib(){
  libChrome();
  const w=libEl('libWrap'); w.innerHTML='';
  /* One graphic fills the pane rather than sitting in a grid cell, so that
     view sets display:block. Put it back, or the next screen renders its
     first card at the full width of the window. */
  w.style.display='';
  if(libWhere.view==='home') return drawLibHome(w);
  if(libWhere.view==='collection') return drawLibCollection(w);
  return drawLibGraphic(w);
}

function drawLibHome(w){
  if(!COLLECTIONS.length){
    w.innerHTML='<p class="hint">No collections yet. Make one in the Library panel, then save a graphic into it.</p>';
    return;
  }
  for(const c of COLLECTIONS){
    const card=document.createElement('div');
    card.className='gcard ccard';
    /* A collection with nothing in it has no cover, so it gets a plate
       rather than a broken image. */
    card.innerHTML=(c.cover
        ? '<img class="cover" src="/r/'+esc(c.cover)+'/'+DESIGN_SIZE+'.png" alt="" loading="lazy" decoding="async">'
        : '<div class="cover empty">Empty</div>')+
      '<div class="cname">'+esc(c.name)+'</div>'+
      '<div class="gl">'+c.count+' graphic'+(c.count===1?'':'s')+'</div>';
    card.addEventListener('click',()=>openCollection(c));
    w.appendChild(card);
  }
}

async function openCollection(c){
  libWhere={view:'collection', collection:c, graphic:null, platform:null};
  libSel.clear(); libSelecting=false;
  const d=await (await api('/api/collections/'+c.id+'/graphics')).json();
  /* Only finished graphics. A row with no sizes is a save that died before
     its renders landed, and its PNGs would 404. */
  libGraphics=(d.graphics||[]).filter(g=>(g.sizes||[]).length);
  drawLib();
}

function drawLibCollection(w){
  if(!libGraphics.length){
    w.innerHTML='<p class="hint">Nothing saved here yet.</p>';
    return;
  }
  for(const g of libGraphics){
    const card=document.createElement('div');
    card.className='gcard'+(libSel.has(g.id)?' sel':'');
    /* 46 cards means 46 full-size PNGs; lazy is the difference between a
       library that opens and one that thinks about it. */
    card.innerHTML=(libSelecting?'<span class="pick"></span>':'')+
      '<img class="design" src="'+designURL(g)+'" alt="'+esc(g.alt||'')+'" '+
        'width="1080" height="1350" loading="lazy" decoding="async">'+
      '<div class="gl">'+esc(g.title||'')+'</div>';
    card.addEventListener('click',()=>{
      if(libSelecting){
        libSel.has(g.id)?libSel.delete(g.id):libSel.add(g.id);
        drawLib(); return;
      }
      libWhere={view:'graphic', collection:libWhere.collection, graphic:g,
                platform:(platformsFor(g)[0]||null)};
      drawLib();
    });
    w.appendChild(card);
  }
}

function drawLibGraphic(w){
  const g=libWhere.graphic;
  const pls=platformsFor(g);
  const cur=libWhere.platform||pls[0];
  const shares=pls.filter(x=>x.size===cur.size && x.id!==cur.id);
  w.style.display='block';
  w.innerHTML=
    '<div class="oneview">'+
      '<div><img id="libShot" class="oneshot" src="'+renderURL(g,cur.size)+'" alt="'+esc(g.alt||'')+'"></div>'+
      '<div class="oneside">'+
        '<div class="eyebrow" style="margin-bottom:6px">Looks like this on</div>'+
        '<div class="seg" id="libPlat" style="margin-bottom:14px">'+
          pls.map(pl=>'<button data-p="'+pl.id+'" aria-pressed="'+(pl.id===cur.id)+'">'+esc(pl.short)+'</button>').join('')+
        '</div>'+
        '<button class="btn gold" id="libPack">Download every platform</button>'+
        '<button class="btn" id="libOne">Just '+esc(cur.short)+'</button>'+
        '<div class="note" style="margin-top:4px">'+cur.size.replace('x',' \u00d7 ')+
          (shares.length ? ' &middot; the same picture serves '+shares.map(x=>esc(x.short)).join(' and ') : '')+'</div>'+
        '<div class="eyebrow" style="margin:16px 0 6px">Image description</div>'+
        '<textarea rows="5" readonly>'+esc(g.alt||'')+'</textarea>'+
        '<div class="note" style="margin-top:6px">Copy this into the alt text field when you post.</div>'+
      '</div>'+
    '</div>';
}

libView.addEventListener('click', async e=>{
  const t=e.target;
  if(t.id==='libClose'){ closeLib(); return; }
  if(t.id==='libBack'){
    if(libWhere.view==='graphic'){ libWhere.view='collection'; libWhere.graphic=null; drawLib(); }
    else { libWhere={view:'home',collection:null,graphic:null,platform:null}; drawLib(); }
    return;
  }
  if(t.id==='libSelect'){ libSelecting=!libSelecting; libSel.clear(); drawLib(); return; }
  const pb=t.closest && t.closest('#libPlat button');
  if(pb){
    libWhere.platform=PLATFORMS.find(x=>x.id===pb.dataset.p);
    drawLib(); return;
  }
  if(t.id==='libOne'){ await downloadOne(libWhere.graphic, libWhere.platform); return; }
  if(t.id==='libPack'){ await downloadPack([libWhere.graphic]); return; }
  if(t.id==='libDownloadSel'){
    const chosen=libGraphics.filter(g=>libSel.has(g.id));
    if(!chosen.length) return;
    askPlatforms(chosen);
    return;
  }
});

/* ---------- downloads ---------- */

async function fetchRender(g,size){
  const r=await fetch(renderURL(g,size),{credentials:'same-origin'});
  if(!r.ok) throw new Error('missing render '+size+' for '+(g.title||g.id));
  return new Uint8Array(await r.arrayBuffer());
}

async function downloadOne(g,pl){
  try{
    const bytes=await fetchRender(g,pl.size);
    download(new Blob([bytes],{type:'image/png'}), pl.id+'_'+slug(g.title||g.top)+'_'+pl.size+'.png');
  }catch(e){ say(String(e.message||e),'bad'); }
}

/* A platform folder each, duplicating the bytes where two platforms want the
   same shape. It is a few MB inside a zip nobody keeps, and it means whoever
   posts opens "tiktok" rather than working out which number is 9:16. */
async function buildPack(graphics, platforms){
  const files=[];
  const cache=new Map();
  for(const g of graphics){
    const want=platforms.filter(pl=>(g.sizes||[]).includes(pl.size));
    for(const pl of want){
      const key=g.id+'/'+pl.size;
      if(!cache.has(key)) cache.set(key, await fetchRender(g,pl.size));
      files.push({name:pl.id+'/'+slug(g.title||g.top)+'_'+pl.size+'.png', data:cache.get(key)});
    }
  }
  const missing=graphics.filter(g=>!platforms.some(pl=>(g.sizes||[]).includes(pl.size)));
  return {files, missing};
}

async function downloadPack(graphics, platforms){
  const pls=platforms||PLATFORMS;
  try{
    say('Collecting '+graphics.length+' graphic'+(graphics.length===1?'':'s')+'...');
    const {files,missing}=await buildPack(graphics,pls);
    if(!files.length){ say('Nothing saved for those platforms.','bad'); return; }
    files.push({name:'image-descriptions.txt', data:new TextEncoder().encode(
      'Image descriptions, for the alt text field when you post.\n'+
      'Generated from the layout and the words. Read it before you use it.\n\n'+
      graphics.map(g=>(g.title||g.top)+'\n  '+(g.alt||'')).join('\n\n')+'\n')});
    download(zip(files), 'electionlog_'+slug(libWhere.collection?libWhere.collection.name:'graphics')+'.zip');
    if(missing.length) say(missing.length+' graphic'+(missing.length===1?' was':'s were')+
      ' left out \u2014 nothing saved for those platforms.','bad');
    else say(files.length-1+' files downloaded.','ok');
  }catch(e){ say(String(e.message||e),'bad'); }
}

/* ---------- the platform checklist ---------- */
const dlgPlat=document.getElementById('dlgPlatforms');
let platTargets=[];

function askPlatforms(graphics){
  platTargets=graphics;
  const have=new Set();
  graphics.forEach(g=>(g.sizes||[]).forEach(sz=>have.add(sz)));
  const list=libEl('platList');
  list.innerHTML=PLATFORMS.map(pl=>{
    const ok=have.has(pl.size);
    return '<label'+(ok?'':' style="opacity:.45"')+'>'+
      '<input type="checkbox" value="'+pl.id+'"'+(ok?' checked':' disabled')+'>'+
      '<span>'+esc(pl.name)+' <span class="hint">'+pl.size.replace('x',' \u00d7 ')+
      (ok?'':' &middot; nothing saved for this')+'</span></span></label>';
  }).join('');
  libEl('platSub').textContent=graphics.length+' graphic'+(graphics.length===1?'':'s')+
    '. Platforms that share a shape get the same picture under their own name.';
  syncPlatCount();
  dlgPlat.showModal();
}
function syncPlatCount(){
  const n=[...libEl('platList').querySelectorAll('input:checked')].length;
  libEl('platCount').textContent=n?(n+' platform'+(n===1?'':'s')):'nothing ticked';
  libEl('platGo').disabled=!n;
}
dlgPlat.addEventListener('change',syncPlatCount);
dlgPlat.addEventListener('click',async e=>{
  if(e.target.id==='platCancel'){ dlgPlat.close(); return; }
  if(e.target.id==='platGo'){
    const ids=[...libEl('platList').querySelectorAll('input:checked')].map(i=>i.value);
    dlgPlat.close();
    await downloadPack(platTargets, PLATFORMS.filter(pl=>ids.includes(pl.id)));
  }
});

document.getElementById('btnLibrary').addEventListener('click',openLib);
/* Land in the library after a save, with the collection open, so the graphic
   you just finished is visibly filed rather than vanished. */
async function afterSave(collectionId){
  await loadLibraryMeta();
  const c=COLLECTIONS.find(x=>x.id===collectionId);
  if(!c) return;
  libView.hidden=false;
  await openCollection(c);
}

/* ===========================================================
   HOME, AND STARTING ONE GRAPHIC
   The tool makes one graphic, saves it, and makes another. The question it
   opens with -- photo or not -- is what decides which layouts you are shown,
   because four of the seven never take a picture.
   =========================================================== */
const homeView=document.getElementById('home');
const dlgStart=document.getElementById('dlgStart');
const PHOTO_VARIANTS=['stack','bleed','band'];

function showHome(){
  homeView.hidden=false;
  const open=!!S.items.length;
  document.getElementById('homeClose').hidden = !open;
  document.getElementById('homeSub').textContent = open
    ? 'A graphic is open and unsaved'
    : '';
  /* Starting a second graphic would throw away the unsaved one, so say so
     rather than let the button quietly do it. */
  const nw=document.getElementById('homeNew');
  if(nw) nw.textContent = open ? 'Start a different graphic' : 'Make a graphic';
  const box=document.getElementById('homeCols');
  box.innerHTML = COLLECTIONS.length
    ? '<div class="eyebrow" style="margin-bottom:9px">Collections</div>'+
      '<div class="homecols">'+
      COLLECTIONS.map(c=>'<button class="homecol" data-col="'+c.id+'">'+
        (c.cover
          ? '<img class="cover" src="/r/'+esc(c.cover)+'/'+DESIGN_SIZE+'.png" alt="" loading="lazy" decoding="async">'
          : '<span class="cover empty">Empty</span>')+
        '<span class="cname">'+esc(c.name)+'</span>'+
        '<span class="cmeta">'+c.count+' graphic'+(c.count===1?'':'s')+'</span>'+
      '</button>').join('')+'</div>'
    : '<div class="note">No collections yet. One is made for you when you save.</div>';
}
function hideHome(){ homeView.hidden=true; }

/* Only offer the layouts that can actually hold what you said you have.
   This is also what retires effVariant()'s stack-with-no-photo fallback as
   something a person can reach by accident. */
function limitVariants(withPhoto){
  const seg=document.getElementById('segVariant'); if(!seg) return;
  [...seg.children].forEach(b=>{
    const ok = withPhoto ? PHOTO_VARIANTS.includes(b.dataset.v) : TEXT_ONLY.has(b.dataset.v);
    b.hidden=!ok;
  });
  document.getElementById('photoBlock').hidden=!withPhoto;
  const t=document.getElementById('tuneBlock'); if(t) t.hidden=!withPhoto;
  const h=document.getElementById('variantHint');
  if(h) h.textContent = withPhoto
    ? 'The three layouts that hold a photo.'
    : 'The four layouts that are type only.';
}

function startGraphic(withPhoto){
  const it=newItem('LONG LINE?','LOG IT.');
  it.variant = withPhoto ? 'stack' : 'type';
  /* One graphic at a time: the working set is this one draft. */
  S.items=[it]; S.sel=it.id;
  S.withPhoto=withPhoto;
  limitVariants(withPhoto);
  hideHome();
  commit();
  /* Straight into the words: it is the first thing anybody changes, and it
     teaches the tap-the-line interaction on the way past. */
  editText('top');
}

document.getElementById('btnHome').addEventListener('click',async()=>{
  await loadLibraryMeta(); showHome();
});
homeView.addEventListener('click',async e=>{
  const t=e.target;
  if(t.id==='homeClose'){ hideHome(); return; }
  if(t.id==='homeNew'){ dlgStart.showModal(); return; }
  if(t.id==='homeBrowse'){ hideHome(); await openLib(); return; }
  const col=t.closest && t.closest('[data-col]');
  if(col){
    hideHome();
    await openLib();
    const c=COLLECTIONS.find(x=>x.id===col.dataset.col);
    if(c) await openCollection(c);
  }
});
dlgStart.addEventListener('click',async e=>{
  if(e.target.id==='startCancel'){ dlgStart.close(); return; }
  const withPhoto = e.target.id==='startPhoto' ? true
                  : e.target.id==='startType'  ? false : null;
  if(withPhoto===null) return;
  dlgStart.close();
  if(S.items.length){
    const ok=await confirmThat({
      title:'Throw away the graphic you have open?',
      ok:'Start a new one',
      body:'The one on the bench has not been saved to a collection, so it '+
           'will be lost. Save it first if you want to keep it.'});
    if(!ok){ showHome(); return; }
  }
  startGraphic(withPhoto);
});

/* ---------- boot ---------- */
/* The server is the truth. The localStorage cache is only what we fall back
   to when it cannot be reached, so that a flaky connection shows the team
   their work rather than an empty list. */
async function pull(){
  const d=await (await api('/api/state')).json();
  if(!d.exists) return false;
  S.items = d.items.map(it=>({...newItem(it.top,it.bot), ...it}));
  if(d.project){
    S.caption = d.project.caption || S.caption;
    S.pv      = d.project.pv || S.pv;
    S.guides  = !!d.project.guides;
    S.sel     = d.project.sel;
  }
  S.images={};
  for(const im of d.images){
    S.images[im.sha]='/img/'+im.sha;
    THUMB.set(im.sha, im.thumb ? '/thumb/'+im.sha : '/img/'+im.sha);
  }
  /* Baseline the diff against what the server just handed us, or the first
     keystroke would push all 46 items straight back at it. */
  LAST.clear();
  for(const [id,j] of itemsNow()) LAST.set(id,j);
  lastProj=projNow();
  return true;
}

(async function boot(){
  let had=false;
  try{
    had = await pull();
  }catch(e){
    had = loadCache();
    if(had){ online=false; showOffline(); }
  }
  try{
    await document.fonts.load('400 100px '+FD);
    await document.fonts.load('500 40px '+FM);
    await document.fonts.ready;
  }catch(e){}
  await hydrate();
  /* First visit starts with the whole campaign word list already in the
     list, not an empty placeholder. Saved work is never overwritten. */
  /* The 46-line seed belonged to the list. One graphic at a time means
     starting with nothing on the bench and choosing what to make. */
  if(!S.items.length) S.sel=null;
  if(S.items.length && (!S.sel || !S.items.find(i=>i.id===S.sel))) S.sel=S.items[0].id;

  if(S.guides){ const g=$('#btnGuides'); g.setAttribute('aria-pressed','true');
                g.textContent='Hide'; g.setAttribute('aria-label','Hide safe margins'); }

  buildChips(); commit();
  await loadLibraryMeta();
  /* A graphic saved before the photo question existed has no S.withPhoto, and
     without one nothing filters the layouts -- you get all seven and a photo
     panel on a type-only graphic. Infer it from what the graphic actually is. */
  if(S.withPhoto===undefined && S.items.length){
    const it=S.items.find(i=>i.id===S.sel)||S.items[0];
    S.withPhoto = !!(it && (it.img || !TEXT_ONLY.has(it.variant)));
  }
  if(S.items.length) limitVariants(!!S.withPhoto);
  /* Nothing on the bench means there is nothing to edit, so open on home. */
  if(!S.items.length) showHome();

  document.body.classList.add('ready');
})();
