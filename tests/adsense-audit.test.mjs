import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {realAdsAllowed} from '../src/ad-policy.mjs';
import {prepareTestDiscovery} from '../scripts/prepare-test-discovery.mjs';

test('real advertising fails closed for installed modes, offline, embedding, disabled and non-calculator screens',()=>{
  assert.equal(realAdsAllowed(),false);
  const allowed={enabled:true,online:true,installed:false,embedded:false,calculatorActive:true};
  assert.equal(realAdsAllowed(allowed),true);
  for(const denied of [{enabled:false},{online:false},{installed:true},{embedded:true},{calculatorActive:false}])assert.equal(realAdsAllowed({...allowed,...denied}),false);
});

test('TEST discovery has static calculator and original guide, crawlable links and staging noindex; approved source is preserved',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'pepday-discovery-'));
  try{
    const app=await readFile('index.html','utf8'),landing=await readFile('site/index.html','utf8');
    for(const name of ['index.html','site','sw.js'])await cp(name,path.join(dir,name),{recursive:true});
    await prepareTestDiscovery(dir);
    const calc=await readFile(path.join(dir,'calculadora/index.html'),'utf8');
    assert.match(calc,/<base href="\/">/);
    assert.match(calc,/name="pepday-entry-screen" content="calculator"/);
    assert.match(calc,/id="calculator" class="screen active"/);
    assert.match(calc,/id="home" class="screen"/);
    // Original fields and result output remain identical; no calculator rewrite.
    const section=s=>s.split('<section id="calculator"')[1].split('<section id="routines"')[0].replace('class="screen active"','class="screen"');
    assert.equal(section(calc),section(app));
    const builtLanding=await readFile(path.join(dir,'site/index.html'),'utf8');
    assert.match(builtLanding,/href="\/calculadora\/">Usar calculadora grátis/);
    assert.match(builtLanding,/href="\/guia-calculadora\/"/);
    const guide=await readFile(path.join(dir,'guia-calculadora/index.html'),'utf8');
    assert.match(guide,/Concentração \(mg\/mL\)/);assert.match(guide,/não converte a atividade biológica/);
    for(const html of [calc,builtLanding,guide]){
      assert.match(html,/name="robots" content="noindex, nofollow"/);
      assert.match(html,/rel="canonical" href="https:\/\/homologacao.pepday.com.br\//);
      assert.doesNotMatch(html,/pagead2\.googlesyndication/);
    }
    const sitemap=await readFile(path.join(dir,'sitemap.xml'),'utf8');
    assert.equal((sitemap.match(/<loc>/g)||[]).length,6);
    assert.doesNotMatch(sitemap,/admin|cartao|parceiro|pepday.com.br\/app/);
    const robots=await readFile(path.join(dir,'robots.txt'),'utf8');
    assert.match(robots,/Disallow: \/admin\//);assert.doesNotMatch(robots,/Disallow: \/\n/);
    assert.equal(await readFile('index.html','utf8'),app);
    assert.equal(await readFile('site/index.html','utf8'),landing);
    const publicBuild=await readFile('scripts/build-public.mjs','utf8');
    assert.doesNotMatch(publicBuild,/prepareTestDiscovery/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

// Execute the shipping ad loader with an inert DOM. No external ad URL is fetched.
import vm from 'node:vm';
import {shouldShowFreeAd,validAdsensePublicConfig} from '../src/ad-policy.mjs';
async function adHarness({provider='adsense',enabled=true,pro=false,ready=true,installed=false,ios=false,embedded=false,online=true,active=true,resultVisible=true}={}){
  const listeners={},observers=[],scripts=[];let access={pro};
  const node=(classes=[])=>({dataset:{},style:{},children:[],classList:{values:new Set(classes),contains(v){return this.values.has(v)},add(v){this.values.add(v)},toggle(v,on){on?this.values.add(v):this.values.delete(v)}},replaceChildren(...items){this.children=items}});
  const slot=node(['hidden']),mount=node(),result=node(resultVisible?[]:['hidden']),calculator=node(active?['active']:[]);
  const nodes={freeAdSlot:slot,freeAdMount:mount,result,calculator};
  const document={referrer:'',getElementById:id=>nodes[id],querySelector:()=>null,createElement:()=>node(),head:{append(s){scripts.push(s)}},addEventListener:(name,cb)=>listeners[name]=cb};
  const context=vm.createContext({document,navigator:{standalone:ios,onLine:online,userAgent:'QA Browser'},config:{ads:{enabled,provider,publisherId:'ca-pub-1234567890123456',slotId:'1234567890'}},shouldShowFreeAd,validAdsensePublicConfig,realAdsAllowed,
    PepDayAccess:{snapshot:()=>access,ready:()=>ready},MutationObserver:class{constructor(cb){this.cb=cb}observe(target){observers.push({target,cb:this.cb})}},matchMedia:q=>({matches:installed&&q==='(display-mode: standalone)',addEventListener(){}}),addEventListener(){},self:{},top:{}});
  if(!embedded)context.top=context.self;
  vm.runInContext((await readFile('src/ads.mjs','utf8')).replace(/^import .*;\r?\n/gm,''),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {context,scripts,slot,mount,observers,setPro(value){access={pro:value};listeners['pepday:entitlement']()},async loaded(){scripts[0].onload();await new Promise(resolve=>setImmediate(resolve))}};
}

test('shipping loader makes zero ad requests for PRO, all forbidden contexts, disabled and unresolved entitlement',async()=>{
  for(const options of [{pro:true},{enabled:false},{ready:false},{installed:true},{ios:true},{embedded:true},{online:false},{active:false},{resultVisible:false}]){
    const h=await adHarness(options);assert.equal(h.scripts.length,0,JSON.stringify(options));assert.equal(h.slot.classList.contains('hidden'),true);
  }
  const preview=await adHarness({provider:'preview',installed:true});assert.equal(preview.scripts.length,0);assert.equal(preview.slot.classList.contains('hidden'),false);
});

test('browser FREE loader uses one script, prevents a pending request after PRO transition and never auto-refreshes a filled slot',async()=>{
  const h=await adHarness();assert.equal(h.scripts.length,1);h.setPro(true);await h.loaded();assert.equal(h.context.adsbygoogle.length,0);assert.equal(h.slot.classList.contains('hidden'),true);
  const normal=await adHarness();await normal.loaded();assert.equal(normal.context.adsbygoogle.length,1);
  for(const o of normal.observers)o.cb();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(normal.context.adsbygoogle.length,1);assert.equal(normal.scripts.length,1);
});
