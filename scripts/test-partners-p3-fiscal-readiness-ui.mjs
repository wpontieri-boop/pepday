// TEST-only browser QA: isolated context, intercepted Auth/RPC, no backend writes.
import {pathToFileURL} from 'node:url';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const partner='11111111-1111-4111-8111-111111111111', batch='22222222-2222-4222-8222-222222222222';
const published=process.env.FISCAL_PUBLISHED==='1', evidence=[];
await mkdir(new URL('../test-output/',import.meta.url),{recursive:true});
try{
for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],blocked=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='https://homologacao.pepday.com.br'){blocked.push(url.origin);await route.abort();return;}
  if(url.pathname==='/vendor/supabase-2.116.0.js'){
   const finance={partners:[{id:partner,public_name:'CPF sintético isolado'}],can_manage:true};
   const fiscal={kind:'CPF',state:'pending',ready:false,can_manage:true,configuration:{retention:{}},documents:[],payouts:[{id:batch,payout_state:'reserved',state:'pending',gross_cents:100,withheld_cents:null,net_cents:null,ready:false}]};
   await route.fulfill({contentType:'text/javascript',body:`globalThis.qaWrites=[];globalThis.supabase={createClient(){return {auth:{getUser:async()=>({data:{user:{email:'qa@example.invalid'}}}),onAuthStateChange:()=>{},signOut:async()=>({})},rpc:async(name,args)=>{if(name==='get_admin_context')return{data:{aal:'aal2',email:'qa@example.invalid',access_level:'owner'}};if(name==='admin_partner_finance')return{data:${JSON.stringify(finance)}};if(name==='admin_partner_fiscal')return{data:${JSON.stringify(fiscal)}};qaWrites.push(name);return{error:{message:'UNEXPECTED_WRITE'}}}}}};`});return;
  }
  if(published){await route.continue();return;}
  let path=url.pathname.slice(1);if(path.endsWith('/'))path+='index.html';
  try{const body=await readFile(new URL('../preview/'+path,import.meta.url));await route.fulfill({body,contentType:/\.(mjs|js)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.svg')?'image/svg+xml':'text/css'});}
  catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('https://homologacao.pepday.com.br/admin/parceiros/fiscal/');
 await page.locator('#module:not(.hidden)').waitFor();
 await page.selectOption('#partner',partner);
 await page.waitForFunction(()=>document.getElementById('kind').textContent.includes('CPF'));
 assert.deepEqual(await page.evaluate(()=>({w:innerWidth,h:innerHeight})),{w:viewport.width,h:viewport.height});
 const geometry=await page.evaluate(()=>{
  return ['fiscalRequired','r_contract_validated','r_fiscal_validated','r_receipt_validated','r_payout_proof_validated'].map(id=>{
   const input=document.getElementById(id),caption=input.nextElementSibling,a=input.getBoundingClientRect(),b=caption.getBoundingClientRect();
   return {id,x:a.x,y:a.y,w:a.width,h:a.height,captionX:b.x,centerDelta:Math.abs(a.y+a.height/2-b.y-b.height/2),checked:input.checked};
  });
 });
 for(const g of geometry){assert.equal(g.checked,false);assert.ok(g.captionX>=g.x+g.w+8);assert.ok(g.centerDelta<=1);assert.equal(g.w,20);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('#documentType').inputValue(),'');
 assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
 await page.selectOption('#documentType','contract');
 assert.equal(await page.locator('#documentSubmit').isDisabled(),true,'Contract without file/reason must remain disabled');
 await page.fill('#documentReason','Motivo sintético');
 assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
 const file={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,0])};
 await page.locator('#documentFile').setInputFiles(file);
 assert.equal(await page.locator('#documentSubmit').isDisabled(),false);
 await page.fill('#documentReason','ab');assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
 await page.fill('#documentReason','Motivo sintético');
 for(const type of ['fiscal','receipt','payout_proof']){
  await page.selectOption('#documentType',type);
  assert.equal(await page.locator('#documentPayoutLabel').isVisible(),true);
  assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
  await page.selectOption('#documentPayout',batch);assert.equal(await page.locator('#documentSubmit').isDisabled(),false);
  await page.selectOption('#documentPayout','');
 }
 await page.locator('#documentFile').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
 await page.selectOption('#documentType','contract');assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
 await page.locator('#documentFile').setInputFiles([]);
 await page.locator('#batches button').click();
 const modal=await page.evaluate(()=>{const a=document.getElementById('noWithholding').getBoundingClientRect(),b=document.getElementById('noWithholding').nextElementSibling.getBoundingClientRect();return {x:a.x,w:a.width,captionX:b.x,centerDelta:Math.abs(a.y+a.height/2-b.y-b.height/2)}});
 assert.ok(modal.captionX>=modal.x+modal.w+8);assert.ok(modal.centerDelta<=1);
 await page.locator('#cancelBatch').click();
 await page.screenshot({path:new URL('../test-output/fiscal-qa-'+viewport.width+(published?'-live':'')+'.png',import.meta.url).pathname,fullPage:true});
 await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
 assert.equal(await page.locator('#documentType').inputValue(),'');assert.equal(await page.locator('#documentSubmit').isDisabled(),true);
 assert.deepEqual(await page.evaluate(()=>qaWrites),[]);assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
 evidence.push({viewport,published,geometry,modal,errors,backendWrites:0});
 console.log('PASS fiscal TEST '+viewport.width+'x'+viewport.height+' exact viewport; layout, readiness, reset; writes=0');
 await context.close();
}
await writeFile(new URL('../test-output/fiscal-qa'+(published?'-live':'')+'.json',import.meta.url),JSON.stringify(evidence,null,2));
}finally{await browser.close()}
