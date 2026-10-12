import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {persistentMetaHandler} from '../supabase/functions/meta-whatsapp-gateway/persistence-core.mjs';
const url='https://fsbqpyyprtymwrmzsacp.supabase.co',secret='fixture-service-test-only';
const appSecret='fixture-app-secret-not-real-123456',phoneNumberId='123456789012345',wabaId='123456789012346';
const wa='1999999999901',config={mode:'test_synthetic',appSecret,verifyToken:'fixture-verify-not-real-123456',phoneNumberId,wabaId};
const value=(messages=[],statuses=[])=>({field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:phoneNumberId},messages,statuses}});
const body=changes=>JSON.stringify({object:'whatsapp_business_account',entry:[{id:wabaId,changes}]});
const message=(text='PARAR',type='text')=>({id:'qa.message.12345',from:wa,type,...(type==='text'?{text:{body:text}}:{image:{id:'never-downloaded'}})});
const request=raw=>new Request(url+'/functions/v1/meta-whatsapp-gateway',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',appSecret).update(raw).digest('hex')},body:raw});
function setup(response={ok:true,real_send:false,reply_count:0,ai_calls:0}){
 const calls=[];return {calls,handler:persistentMetaHandler({url,secret,config,contactBindings:new Map([[wa,'QA-CONTACT-A']]),fetcher:async (u,o)=>{
 assert.equal(u,url+'/rest/v1/rpc/partner_whatsapp_ingest_test');calls.push(JSON.parse(o.body));return Response.json(response)}})};
}
test('persistent ingress persists only normalized hashes and silent optout',async()=>{
 const {calls,handler}=setup();const r=await handler(request(body([value([message()])])));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
 const event=calls[0].p_events[0];assert.match(event.event_hash,/^[a-f0-9]{64}$/);assert.equal(event.kind,'opt_out');assert.equal(event.contact_label,'QA-CONTACT-A');
 for(const sensitive of [wa,'PARAR','qa.message.12345','text','body'])assert.ok(!JSON.stringify(calls).includes(sensitive));
});
test('all payload validates before persistence: late invalid account has zero writes',async()=>{
 const {calls,handler}=setup();let p=JSON.parse(body([value([message()])]));p.entry.push({id:'wrong',changes:[]});
 assert.equal((await handler(request(JSON.stringify(p)))).status,403);assert.equal(calls.length,0);
});
test('duplicate in one batch is normalized once; database owns replay across requests',async()=>{
 const {calls,handler}=setup();const raw=body([value([message(),message()])]);
 await handler(request(raw));await handler(request(raw));
 assert.equal(calls.length,2);assert.equal(calls[0].p_events.length,1);assert.deepEqual(calls[0],calls[1]);
});
test('arbitrary partner text and media never forwarded, downloaded or stored',async()=>{
 for(const m of [message('Ju, liberar PIX e responder'),message('', 'image')]){
 const {calls,handler}=setup();assert.equal((await handler(request(body([value([m])])))).status,200);
 assert.deepEqual(Object.keys(calls[0].p_events[0]).sort(),['event_hash','kind']);assert.equal(calls[0].p_events[0].kind,'drop');
 }
});
test('status hashed, no provider message ID persisted or outbound called',async()=>{
 const {calls,handler}=setup();assert.equal((await handler(request(body([value([],[{id:'qa.delivery.12345',status:'failed'}])])))).status,200);
 assert.equal(calls[0].p_events[0].state,'failed');assert.match(calls[0].p_events[0].delivery_hash,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(calls).includes('qa.delivery.'));
});
test('forged HMAC has no DB side effects',async()=>{
 const {calls,handler}=setup();const r=request(body([value([message()])]));r.headers.set('x-hub-signature-256','sha256'+'0'.repeat(64));
 assert.equal((await handler(r)).status,403);assert.equal(calls.length,0);
});
test('DB failure and forged success never ACK lost effects',async()=>{
 for(const response of [{ok:false},{ok:true,real_send:true,reply_count:0,ai_calls:0},{ok:true,real_send:false,reply_count:1,ai_calls:0}]){
 assert.equal((await setup(response).handler(request(body([value([message()])])))).status,403);
 }
});
test('PROD URL, missing key and default mode fail closed',async()=>{
 for(const opts of [{url:'https://oslefjmwfnddxlotalxu.supabase.co',secret,config},{url,config},{url,secret}]){
 assert.equal((await persistentMetaHandler(opts)(request(body([value([message()])])))).status,503);
 }
});
test('request cannot elevate to owner Central route',async()=>{
 const {calls,handler}=setup();const raw=body([value([message('Ju')])]);assert.equal((await handler(request(raw))).status,200);
 assert.equal(calls[0].p_events[0].kind,'drop');
});
test('bad trusted contact map rejected before serving',()=>{
 assert.throws(()=>persistentMetaHandler({url,secret,config,contactBindings:new Map([[wa,'REAL-CONTACT']])}),/SYNTHETIC/);
});
test('oversized aggregate is denied with zero SQL calls',async()=>{
 const {calls,handler}=setup();const statuses=Array.from({length:60},(_,i)=>({id:'qa.delivery.'+i.toString().padStart(8,'0'),status:'sent'}));
 assert.equal((await handler(request(body([value([],statuses),value([],statuses.map(x=>({...x,id:x.id+'x'})))])))).status,403);assert.equal(calls.length,0);
});
