// Browser-only synthetic QA; all requests intercepted, no real account, invoice, or storage mutation.
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const uuid='11111111-1111-4111-8111-111111111111', batch='22222222-2222-4222-8222-222222222222';
try{
for(const environment of ['test','production'])for(const role of ['owner','admin','viewer'])for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());let path=url.pathname.slice(1);if(path.endsWith('/'))path+='index.html';
  if(path==='vendor/supabase-2.116.0.js'){
   const finance={partners:[{id:uuid,public_name:'Parceiro fiscal sintético'}],can_manage:role==='owner'};
   const fiscal={kind:'CPF',state:'pending',ready:false,can_manage:role==='owner',configuration:{retention:{}},documents:[],payouts:[{id:batch,payout_state:'reserved',state:'pending',gross_cents:1590,withheld_cents:null,net_cents:null,ready:false}]};
   await route.fulfill({contentType:'text/javascript',body:`globalThis.fiscalCalls=[];globalThis.supabase={createClient(){const auth={getUser:async()=>({data:{user:{email:'synthetic@example.invalid'}}}),getSession:async()=>({data:{session:{access_token:'fixture-not-a-real-token'}}}),onAuthStateChange:()=>{},signOut:async()=>({}),signInWithPassword:async()=>({data:{user:{email:'synthetic@example.invalid'}}}),setSession:async()=>({}),mfa:{listFactors:async()=>({data:{totp:[{id:'factor-synthetic',status:'verified'}]}}),challengeAndVerify:async({code})=>code==='000000'?{error:{message:'INVALID_TOTP'}}:{data:{access_token:'synthetic-not-real',refresh_token:'synthetic-not-real'}}}};return{auth,rpc:async(name,args)=>{fiscalCalls.push(name);if(name==='get_admin_context')return{data:{aal:'aal2',email:'synthetic@example.invalid',access_level:'${role}'}};if(name==='admin_partner_finance')return{data:${JSON.stringify(finance)}};if(name==='admin_partner_fiscal')return{data:${JSON.stringify(fiscal)}};if(name==='admin_prepare_partner_finance')return{data:'synthetic-ticket'};if(name==='admin_partner_fiscal_action')return{data:{outcome:args.p_payload.action}};return{data:null}}}}};`});return;
  }
  try{let body=await readFile(new URL('../preview/'+path,import.meta.url));if(environment==='production'&&path==='config.js')body=await readFile(new URL('../config.production.js',import.meta.url));await route.fulfill({body,contentType:/\.(mjs|js)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.svg')?'image/svg+xml':'text/css'})}catch{await route.fulfill({status:404,body:''})}
 });
 await page.goto((environment==='test'?'https://homologacao.pepday.com.br':'https://pepday.com.br')+'/admin/parceiros/fiscal/');
 if(environment==='production'){
  await page.waitForFunction(()=>document.getElementById('accessStatus').textContent.includes('somente'));assert.equal(await page.locator('#module').isVisible(),false);assert.deepEqual(await page.evaluate(()=>fiscalCalls),[]);
 } else {
  await page.locator('#module:not(.hidden)').waitFor();await page.selectOption('#partner',uuid);await page.waitForFunction(()=>document.getElementById('kind').textContent.includes('CPF'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(role==='owner'){
   assert.equal(await page.locator('#documentType').inputValue(),'');
   assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
   await page.selectOption('#documentType','fiscal');assert.equal(await page.locator('#documentPayoutLabel').isVisible(),true);assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
   await page.selectOption('#documentPayout',batch);assert.equal(await page.locator('#documentSubmit').isDisabled(),false);
   await page.selectOption('#documentType','contract');assert.equal(await page.locator('#documentPayoutLabel').isVisible(),false);assert.equal(await page.locator('#documentSubmit').isDisabled(),false);
   await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);assert.equal(await page.locator('#documentType').inputValue(),'');
   await page.fill('#profileReason','Revisão fiscal sintética pendente');await page.locator('#profileForm button').click();await page.locator('#stepup[open]').waitFor();
   assert.ok(!(await page.evaluate(()=>fiscalCalls)).includes('admin_partner_fiscal_action'));
   await page.fill('#password','somente-dados-ficticios');await page.locator('#passwordForm button').click();await page.locator('#totpForm:not(.hidden)').waitFor();
   await page.fill('#totp','000000');await page.locator('#totpForm button').click();await page.waitForFunction(()=>document.getElementById('stepupStatus').textContent.includes('não concluída'));
   assert.ok(!(await page.evaluate(()=>fiscalCalls)).includes('admin_partner_fiscal_action'));
   await page.fill('#totp','123456');await page.locator('#totpForm button').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Operação concluída'));
   assert.ok((await page.evaluate(()=>fiscalCalls)).includes('admin_partner_fiscal_action'));
  } else {
   assert.equal(await page.locator('#documentSection').isVisible(),false);assert.equal(await page.locator('#profileSection').isVisible(),false);
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS fiscal '+environment+'/'+role+'/'+viewport.width);await context.close();
}
}finally{await browser.close()}
