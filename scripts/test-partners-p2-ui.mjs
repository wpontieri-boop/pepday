// Isolated authored-page test. Synthetic responses only; no user browser/login/backend.
import {pathToFileURL} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const partners=[{public_name:'Homônimo QA',city:'Cidade A',description:'@qa-a',slug:'qa-a',public_code:'QA000001'},{public_name:'Homônimo QA',city:'Cidade B',description:'@qa-b',slug:'qa-b',public_code:'QA000002'}];
await mkdir('test-output',{recursive:true});
try{for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 const context=await browser.newContext({viewport}),page=await context.newPage(),tokens=new Map();let serial=0,creates=0;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/functions/v1/partner-public'){await route.fulfill({json:{enabled:true,partners}});return}
  if(url.pathname==='/functions/v1/partner-referral'){
   const body=request.postDataJSON(),previous=tokens.get(body.previous_token);let result={enabled:true};
   if(body.action==='inspect')result=previous?{...result,code:'VALID',partner:previous.partner}:{...result,code:'INTENT_EXPIRED_OR_MISSING'};
   else if(body.action==='clear')result.code='CLEARED';
   else{
    const partner=partners.find(p=>body.source==='code'?p.public_code===body.ref:p.slug===body.ref);
    if(!partner)result.code='PARTNER_UNAVAILABLE';
    else if(previous&&previous.source!=='manual'&&body.source==='manual'&&previous.partner!==partner&&!body.confirm_swap)result={...result,code:'CONFIRM_SWAP_REQUIRED',partner};
    else{const token=(++serial).toString(16).padStart(64,'0');tokens.set(token,{partner,source:body.source});creates++;result={...result,code:'CREATED',token,partner}}
   }
   await route.fulfill({json:result});return;
  }
  // Never forward a synthetic browser request to a real origin.
  const path=url.pathname==='/cartao/'?'cartao/index.html':url.pathname.replace(/^\//,'');
  try{const body=await readFile(new URL('../'+path,import.meta.url));await route.fulfill({body,contentType:path.endsWith('.mjs')||path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.svg')?'image/svg+xml':'text/css'})}catch{await route.fulfill({status:404,body:''})}
 });
 await page.goto('https://homologacao.pepday.com.br/cartao/?ref=qa-a');
 await page.waitForFunction(()=>document.getElementById('partnerOrigin').textContent.includes('Cidade A')&&!document.getElementById('partnerNoReferral').disabled);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('referral')).length),1);
 await page.reload();await page.waitForFunction(()=>document.getElementById('partnerOrigin').textContent.includes('Cidade A'));
 await page.locator('#partnerQuery').fill('Homônimo');await page.locator('#partnerResults button').nth(1).waitFor();
 const count=creates;assert.equal(await page.locator('#partnerOrigin').textContent(),'Você veio por Homônimo QA · Cidade A · @qa-a.');assert.equal(creates,count);
 await page.locator('#partnerResults button').nth(1).click();await page.locator('#partnerSwap[open]').waitFor();assert.equal(creates,count);
 await page.locator('#partnerSwapCancel').click();assert.match(await page.locator('#partnerOrigin').textContent(),/Cidade A/);
 await page.locator('#partnerResults button').nth(1).click();await page.locator('#partnerSwap[open]').waitFor();
 await page.locator('#partnerSwapConfirm').click();await page.waitForFunction(()=>document.getElementById('partnerOrigin').textContent.includes('Cidade B'));
 await page.locator('#partnerCode').fill('QA000001');await page.locator('#partnerCodeForm button').click();await page.waitForFunction(()=>document.getElementById('partnerOrigin').textContent.includes('Cidade A'));
 await page.locator('#partnerCode').fill('INVALID');await page.locator('#partnerCodeForm button').click();await page.waitForFunction(()=>document.getElementById('partnerSearchStatus').textContent.includes('indisponível'));assert.match(await page.locator('#partnerOrigin').textContent(),/Cidade A/);
 await page.screenshot({path:`test-output/p2-card-${viewport.width}.png`,fullPage:true});
 await page.locator('#partnerNoReferral').click();await page.waitForFunction(()=>!document.getElementById('partnerNoReferral').disabled);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('referral')).length),0);
 assert.match(await page.locator('#partnerOrigin').textContent(),/sem indicação/);assert.match(await page.locator('#openPepDay').getAttribute('href'),/from=cartao/);
 console.log(`PASS P2 browser ${viewport.width}: link/reload, homonyms, manual cancel/confirm, code precedence, invalid ref, no-referral, no overflow`);
 await context.close();
}}finally{await browser.close()}
