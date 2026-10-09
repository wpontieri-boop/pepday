// Isolated authored frontend + pinned real SDK. All Auth/RPC responses synthetic.
// No real login, MFA factor, membership, email or backend mutation.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executables={Chrome:process.env.CHROME_EXECUTABLE,Edge:process.env.EDGE_EXECUTABLE};
const only=process.env.ADMIN_TOTP_BROWSER;
const jwt=p=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify(p)).toString('base64url'),'synthetic_signature'].join('.');
const identity=email=>email.startsWith('second')?'40000000-0000-4000-8000-000000000002':'40000000-0000-4000-8000-000000000001';
const factor=email=>email.startsWith('second')?'50000000-0000-4000-8000-000000000002':'50000000-0000-4000-8000-000000000001';
const user=email=>({id:identity(email),email,role:'authenticated',aud:'authenticated',app_metadata:{},user_metadata:{},factors:[{id:factor(email),factor_type:'totp',status:'verified',friendly_name:'Synthetic Admin'}]});
const session=(email,aal,project)=>({access_token:jwt({sub:identity(email),email,aal,role:'authenticated',aud:'authenticated',iss:`https://${project}.supabase.co/auth/v1`,exp:Math.floor(Date.now()/1000)+3600,amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)},...(aal==='aal2'?[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]:[])]}),refresh_token:'synthetic-refresh-token',token_type:'bearer',expires_in:3600,user:user(email)});
await mkdir(path.join(root,'test-output'),{recursive:true});
let matrices=0;
for(const [browserName,executablePath] of Object.entries(executables)){
 if(only&&only!==browserName)continue;
 assert.ok(executablePath,'Provide '+browserName+' executable');
 const browser=await chromium.launch({headless:true,executablePath});
 try{for(const environment of ['test','production'])for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  const project=environment==='test'?'fsbqpyyprtymwrmzsacp':'oslefjmwfnddxlotalxu';
  const host=environment==='test'?'homologacao.pepday.com.br':'pepday.com.br',base='https://'+host;
  const authKey=`pepday-${environment}-${project}-admin-auth`;
  const otherKey=environment==='test'?'pepday-production-oslefjmwfnddxlotalxu-admin-auth':'pepday-test-fsbqpyyprtymwrmzsacp-admin-auth';
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],logins=[],scopes=[],factorCalls=[],unexpected=[];
  let delayVerify=false,releaseVerify,verifyStarted,logoutFailure=false;
  let delayContext=false,releaseContext,contextStarted;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   const reply=(json,status=200)=>route.fulfill({status,json});
   if(url.hostname.endsWith('.supabase.co')){
    assert.equal(url.hostname,project+'.supabase.co','cross-environment request');
    const payload=req.headers().authorization?.split(' ')[1]?.split('.')[1];
    const claims=payload?JSON.parse(Buffer.from(payload,'base64url').toString()):{};
    const email=claims.email||'first@example.invalid';
    if(url.pathname==='/auth/v1/token'){
     assert.equal(url.searchParams.get('grant_type'),'password');
     const body=req.postDataJSON();assert.equal(body.password,'synthetic-password');logins.push(body.email);
     return reply(session(body.email,'aal1',project));
    }
    if(url.pathname==='/auth/v1/user')return reply(user(email));
    if(url.pathname==='/auth/v1/logout'){
     scopes.push(url.searchParams.get('scope'));assert.equal(scopes.at(-1),'local');
     if(logoutFailure)return reply({code:'synthetic_logout_failure',msg:'Synthetic sign-out failure'},400);
     return route.fulfill({status:204,body:''});
    }
    if(url.pathname.includes('/factors/')&&url.pathname.endsWith('/challenge')){
     factorCalls.push(url.pathname.split('/')[4]);assert.equal(factorCalls.at(-1),factor(email));
     return reply({id:'60000000-0000-4000-8000-000000000001',expires_at:Math.floor(Date.now()/1000)+300});
    }
    if(url.pathname.includes('/factors/')&&url.pathname.endsWith('/verify')){
     if(delayVerify){delayVerify=false;verifyStarted();await new Promise(resolve=>releaseVerify=resolve)}
     if(req.postDataJSON().code!=='123456')return reply({code:'mfa_verification_failed',msg:'Synthetic invalid code'},422);
     return reply(session(email,'aal2',project));
    }
    if(url.pathname==='/rest/v1/rpc/get_admin_context'){
     if(delayContext){delayContext=false;contextStarted();await new Promise(resolve=>releaseContext=resolve)}
     return reply({email,access_level:'owner',password_configured:true,aal:claims.aal,can_write:true,can_manage_team:true});
    }
    if(url.pathname.startsWith('/rest/v1/rpc/')){
     assert.equal(claims.aal,'aal2','RPC dashboard must never run at AAL1');
     return reply(url.pathname.includes('team')||url.pathname.includes('audit')||url.pathname.includes('codes')||url.pathname.includes('candidates')?[]:{});
    }
    unexpected.push(url.pathname);return reply({msg:'Unexpected synthetic API call'},400);
   }
   if(url.hostname!==host){unexpected.push(url.hostname);return route.abort()}
   const pathname=decodeURIComponent(url.pathname);
   const filename=pathname==='/config.js'?(environment==='test'?'config.js':'config.production.js'):
    pathname==='/admin/'?'site/admin/index.html':pathname.startsWith('/admin/')?'site'+pathname:pathname.slice(1);
   try{
    const bytes=await readFile(path.join(root,filename));
    return route.fulfill({body:bytes,contentType:filename.endsWith('.html')?'text/html':/\.(mjs|js)$/.test(filename)?'text/javascript':filename.endsWith('.css')?'text/css':'image/svg+xml'});
   }catch{unexpected.push(filename);return route.fulfill({status:404,body:'Not found'})}
  });
  const loginReady=()=>page.waitForFunction(()=>!document.getElementById('loginForm').classList.contains('hidden')&&!document.querySelector('#loginForm button').disabled);
  const challengeReady=()=>page.waitForFunction(()=>!document.getElementById('mfaChallengeForm').classList.contains('hidden')&&!document.querySelector('#mfaChallengeForm button').disabled);
  const login=async email=>{await loginReady();await page.locator('#email').fill(email);await page.locator('#password').fill('synthetic-password');await page.locator('#loginForm button').click();await challengeReady();assert.match(await page.locator('#mfaChallengeIdentity').textContent(),new RegExp(email.replace('.','\\.')));assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#dashboard').isVisible(),false)};
  const clean=async()=>{await loginReady();assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#mfaChallengeCode').inputValue(),'');assert.equal(await page.locator('#dashboard').isVisible(),false);assert.deepEqual(await page.evaluate(({authKey,otherKey})=>({auth:localStorage.getItem(authKey),client:localStorage.getItem('client-data-sentinel'),other:localStorage.getItem(otherKey)}),{authKey,otherKey}),{auth:null,client:'preserve',other:'preserve'})};
  await page.goto(base+'/admin/');await loginReady();
  await page.evaluate(otherKey=>{localStorage.setItem(otherKey,'preserve');localStorage.setItem('client-data-sentinel','preserve')},otherKey);
  await login('first@example.invalid');
  await page.locator('#mfaChallengeCode').fill('000000');await page.locator('#mfaChallengeForm button[type=submit]').click();
  await page.waitForFunction(()=>document.getElementById('authStatus').textContent.includes('inválido'));
  assert.equal(await page.locator('#mfaChallengeCode').inputValue(),'');assert.equal(await page.locator('#mfaBack').isEnabled(),true);assert.equal(await page.locator('#dashboard').isVisible(),false);
  await page.reload();await challengeReady();assert.match(await page.locator('#mfaChallengeIdentity').textContent(),/first@example.invalid/);
  await page.goBack();await clean();
  await page.goForward();await clean();
  await login('second@example.invalid');await page.locator('#mfaBack').click();await clean();
  await login('first@example.invalid');await page.locator('#mfaLogout').click();await clean();
  await login('second@example.invalid');
  await page.locator('#mfaChallengeCode').fill('000000');await page.locator('#mfaChallengeForm button[type=submit]').click();
  await page.waitForFunction(()=>document.getElementById('authStatus').textContent.includes('inválido'));
  await page.locator('#mfaChallengeCode').fill('123456');await page.locator('#mfaChallengeForm button[type=submit]').click();await page.locator('#dashboard').waitFor({state:'visible'});
  await page.reload();await page.locator('#dashboard').waitFor({state:'visible'});
  await page.locator('#logout').click();await clean();
  await login('first@example.invalid');
  const started=new Promise(resolve=>verifyStarted=resolve);delayVerify=true;
  await page.locator('#mfaChallengeCode').fill('123456');await page.locator('#mfaChallengeForm button[type=submit]').click();await started;
  await page.locator('#mfaBack').click();await clean();releaseVerify();
  await login('first@example.invalid');
  const contextPending=new Promise(resolve=>contextStarted=resolve);delayContext=true;
  await page.locator('#mfaChallengeCode').fill('123456');await page.locator('#mfaChallengeForm button[type=submit]').click();await contextPending;
  await page.locator('#mfaLogout').click();await clean();releaseContext();
  await login('second@example.invalid');logoutFailure=true;await page.locator('#mfaLogout').click();await clean();
  assert.match(await page.locator('#authStatus').textContent(),/Não foi possível confirmar a saída no servidor/);logoutFailure=false;
  await page.reload();await loginReady();assert.equal(await page.locator('#mfaChallengeForm').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.ok(scopes.length>=5);assert.ok(logins.includes('second@example.invalid'));
  if(browserName==='Edge'&&environment==='test'&&viewport.width===390){await login('first@example.invalid');await page.screenshot({path:path.join(root,'test-output/admin-totp-edge-mobile.png'),fullPage:true})}
  console.log(`PASS ${browserName} ${environment} ${viewport.width}: password→TOTP, invalid→retry, refresh/back, switch email, local logout, AAL2 only, late-response cancel, logout-error cleanup, isolated storage, no MFA mutation/overflow`);
  matrices++;await context.close();
 }}finally{await browser.close()}
}
console.log(`PASS ${matrices} browser/environment/viewport matrices (synthetic Auth only)`);
