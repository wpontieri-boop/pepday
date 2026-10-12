import test from 'node:test';
import assert from 'node:assert/strict';
import {portalHandler,PORTAL_URL,PORTAL_ORIGIN,SAMPLE,SAMPLE_SHA} from '../supabase/functions/partner-portal/portal-core.mjs';
const token='A'.repeat(43),id='11111111-1111-4111-8111-111111111111';
const req=(data,headers={})=>new Request(PORTAL_URL+'/functions/v1/partner-portal',{method:'POST',headers:{Origin:PORTAL_ORIGIN,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
const response=data=>Response.json(data);
test('portal denies PROD, foreign origin and missing server credentials before any network',async()=>{
 for(const options of [{url:'https://prod.invalid',secret:'server-fixture'},{url:PORTAL_URL,secret:''},{url:PORTAL_URL,secret:'server-fixture',foreign:true}]){
 let calls=0;const h=portalHandler({...options,fetcher:async()=>{calls++;throw Error()}});
 const r=await h(req({action:'view',session:token},options.foreign?{Origin:'https://pepday.com.br'}:{}));assert.equal(r.status,403);assert.equal(calls,0);
 }
});
test('HTTP preflight and methods are scoped TEST; no capability in query',async()=>{
 const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async()=>{throw Error('network')}});
 assert.equal((await h(new Request(PORTAL_URL,{method:'OPTIONS',headers:{Origin:PORTAL_ORIGIN}}))).status,204);
 assert.equal((await h(new Request(PORTAL_URL,{headers:{Origin:PORTAL_ORIGIN}}))).status,405);
 const r=await h(new Request(PORTAL_URL+'?token=bad',{method:'POST',headers:{Origin:PORTAL_ORIGIN,'Content-Type':'application/json'},body:'{}'}));assert.equal(r.status,400);
});
test('malformed token, excessive body and unknown actions never reach SQL',async()=>{
 let calls=0;const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async()=>{calls++;throw Error()}});
 for(const data of [{action:'view',session:'short'},{action:'challenge',invite:'bad'},{action:'pay',session:token},{action:'view',session:token,extra:'X'.repeat(17000)}]){
 assert.ok((await h(req(data))).status>=400);
 }assert.equal(calls,0);
});
test('challenge derives transport IP hash and does not echo OTP, body IP or PII',async()=>{
 let payload;const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async(url,o)=>{payload=JSON.parse(o.body).p_request;return response({ok:true,challenge:id,mode:'synthetic_only'})}});
 const r=await h(req({action:'challenge',invite:token,ip_hash:'attacker'}));const body=await r.json();
 assert.match(payload.ip_hash,/^[a-f0-9]{64}$/);assert.notEqual(payload.ip_hash,'attacker');assert.equal(body.code,undefined);assert.equal(body.session,undefined);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('SQL rejects stale or revoked session; Edge never leaks database errors',async()=>{
 const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async()=>response({ok:false,code:'private sql user@example.com'})});
 const r=await h(req({action:'view',session:token}));assert.equal(r.status,403);assert.deepEqual(await r.json(),{ok:false,code:'PORTAL_ACCESS_DENIED'});
});
test('partner payload uses service-only RPC, no Auth/admin user APIs or payment/WhatsApp',async()=>{
 const calls=[];const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async(url,o)=>{calls.push(url);assert.equal(o.headers.Authorization,'Bearer server-fixture');return response({ok:true,view:{}})}});
 assert.equal((await h(req({action:'view',session:token,partner_id:'untrusted'}))).status,200);
 assert.deepEqual(calls,[PORTAL_URL+'/rest/v1/rpc/partner_portal_exchange']);
});
test('upload rejects any personal/arbitrary file before Storage or SQL',async()=>{
 let calls=0;const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async()=>{calls++;throw Error()}});
 assert.equal((await h(req({action:'upload_sample',session:token,sample:'data:pdf;base64,real'}))).status,400);assert.equal(calls,0);
});
test('new private upload only stores known synthetic image under scoped grant',async()=>{
 const calls=[];let bytes;
 const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async(url,o)=>{
 calls.push(url);if(url.includes('/rpc/')){const p=JSON.parse(o.body).p_request;if(p.action==='doc_prepare')return response({ok:true,id,path:id+'/'+id,upload_token:token});assert.equal(p.action,'doc_complete');return response({ok:true})}
 assert.equal(o.headers['x-upsert'],'false');bytes=o.body;return response({ok:true});
 }});
 assert.equal((await h(req({action:'upload_sample',session:token,sample:SAMPLE}))).status,200);assert.equal(bytes.length,68);
 assert.match(calls[1],/partner-portal-synthetic-test/);assert.doesNotMatch(calls.join(),/object\/public/);assert.equal(calls.length,3);
});
test('failed completion removes only its newly uploaded sample',async()=>{
 const methods=[];const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async(url,o)=>{
 methods.push(o.method);if(url.includes('/rpc/'))return JSON.parse(o.body).p_request.action==='doc_prepare'?response({ok:true,id,path:id+'/'+id,upload_token:token}):new Response('',{status:403});
 return response({});
 }});
 assert.equal((await h(req({action:'upload_sample',session:token,sample:SAMPLE}))).status,403);assert.deepEqual(methods,['POST','POST','POST','DELETE']);
});
test('cross-partner download denied before storage; invalid paths fail closed',async()=>{
 for(const result of [{ok:false},{ok:true,path:'../other',sha256:SAMPLE_SHA}]){
 const calls=[];const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async(url)=>{calls.push(url);return response(result)}});
 assert.equal((await h(req({action:'download_sample',session:token,id}))).status,403);assert.equal(calls.length,1);
 }
});
test('download validates stored hash, byte count and attachment/no-store headers',async()=>{
 const bytes=Uint8Array.from(atob(SAMPLE),c=>c.charCodeAt(0));
 const h=portalHandler({url:PORTAL_URL,secret:'server-fixture',fetcher:async url=>url.includes('/rpc/')?response({ok:true,path:id+'/'+id,sha256:SAMPLE_SHA}):new Response(bytes)});
 const r=await h(req({action:'download_sample',session:token,id}));assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.arrayBuffer()).byteLength,68);
});
