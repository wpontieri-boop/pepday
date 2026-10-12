import {pathToFileURL} from 'node:url';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),browser=await chromium.launch({headless:true}),published=process.env.PORTAL_PUBLISHED==='1',evidence=[];
try{for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],writes=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async r=>{const u=new URL(r.request().url());if(r.request().method()!=='GET')writes.push(r.request().method());assert.equal(u.origin,'https://homologacao.pepday.com.br');if(published)return r.continue();let path=u.pathname.slice(1);if(path.endsWith('/'))path+='index.html';await r.fulfill({body:await readFile(new URL('../preview/'+path,import.meta.url)),contentType:/\.(js|mjs)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':'text/css'})});
await page.goto('https://homologacao.pepday.com.br/parceiros/documentos/');await page.waitForFunction(()=>document.querySelector('#integrity').textContent.includes('SHA256 conferido'));
const options=await page.locator('#document option').evaluateAll(xs=>xs.map(x=>x.value));assert.equal(options.length,9);
for(const id of options){await page.selectOption('#document',id);await page.waitForFunction(()=>document.querySelector('#integrity').textContent.includes('SHA256 conferido'));assert.ok((await page.locator('#content').innerText()).length>300);assert.equal(await page.locator('#accept').isDisabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}
assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
await page.screenshot({path:new URL('../test-output/legal-'+viewport.width+(published?'-live':'')+'.png',import.meta.url).pathname,fullPage:true});
evidence.push({viewport,published,documents:options.length,shaVerified:true,acceptDisabled:true,errors,writes});await context.close();console.log('PASS 9 legal documents SHA/disabled/no writes '+viewport.width+'x'+viewport.height)}
for(const scenario of ['wrong-origin','wrong-project','tampered-hash']){
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),origin=scenario==='wrong-origin'?'https://qa.example.invalid':'https://homologacao.pepday.com.br';
await page.route('**/*',async r=>{const u=new URL(r.request().url());let path=u.pathname.slice(1);if(path.endsWith('/'))path+='index.html';let body=await readFile(new URL('../preview/'+path,import.meta.url),'utf8');
if(path==='config.js'&&scenario==='wrong-project')body=body.replaceAll('fsbqpyyprtymwrmzsacp','wrong-project');
if(path==='src/partner-legal-bundle.mjs'&&scenario==='tampered-hash')body=body.replace('"1. Partes e formação.','"QA tampered 1. Partes e formação.');
await r.fulfill({body,contentType:/\.(js|mjs)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':'text/css'})});
await page.goto(origin+'/parceiros/documentos/');
if(scenario==='tampered-hash'){await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Integridade não confirmada'));assert.equal(await page.locator('#content').innerText(),'');assert.equal(await page.locator('#accept').isDisabled(),true)}
else{await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('somente em homologação'));assert.equal(await page.locator('#workspace').isVisible(),false)}
evidence.push({scenario,negativePassed:true,network:'intercepted-local'});await context.close();console.log('PASS legal fail closed '+scenario)}
await writeFile(new URL('../test-output/legal-ui'+(published?'-live':'')+'.json',import.meta.url),JSON.stringify(evidence,null,2));}finally{await browser.close()}
