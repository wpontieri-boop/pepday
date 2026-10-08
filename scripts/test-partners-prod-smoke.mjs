// Read-only public PROD smoke. No Auth login, intent, partner, payment or grant creation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {config} from '../public/config.js';
const base='https://pepday.com.br';
assert.equal(config.environment,'production');
assert.equal(config.projectRef,'oslefjmwfnddxlotalxu');
const enabled=process.env.PARTNERS_EXPECT_ENABLED==='1';
const edgesOnly=process.env.PARTNERS_SMOKE_EDGES_ONLY==='1';
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
if(!edgesOnly){
 for(const path of ['/','/app/','/cartao/','/admin/','/admin/parceiros/']){
  const response=await fetch(base+path,{cache:'no-store'});assert.equal(response.status,200,path);
  console.log('PASS HTTP 200 '+path);
 }
 for(const path of ['config.js','app/config.js','admin/admin.mjs','admin/index.html','admin/parceiros/index.html','admin/parceiros/partners.mjs','admin/parceiros/partners.css','admin/parceiros/validation.mjs','cartao/index.html','src/partner-public.mjs','src/partner-referral.mjs','src/partner-environment.mjs','src/partner-lock.mjs','app/src/acquisition.mjs','app/src/account-ui.mjs','app/sw.js']){
  const response=await fetch(base+'/'+path,{cache:'no-store'});assert.equal(response.status,200,path);
  assert.equal(hash(await response.text()),hash(await readFile(new URL('../public/'+path,import.meta.url),'utf8')),path);
 }
 console.log('PASS 16 live artifacts match approved production build');
}
for(const [name,body] of [['partner-public',{query:'',ref:''}],['partner-referral',{action:'inspect'}]]){
 const url=config.supabaseUrl+'/functions/v1/'+name;
 const headers={'Content-Type':'application/json',Origin:base,apikey:config.supabasePublishableKey};
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal(response.status,200,name);assert.equal(response.headers.get('cache-control'),'no-store');
 const data=await response.json();assert.equal(data.enabled,enabled,name);
 assert.equal(data.token,undefined);assert.equal(data.partner,undefined);
 if(data.partners)assert.deepEqual(data.partners,[]);
 for(const privateField of ['email','phone','document','pix_key','commission_percent','user_id'])assert.equal(privateField in data,false);
 const denied=await fetch(url,{method:'POST',headers:{...headers,Origin:'https://homologacao.pepday.com.br'},body:JSON.stringify(body)});
 assert.equal(denied.status,403);assert.equal((await denied.json()).code,'ORIGIN_DENIED');
 console.log('PASS '+name+' gate='+enabled+', public privacy, TEST origin denied');
}
const unauthenticated=await fetch(config.supabaseUrl+'/rest/v1/rpc/get_my_partner_attribution',{method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},body:'{}'});
assert.equal(unauthenticated.status,401);
console.log('PASS post-lock read denies unauthenticated access');
