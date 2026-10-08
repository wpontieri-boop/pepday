// Real bundled SDK, isolated browser/storage, intercepted synthetic Auth/RPC only.
import {pathToFileURL} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
await mkdir('test-output',{recursive:true});
const original={public_name:'Parceiro Original QA',city:'Cidade A',description:'@original'};
try{for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 for(const scenario of ['partner-no-token','partner-consumed-token','none-new-ref','partner-new-ref','pending-to-locked','rpc-error','auth-error']){
  const context=await browser.newContext({viewport}),page=await context.newPage();
  let state={partner_locked:scenario==='pending-to-locked'?false:true,partner:scenario==='none-new-ref'?null:original};
  let mutations=0,reads=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({consumed})=>{
   const encode=value=>btoa(JSON.stringify(value)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
   const user={id:'30000000-0000-4000-8000-000000000001',aud:'authenticated'};
   const exp=Math.floor(Date.now()/1000)+3600;
   const access_token=[encode({alg:'HS256',typ:'JWT'}),encode({sub:user.id,aud:'authenticated',role:'authenticated',exp}),encode('synthetic-signature')].join('.');
   localStorage.setItem('pepday-test-fsbqpyyprtymwrmzsacp-auth',JSON.stringify({access_token,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
   if(consumed)localStorage.setItem('pepday.test.fsbqpyyprtymwrmzsacp.referral.v1','a'.repeat(64));
  },{consumed:scenario==='partner-consumed-token'});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/auth/v1/user'){
    await route.fulfill(scenario==='auth-error'?{status:503,json:{message:'Unavailable'}}:{json:{id:'30000000-0000-4000-8000-000000000001',aud:'authenticated'}});return;
   }
   if(url.pathname==='/rest/v1/rpc/get_my_partner_attribution'){
    assert.ok(request.headers().authorization?.startsWith('Bearer '));assert.deepEqual(request.postDataJSON(),{});reads++;
    await route.fulfill(scenario==='rpc-error'?{status:503,json:{message:'Unavailable'}}:{json:state});return;
   }
   if(url.pathname==='/functions/v1/partner-referral'){
    const body=request.postDataJSON();if(body.action!=='inspect')mutations++;
    await route.fulfill({json:{enabled:true,code:'INTENT_EXPIRED_OR_MISSING'}});return;
   }
   if(url.pathname==='/functions/v1/partner-public'){await route.fulfill({json:{enabled:true,partners:[]}});return}
   if(url.hostname!=='homologacao.pepday.com.br'){await route.fulfill({status:400,body:'Unmocked API'});return}
   const path=url.pathname==='/cartao/'?'cartao/index.html':url.pathname.replace(/^\//,'');
   try{const body=await readFile(new URL('../'+path,import.meta.url));await route.fulfill({body,contentType:/\.(mjs|js)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.svg')?'image/svg+xml':'text/css'})}catch{await route.fulfill({status:404,body:''})}
  });
  await page.goto('https://homologacao.pepday.com.br/cartao/'+(scenario.includes('new-ref')?'?ref=outro-parceiro':''));
  if(scenario==='pending-to-locked'){
   await page.locator('#partnerNoReferral').waitFor({state:'visible'});
   // Activation in another tab, without a focus event: action itself must recheck.
   state={partner_locked:true,partner:original};await page.locator('#partnerNoReferral').click();
  }
  await page.waitForFunction(()=>/não pode|não foi possível/i.test(document.getElementById('partnerSearchStatus').textContent));
  assert.equal(await page.locator('#partnerChoices').isVisible(),false);
  assert.equal(await page.locator('#partnerNoReferral').isDisabled(),true);
  await page.evaluate(()=>{
   document.getElementById('partnerNoReferral').dispatchEvent(new Event('click'));
   document.getElementById('partnerCodeForm').dispatchEvent(new Event('submit',{cancelable:true}));
  });
  if(!scenario.endsWith('error')){
   assert.ok(reads>0);assert.match(await page.locator('#partnerOrigin').textContent(),scenario==='none-new-ref'?/sem indicação/i:/Parceiro Original QA/);
   if(scenario.includes('new-ref'))assert.match(await page.locator('#partnerSearchStatus').textContent(),/referência.*ignorada/);
   assert.equal(await page.locator('#openPepDay').textContent(),'Abrir PepDay');
  }
  assert.equal(mutations,0,'No intent/clear after lock or unavailable state');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  if(scenario==='partner-no-token')await page.screenshot({path:`test-output/p2-locked-${viewport.width}.png`,fullPage:true});
  console.log(`PASS P2 lock browser ${viewport.width}: ${scenario}, readonly backend, controls blocked, zero mutations`);
  await context.close();
 }
}}finally{await browser.close()}
