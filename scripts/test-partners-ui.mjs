// Isolated browser with synthetic RPC responses; never logs in or calls a real backend.
import {pathToFileURL} from 'node:url';
const {default:puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();await mkdir('test-output',{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
try{for(const role of ['owner','admin','viewer']){
const page=await browser.newPage();await page.setViewport({width:390,height:844});
await page.setRequestInterception(true);page.on('request',async req=>{const url=new URL(req.url());if(url.pathname==='/vendor/supabase-2.116.0.js'){await req.respond({status:200,contentType:'text/javascript',body:`window.calls=[];window.rows=[{id:'qa',public_name:'Parceiro QA',partner_type:'loja',city:'QA',description:'',slug:'qa',public_code:'QA000001',status:'draft',financial_ready:false,requires_stepup:false,commission_percent:null,contact:${role==='viewer'?'null':JSON.stringify({email:'qa@example.invalid',phone:'+550000000000',name:'QA'})}}];window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{}}}),onAuthStateChange:()=>{}},rpc:async(name,args)=>{window.calls.push({name,args});if(name==='get_admin_context')return {data:{aal:'aal2',access_level:'${role}',can_write:${role!=='viewer'},email:'qa@example.invalid'}};if(name==='admin_list_partners')return {data:window.rows};if(name==='admin_configure_partner'){window.rows[0].financial_ready=true;window.rows[0].commission_percent=Number(args.p_payload.commission_percent)}if(name==='admin_set_partner_status'){window.rows[0].status=args.p_status;window.rows[0].requires_stepup=true}return {data:'qa'};}})};`});return}try{const path=url.pathname==='/admin/parceiros/'?'/site/admin/parceiros/index.html':url.pathname.replace(/^\/admin\/parceiros\//,'/site/admin/parceiros/');const body=await readFile(root+path);await req.respond({status:200,contentType:path.endsWith('.css')?'text/css':path.endsWith('.mjs')||path.endsWith('.js')?'text/javascript':path.endsWith('.svg')?'image/svg+xml':'text/html',body})}catch{await req.respond({status:404,body:''})}});
await page.goto('https://homologacao.pepday.com.br/admin/parceiros/');await page.waitForSelector('#module:not(.hidden)');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' mobile list overflow');
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
 await page.evaluate(()=>{window.rows[0].requires_stepup=true;window.rows[0].status='suspended';window.rows[0].financial_ready=true});await page.click('#filterForm button');await page.waitForFunction(()=>document.querySelector('.status-suspended'));
 await page.locator('.partner-actions button').filter(b=>b.textContent==='Editar cadastro').click();
 await page.type('#legalName','QA Sintético');await page.type('#document','12345678909');await page.type('#payeeName','QA');await page.select('#pixType','email');await page.type('#pixKey','qa@example.invalid');await page.$eval('#commissionPercent',e=>e.value='');await page.type('#commissionPercent','10');await page.select('#financialReason','ajuste_contratual');await page.click('#saveFinance');assert.equal(await page.$eval('#stepup',e=>e.open),true);await page.click('#cancelStepup');
 }
}
await page.setViewport({width:1280,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' desktop overflow');console.log(role+' UI PASS (synthetic RPCs; mobile/desktop, fields and flow)');await page.close();
}}finally{await browser.close()}
