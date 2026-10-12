// Browser QA only new portal, message simulation and roles. No real Auth/SQL writes.
import {pathToFileURL} from 'node:url';import {readFile,mkdir,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const published=process.env.PORTAL_PUBLISHED==='1',origin='https://homologacao.pepday.com.br',token='A'.repeat(43),id='11111111-1111-4111-8111-111111111111',batch='22222222-2222-4222-8222-222222222222',evidence=[];
await mkdir(new URL('../test-output/',import.meta.url),{recursive:true});
function baseView(){return {public_name:'QA Portal',submission:{state:'draft',version:0,data:{},correction:null},contract:{version:'qa-draft-1',sha256:'a'.repeat(64),body:'MINUTA TECNICA SINTETICA SEM VALIDADE'},documents:[]}}
async function surface(viewport,role='owner'){
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],blocked=[],apiCalls=[];let view=baseView(),inviteRows=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('qaRPC',async(name,args)=>{
 if(name==='get_admin_context')return {data:{access_level:role,aal:'aal2',email:'qa@example.invalid'}};
 if(name==='admin_list_partners')return {data:[{id,public_name:'QA Portal',status:'draft'}]};
 if(name==='admin_partner_finance')return {data:{can_manage:true,partners:[{id,public_name:'QA Portal',pending_cents:100,released_cents:0,paid_cents:0,debt_cents:0}],commissions:[],payouts:[],ledger:[],revenue:[]}};
 if(name==='admin_partner_finance_ledger')return {data:[]};
 if(name==='admin_partner_accountant_report'){apiCalls.push('report_read');assert.equal(args.p_month,'2026-10');return {data:{can_manage:true,partners:[{id,public_name:'QA Portal'}],commissions:[{id:batch,partner_id:id,state:'pending',earned_cents:100,source_date:'2026-10-10T12:00:00Z',history_complete:true,gross_cents:1000,refunded_cents:0}],payouts:[{id:batch,partner_id:id,state:'paid',total_cents:100,paid_at:'2026-10-10T12:00:00Z',fiscal_state:'pending'}],adjustments:[{commission_id:batch,partner_id:id,kind:'adjusted',amount_cents:-10,created_at:'2026-10-10T12:00:00Z'}]}}}

 assert.equal(name,'admin_partner_portal');const r=args.p_request;apiCalls.push(r.action);
 if(r.action==='list')return {data:{invites:inviteRows}};
 if(r.action==='issue'){inviteRows=[{id:batch,partner_id:id,public_name:'QA Portal',expires_at:new Date(Date.now()+7*86400000).toISOString(),opt_in:r.opt_in,contact_confirmed:r.contact_confirmed,messages:[],events:[],documents:[],submission:{state:'draft',version:0,data:{}}}];return {data:{id:batch,link:origin+'/parceiros/convite/#invite='+token}}}
 if(r.action==='prepare_message'){inviteRows[0].messages=[{kind:'initial',state:'pending'}];return {data:{ok:true}}}
 if(r.action==='confirm_simulation'){assert.equal(r.confirmed,true);inviteRows[0].messages[0].state='simulated';inviteRows[0].sent_at=new Date().toISOString();return {data:{ok:true}}}
 return {error:{message:'UNEXPECTED_MUTATION'}};
 });
 await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin==='https://fsbqpyyprtymwrmzsacp.supabase.co'){
 const r=route.request().postDataJSON();apiCalls.push(r.action);
 let result={ok:true};
 if(r.action==='challenge')result.challenge=id;
 else if(r.action==='verify'){if(r.code!=='654321'){await route.fulfill({status:403,json:{ok:false}});return}result={ok:true,session:token,view};}
 else if(['save','submit'].includes(r.action)){assert.equal(r.version,view.submission.version);view.submission={...view.submission,data:r.data,version:r.version+1,state:r.action==='submit'?'submitted':'draft'};result.view=view}
 else if(r.action==='view')result.view=view;
 else if(r.action==='upload_sample'){assert.equal(r.sample.length,92);view.documents=[{id,state:'stored',created_at:new Date().toISOString()}];result.id=id}
 else if(!['contract_seen','logout','opt_out'].includes(r.action))throw Error('Unexpected portal action '+r.action);
 await route.fulfill({json:result});return;
 }
 if(u.origin!==origin){blocked.push(u.origin);await route.abort();return}
 if(u.pathname==='/vendor/supabase-2.116.0.js'){await route.fulfill({contentType:'text/javascript',body:'globalThis.supabase={createClient(){return{auth:{onAuthStateChange:()=>{},getUser:async()=>({data:{user:{email:"qa@example.invalid"}}})},rpc:(name,args)=>qaRPC(name,args)}}};'});return}
 if(published){await route.continue();return}
 let path=u.pathname.slice(1);if(path.endsWith('/'))path+='index.html';
 try{await route.fulfill({body:await readFile(new URL('../preview/'+path,import.meta.url)),contentType:/\.(js|mjs)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.svg')?'image/svg+xml':'text/css'})}catch{await route.fulfill({status:404,body:''})}
 });
 return {context,page,errors,blocked,apiCalls,view,inviteRows};
}
try{
for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 const t=await surface(viewport),p=t.page;
 await p.goto(origin+'/parceiros/convite/#invite='+token);
 assert.equal(new URL(p.url()).hash,'');assert.equal(await p.locator('#workspace').isVisible(),false);
 await p.locator('#challenge').click();await p.locator('#otpForm:not(.hidden)').waitFor();
 await p.fill('#otp','000000');await p.locator('#otpForm button').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('não concluída'));
 assert.equal(await p.locator('#workspace').isVisible(),false);assert.equal(await p.locator('#otp').inputValue(),'');
 await p.fill('#otp','654321');await p.locator('#otpForm button').click();await p.locator('#workspace:not(.hidden)').waitFor();
 assert.equal(await p.evaluate(()=>innerWidth),viewport.width);
 assert.equal(await p.locator('#document').inputValue(),'00000000000');
 for(const kind of ['MEI','CNPJ']){await p.selectOption('#kind',kind);assert.equal(await p.locator('#document').inputValue(),'00000000000000')}
 await p.locator('#save').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Rascunho salvo'));
 assert.equal(await p.getByRole('button',{name:/Aceite definitivo/}).isDisabled(),true);
 await p.locator('#contractSeen').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('minuta técnica registrada'));
 await p.locator('#upload').click();await p.waitForFunction(()=>document.querySelector('#documents').textContent.includes('stored'));
 assert.equal(await p.locator('input[type=file]').count(),0);
 await p.locator('#submit').click();await p.waitForFunction(()=>document.querySelector('#state').textContent.includes('Em revisão'));
 assert.equal(await p.locator('#save').isDisabled(),true);
 t.view.submission.state='corrections';t.view.submission.version++;t.view.submission.correction='QA corrigir';
 await p.locator('#refresh').click();await p.waitForFunction(()=>document.querySelector('#state').textContent.includes('Correção solicitada'));assert.equal(await p.locator('#save').isDisabled(),false);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await p.evaluate(()=>localStorage.length+sessionStorage.length),0);
 await p.screenshot({path:new URL('../test-output/portal-'+viewport.width+(published?'-live':'')+'.png',import.meta.url).pathname,fullPage:true});
 t.view.submission.state='approved_test';await p.locator('#refresh').click();await p.waitForFunction(()=>document.querySelector('#state').textContent.includes('Revisão técnica concluída'));assert.equal(await p.locator('#upload').isDisabled(),true);assert.equal(await p.locator('#contractSeen').isDisabled(),true);
 await p.locator('#logout').click();await p.waitForFunction(()=>document.querySelector('#workspace').classList.contains('hidden'));
 assert.equal(await p.locator('#legalName').inputValue(),'QA Pessoa Teste');
 assert.deepEqual(t.errors,[]);assert.deepEqual(t.blocked,[]);evidence.push({surface:'partner',viewport,published,actions:t.apiCalls,errors:t.errors});
 await t.context.close();
 const a=await surface(viewport),page=a.page;await page.goto(origin+'/admin/parceiros/portal/');await page.locator('#module:not(.hidden)').waitFor();
 await page.selectOption('#partner',id);await page.check('#optIn');await page.check('#confirmed');await page.locator('#issueForm button').click();await page.locator('#issued:not(.hidden)').waitFor();
 await page.getByRole('button',{name:'Enviar convite pelo WhatsApp',exact:true}).click();await page.locator('#messageDialog[open]').waitFor();
 assert.equal(await page.locator('#confirmSimulation').isDisabled(),true);assert.match(await page.locator('#message').inputValue(),/#invite=/);
 await page.check('#humanConfirm');await page.locator('#confirmSimulation').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Simulação registrada'));
 assert.equal(a.apiCalls.filter(c=>c==='confirm_simulation').length,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:new URL('../test-output/admin-portal-'+viewport.width+(published?'-live':'')+'.png',import.meta.url).pathname,fullPage:true});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))});
 assert.equal(await page.locator('#link').inputValue(),'');assert.deepEqual(a.errors,[]);assert.deepEqual(a.blocked,[]);
 evidence.push({surface:'owner',viewport,published,actions:a.apiCalls,errors:a.errors});await a.context.close();

 const f=await surface(viewport),fp=f.page;await fp.goto(origin+'/admin/parceiros/financeiro/');await fp.locator('#module:not(.hidden)').waitFor();await fp.fill('#reportMonth','2026-10');
 for(const [button,content] of [['reportPre','CONFERENCIA_PRE'],['reportPost','CONCILIACAO_POS'],['reportAdjustments','HISTORICO_AJUSTES']]){
 const pending=fp.waitForEvent('download');await fp.locator('#'+button).click();const download=await pending;assert.match(download.suggestedFilename(),/TEST/);const csv=await readFile(await download.path(),'utf8');assert.ok(csv.includes(content));assert.ok(!csv.includes('QA-ONLY-NOT-A-PIX'));await fp.waitForFunction(()=>!document.getElementById('reportPre').disabled);
 }
 assert.equal(f.apiCalls.filter(c=>c==='report_read').length,3);assert.deepEqual(f.errors,[]);assert.deepEqual(f.blocked,[]);assert.equal(await fp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 evidence.push({surface:'reports',viewport,published,exports:3,errors:f.errors});await f.context.close();
 console.log('PASS new portal and WhatsApp dry-run exact '+viewport.width+'x'+viewport.height+'; no real backend/provider writes');
}
for(const role of ['admin','viewer']){const t=await surface({width:390,height:844},role);await t.page.goto(origin+'/admin/parceiros/portal/');await t.page.waitForFunction(()=>document.querySelector('#accessStatus').textContent.includes('necessária'));assert.equal(await t.page.locator('#module').isVisible(),false);assert.deepEqual(t.apiCalls,[]);await t.context.close();console.log('PASS portal OWNER-only denied '+role)}
await writeFile(new URL('../test-output/portal-ui'+(published?'-live':'')+'.json',import.meta.url),JSON.stringify(evidence,null,2));
}finally{await browser.close()}
