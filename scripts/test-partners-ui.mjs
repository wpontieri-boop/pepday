// Isolated browser with synthetic RPC responses; never logs in or calls a real backend.
import {pathToFileURL} from 'node:url';
const {default:puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();await mkdir('test-output',{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
try{for(const role of ['owner','admin','viewer']){
const page=await browser.newPage();await page.setViewport({width:390,height:844});
await page.setRequestInterception(true);page.on('request',async req=>{const url=new URL(req.url());if(url.pathname==='/vendor/supabase-2.116.0.js'){await req.respond({status:200,contentType:'text/javascript',body:`window.calls=[];window.rows=[{id:'qa',public_name:'Parceiro QA',partner_type:'loja',city:'QA',description:'',slug:'qa',public_code:'QA000001',status:'draft',financial_ready:false,requires_stepup:false,commission_percent:null,contact:${role==='viewer'?'null':JSON.stringify({email:'qa@example.invalid',phone:'+550000000000',name:'QA'})}}];window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{}}}),onAuthStateChange:()=>{},signOut:async()=>({}),signInWithPassword:async()=>({data:{user:{email:'qa@example.invalid'}}}),setSession:async()=>({}),mfa:{listFactors:async()=>({data:{totp:[{id:'synthetic',status:'verified'}]}}),challengeAndVerify:async()=>({data:{access_token:'synthetic',refresh_token:'synthetic'}})}},rpc:async(name,args)=>{window.calls.push({name,args});if(name==='get_admin_context')return {data:{aal:'aal2',access_level:'${role}',can_write:${role!=='viewer'},email:'qa@example.invalid'}};if(name==='admin_list_partners')return {data:window.rows.filter(p=>(args.p_include_archived||p.status!=='archived')&&p.public_name.toLowerCase().includes(args.p_query.toLowerCase()))};if(name==='admin_prepare_partner_stepup')return {data:'synthetic-ticket'};if(name==='admin_configure_partner'){window.rows[0].financial_ready=true;window.rows[0].financial={legal_name:'QA Sintético',document_masked:'••••8909',payee_name_masked:'••••••••',pix_type:'email',pix_key_masked:'••••alid'};window.rows[0].commission_percent=Number(args.p_payload.commission_percent)}if(name==='admin_set_partner_status'){window.rows[0].status=args.p_status;window.rows[0].requires_stepup=true}return {data:'qa'};}})};`});return}try{const path=url.pathname==='/admin/parceiros/'?'/site/admin/parceiros/index.html':url.pathname.replace(/^\/admin\/parceiros\//,'/site/admin/parceiros/');const body=await readFile(root+path);await req.respond({status:200,contentType:path.endsWith('.css')?'text/css':path.endsWith('.mjs')||path.endsWith('.js')?'text/javascript':path.endsWith('.svg')?'image/svg+xml':'text/html',body})}catch{await req.respond({status:404,body:''})}});
await page.goto('https://homologacao.pepday.com.br/admin/parceiros/');await page.waitForSelector('#module:not(.hidden)');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' mobile list overflow');
await page.evaluate(()=>window.rows.push({...window.rows[0],id:'archive',public_name:'Archived QA',status:'archived'}));
await page.click('#filterForm button');await page.waitForFunction(()=>window.calls.filter(c=>c.name==='admin_list_partners').length>=2);
assert.equal(await page.$$('.status-archived').then(x=>x.length),0);
await page.click('#toggleArchived');await page.waitForSelector('.status-archived');assert.equal(await page.$eval('#toggleArchived',e=>e.textContent),'Ocultar arquivados');
await page.click('#toggleArchived');await page.waitForFunction(()=>!document.querySelector('.status-archived'));

if(role==='viewer'){assert.equal(await page.$eval('#editSection',e=>e.classList.contains('hidden')),true);assert.equal(await page.$$eval('.partner-actions button',els=>els.length),0)}else{
 await page.locator('.partner-actions button').filter(b=>b.textContent==='Editar cadastro').click();
 assert.equal(await page.$eval('#financialSection',e=>e.classList.contains('hidden')),role!=='owner');
 if(role==='owner'){
 await page.click('#saveFinance');assert.equal(await page.$$eval('#financialForm .field-error',els=>els.length),7);
 await page.type('#legalName','QA Sintético');await page.type('#document','123.456.789-09');await page.type('#payeeName','Titular QA');await page.select('#pixType','email');await page.type('#pixKey','qa@example.invalid');await page.type('#commissionPercent','12.5');await page.select('#financialReason','configuracao_inicial');
 await page.click('#saveAndActivate');await page.waitForFunction(()=>window.calls.some(c=>c.name==='admin_set_partner_status'));
 assert.equal(await page.$eval('#stepup',e=>e.open),false);assert.equal(await page.evaluate(()=>window.calls.find(c=>c.name==='admin_configure_partner').args.p_ticket),null);
 await page.locator('.partner-actions button').filter(b=>b.textContent==='Editar cadastro').click();
 await page.click('.field-help summary');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile help overflow');
 await page.screenshot({path:'test-output/p1-ux-owner-mobile.png',fullPage:true});
 assert.equal(await page.$eval('#saveAndActivate',e=>e.classList.contains('hidden')),true);
 assert.equal(await page.$eval('#saveFinance',e=>e.textContent),'Salvar alteração financeira');
 assert.equal(await page.$eval('.activation-help summary',e=>e.textContent),'ⓘ Parceiro ativo');
 for(const id of ['document','pixKey','payeeName'])assert.equal(await page.$eval('#'+id,e=>e.disabled&&e.value.startsWith('••••')),true,id+' masked');
 await page.$eval('#commissionPercent',e=>e.value='16');await page.select('#financialReason','ajuste_contratual');await page.click('#saveFinance');assert.equal(await page.$eval('#stepup',e=>e.open),true);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='admin_configure_partner').length),1,'no save before stepup');
 await page.type('#stepupPassword','synthetic-password');await page.click('#stepupPasswordForm button');await page.waitForSelector('#stepupTotpForm:not(.hidden)');await page.type('#stepupCode','123456');await page.click('#stepupTotpForm button');await page.waitForFunction(()=>!document.querySelector('#stepup').open);
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.name==='admin_configure_partner').at(-1).args.p_payload),{reason:'ajuste_contratual',commission_percent:'16'});
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='admin_configure_partner').at(-1).args.p_ticket),'synthetic-ticket');
 assert.equal(await page.$eval('#commissionPercent',e=>e.value),'16');
 await page.click('[data-financial-edit="document"]');assert.equal(await page.$eval('#document',e=>e.disabled||e.value!==''),false);await page.select('#financialReason','correcao_pagamento');await page.click('#saveFinance');assert.equal(await page.$eval('#document',e=>e.getAttribute('aria-invalid')),'true');
 await page.click('[data-financial-edit="document"]');assert.equal(await page.$eval('#document',e=>e.disabled&&e.value.startsWith('••••')),true);
 await page.click('[data-financial-edit="pixKey"]');assert.equal(await page.$eval('#pixType',e=>e.disabled),false);await page.click('[data-financial-edit="pixKey"]');
 await page.evaluate(()=>{window.rows[0].requires_stepup=true;window.rows[0].status='suspended'});await page.click('#filterForm button');await page.waitForSelector('.status-suspended');
 await page.locator('.partner-actions button').filter(b=>b.textContent==='Editar cadastro').click();
 await page.$eval('#commissionPercent',e=>e.value='17');await page.select('#financialReason','ajuste_contratual');await page.click('#saveFinance');assert.equal(await page.$eval('#stepup',e=>e.open),true);await page.click('#cancelStepup');
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='admin_configure_partner').length),2,'cancel does not save');
 await page.evaluate(()=>{document.querySelectorAll('details').forEach(e=>e.open=false);document.documentElement.style.scrollBehavior='auto';window.scrollTo({top:0,behavior:'instant'})});await page.screenshot({path:'test-output/p1-patch-owner-mobile.png',fullPage:true});

 }
}
await page.setViewport({width:1280,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' desktop overflow');await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:'test-output/p1-patch-'+role+'-desktop.png',fullPage:true});console.log(role+' UI PASS (synthetic RPCs; mobile/desktop, fields and flow)');await page.close();
}}finally{await browser.close()}
