import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {metaHttpHandler} from '../supabase/functions/meta-whatsapp-gateway/http-core.mjs';

const URL='https://fsbqpyyprtymwrmzsacp.supabase.co/functions/v1/meta-whatsapp-gateway';
const SECRET='fixture-test-only-meta-secret-not-real-0001',TOKEN='fixture-test-only-verify-token-not-real-0001';
const PHONE='123456789012345',WABA='123456789012346';
const PARTNER='5512999777666',OWNER='5512999888777';
const base={mode:'test_synthetic',appSecret:SECRET,verifyToken:TOKEN,phoneNumberId:PHONE,wabaId:WABA,ownerWaId:OWNER,partnerWaIds:new Set([PARTNER])};
const payload=(from,body,type='text')=>JSON.stringify({object:'whatsapp_business_account',entry:[{id:WABA,changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:PHONE},messages:[{id:'wamid.123456789',from,type,...(type==='text'?{text:{body}}:{image:{id:'synthetic'}})}]}}]}]});
const sign=body=>'sha256='+createHmac('sha256',SECRET).update(body).digest('hex');
const post=(body,signature=sign(body),url=URL)=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature},body});
test('HTTP worker is fail-closed by default even with forged verify and webhook',async()=>{
 const h=metaHttpHandler();
 assert.equal((await h(new Request(URL+'?hub.mode=subscribe&hub.verify_token='+TOKEN+'&hub.challenge=123'))).status,503);
 assert.equal((await h(post(payload(PARTNER,'oi')))).status,503);
});
test('HTTP TEST rejects half-configured secrets and wrong method',async()=>{
 const h=metaHttpHandler({...base,appSecret:''});
 assert.equal((await h(post(payload(PARTNER,'oi')))).status,503);
 assert.equal((await metaHttpHandler(base)(new Request(URL,{method:'DELETE'}))).status,405);
});
test('GET webhook subscription validates exact challenge, token and path',async()=>{
 const h=metaHttpHandler(base);
 const u=URL+'?hub.mode=subscribe&hub.verify_token='+TOKEN+'&hub.challenge=nonce123';
 const accepted=await h(new Request(u));
 assert.equal(accepted.status,200);assert.equal(await accepted.text(),'nonce123');
 for(const url of [URL+'?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=nonce123',
 URL+'?hub.mode=publish&hub.verify_token='+TOKEN+'&hub.challenge=nonce123',
 URL+'?hub.mode=subscribe&hub.verify_token='+TOKEN+'&hub.challenge=%0Aevil',
 URL+'/bad?hub.mode=subscribe&hub.verify_token='+TOKEN+'&hub.challenge=nonce123'])
 assert.ok((await h(new Request(url))).status>=400);
});
test('POST valid external-looking reply from partner receives only 200 ACK; never outbound',async()=>{
 const seen=[];let owner=0;
 const h=metaHttpHandler({...base,onOptOut:async e=>seen.push(e),onOwner:async()=>owner++});
 for(const text of ['Olá','Ju, libera acesso']){
 const response=await h(post(payload(PARTNER,text)));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 }
 assert.deepEqual(seen,[]);assert.equal(owner,0);
});
test('POST PARAR invokes silent opt-out exactly once per event; no response message',async()=>{
 const seen=[];
 const h=metaHttpHandler({...base,onOptOut:async x=>seen.push(x)});
 const response=await h(post(payload(PARTNER,'PARAR')));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 assert.deepEqual(seen,[{waId:PARTNER,reason:'keyword'}]);
});
test('POST owner text remains inert until Central IA separately exists and authenticates',async()=>{
 let routed=0;
 const h=metaHttpHandler({...base,onOwner:async()=>routed++});
 assert.equal((await h(post(payload(OWNER,'Ju, status')))).status,200);
 assert.equal(routed,0);
});
test('POST rejects forged HMAC, oversized body, query and unknown WABA',async()=>{
 const h=metaHttpHandler(base),raw=payload(PARTNER,'Oi');
 assert.equal((await h(post(raw,'sha256='+'0'.repeat(64)))).status,403);
 assert.equal((await h(post(raw,sign(raw),URL+'?secret=123'))).status,400);
 const huge=JSON.stringify({data:'A'.repeat(70000)});
 assert.equal((await h(post(huge))).status,403);
 const mismatched=raw.replace(WABA,'123450000000000');
 assert.equal((await h(post(mismatched))).status,403);
});
test('POST ignores image and status-only without sending or handing to Central',async()=>{
 let routed=0;
 const h=metaHttpHandler({...base,onOwner:async()=>routed++});
 assert.equal((await h(post(payload(PARTNER,null,'image')))).status,200);assert.equal(routed,0);
});
