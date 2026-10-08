import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/partner-referral/index.mjs';
import {readReferralToken,saveReferralToken,forgetReferralToken,referralAction,isReferralTest} from '../src/partner-referral.mjs';
import {captureCardAcquisition,readAcquisition,claimPendingCardAcquisition} from '../src/acquisition.mjs';
const origin='https://homologacao.pepday.com.br',location={hostname:'homologacao.pepday.com.br'};
const token='a'.repeat(64),next='b'.repeat(64);
class Storage{map=new Map();getItem(k){return this.map.get(k)||null}setItem(k,v){this.map.set(k,String(v))}removeItem(k){this.map.delete(k)}}
const env=n=>({SUPABASE_URL:'https://fsbqpyyprtymwrmzsacp.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'}[n]||'');
const req=data=>new Request('https://example.invalid',{method:'POST',headers:{origin},body:JSON.stringify(data)});
const handler=fetcher=>createHandler({env,fetch:fetcher||(async()=>Response.json({enabled:true}))});
test('P2 stores only the opaque capability across module reads/reload, never partner metadata',()=>{
 const s=new Storage();assert.equal(saveReferralToken(token,s),true);assert.equal(readReferralToken(s),token);assert.deepEqual([...s.map.values()],[token]);forgetReferralToken(s);assert.equal(readReferralToken(s),null);
});
test('P2 rejects forged/malformed local selection and blocked storage safely',()=>{
 const s=new Storage();assert.throws(()=>saveReferralToken('partner-id-and-client-expiry',s));assert.equal(readReferralToken({getItem(){throw Error()}}),null);assert.equal(saveReferralToken(token,{setItem(){throw Error()}}),false);
});
test('P2 guard permits only TEST project, TEST hostname and TEST config',()=>{
 assert.equal(isReferralTest(undefined,location),true);assert.equal(isReferralTest(undefined,{hostname:'pepday.com.br'}),false);assert.equal(isReferralTest({environment:'production',projectRef:'fsbqpyyprtymwrmzsacp'},location),false);
});
test('P2 creates server-issued intent and replaces saved capability after explicit confirmation',async()=>{
 const s=new Storage();saveReferralToken(token,s);let sent;
 const data=await referralAction('intent',{storage:s,ref:'slug-b',source:'manual',confirmSwap:true,fetcher:async(url,opts)=>{sent=JSON.parse(opts.body);return Response.json({enabled:true,code:'CREATED',token:next,partner:{public_name:'B'}})}});
 assert.equal(data.code,'CREATED');assert.equal(sent.previous_token,token);assert.equal(sent.confirm_swap,true);assert.equal(readReferralToken(s),next);assert.equal(s.map.size,1);
});
test('P2 confirmation request/cancel does not overwrite previous explicit capability',async()=>{
 const s=new Storage();saveReferralToken(token,s);await referralAction('intent',{storage:s,source:'manual',fetcher:async()=>Response.json({enabled:true,code:'CONFIRM_SWAP_REQUIRED',partner:{public_name:'B'}})});assert.equal(readReferralToken(s),token);
});
test('P2 invalid or inactive replacement preserves prior choice instead of silently assigning another',async()=>{
 const s=new Storage();saveReferralToken(token,s);await referralAction('intent',{storage:s,fetcher:async()=>Response.json({enabled:true,code:'PARTNER_UNAVAILABLE'})});assert.equal(readReferralToken(s),token);
});
test('P2 inspect forgets expired/consumed capability and clear forgets explicit choice',async()=>{
 for(const code of ['INTENT_UNAVAILABLE','INTENT_EXPIRED_OR_MISSING','CLEARED']){const s=new Storage();saveReferralToken(token,s);await referralAction(code==='CLEARED'?'clear':'inspect',{storage:s,fetcher:async()=>Response.json({enabled:true,code})});assert.equal(readReferralToken(s),null)}
});
test('P2 disabled gate clears stale client choice',async()=>{
 const s=new Storage();saveReferralToken(token,s);await referralAction('inspect',{storage:s,fetcher:async()=>Response.json({enabled:false})});assert.equal(readReferralToken(s),null);
});
test('P2 explicit no-referral clears locally even when server is unreachable',async()=>{
 const s=new Storage();saveReferralToken(token,s);await assert.rejects(referralAction('clear',{storage:s,fetcher:async()=>{throw Error('offline')}}));assert.equal(readReferralToken(s),null);
});
test('P2 network failure retains indication for retry through login/onboarding',async()=>{
 const s=new Storage();saveReferralToken(token,s);await assert.rejects(referralAction('inspect',{storage:s,fetcher:async()=>new Response('',{status:503})}));assert.equal(readReferralToken(s),token);
});
test('P2 delayed response cannot overwrite a change made in another tab',async()=>{
 const s=new Storage();saveReferralToken(token,s);const data=await referralAction('intent',{storage:s,fetcher:async()=>{saveReferralToken(next,s);return Response.json({enabled:true,token:'c'.repeat(64)})}});assert.equal(data.code,'LOCAL_SELECTION_CHANGED');assert.equal(readReferralToken(s),next);
});
test('P2 card claim sends opaque token only to new TEST RPC, preserves acquisition on onboarding, consumes on grant',async()=>{
 const s=new Storage();saveReferralToken(token,s);captureCardAcquisition(s);let count=0;
 const client={rpc:async(name,args)=>{assert.equal(name,'claim_partner_card_acquisition');assert.equal(args.p_intent_token,token);assert.deepEqual(Object.keys(args),['p_first_seen_at','p_intent_token']);return {data:{benefit:{code:count++?'CARD_PRO_GRANTED':'CARD_PRO_NEEDS_ONBOARDING'}},error:null}}};
 await claimPendingCardAcquisition(client,s,{location});assert.equal(readReferralToken(s),token);assert.ok(readAcquisition(s));await claimPendingCardAcquisition(client,s,{location});assert.equal(readReferralToken(s),null);assert.equal(readAcquisition(s),null);
});
test('P2 new TEST RPC also seals no-referral and older clients still use legacy outside TEST',async()=>{
 for(const [where,name] of [[location,'claim_partner_card_acquisition'],[{hostname:'pepday.com.br'},'claim_card_acquisition']]){const s=new Storage();captureCardAcquisition(s);await claimPendingCardAcquisition({rpc:async(n,args)=>{assert.equal(n,name);assert.equal('p_intent_token' in args,n==='claim_partner_card_acquisition');return {data:{benefit:{code:'CARD_PRO_GRANTED'}},error:null}}},s,{location:where})}
});
test('P2 failed activation preserves both markers and concurrent replacement survives claim cleanup',async()=>{
 const s=new Storage();saveReferralToken(token,s);captureCardAcquisition(s);await assert.rejects(claimPendingCardAcquisition({rpc:async()=>({error:Error('offline')})},s,{location}));assert.ok(readAcquisition(s));assert.equal(readReferralToken(s),token);
 await claimPendingCardAcquisition({rpc:async()=>{saveReferralToken(next,s);return {data:{benefit:{code:'CARD_PRO_GRANTED'}},error:null}}},s,{location});assert.equal(readReferralToken(s),next);
});
test('P2 Edge forwards strict inputs and allowlists public result independently of SQL',async()=>{
 let sent;const res=await handler(async(url,opts)=>{sent=JSON.parse(opts.body);return Response.json({enabled:true,token,partner:{public_name:'A',city:'B',email:'private',pix_key:'private',commission_percent:16},user_id:'private'})})(req({action:'intent',ref:'slug',source:'link'}));
 assert.equal(res.status,200);assert.equal(sent.p_action,'intent');assert.equal(sent.p_previous_token,'');const data=await res.json();assert.deepEqual(Object.keys(data.partner),['public_name','city']);assert.equal(data.user_id,undefined);assert.equal(res.headers.get('cache-control'),'no-store');
});
test('P2 Edge rejects malformed, forged identifiers, invalid capabilities and excessive bodies without upstream',async()=>{
 let calls=0;const h=handler(async()=>{calls++});for(const body of [null,[],{action:'intent',partner_id:'forged'},{action:'intent',ref:'../secret'},{action:'clear',previous_token:'forged'},{action:'intent',confirm_swap:'true'},{action:'intent',event_id:'not-uuid'},{action:'unknown'},{action:'intent',source:'untrusted'}])assert.equal((await h(req(body))).status,400);
 assert.equal((await h(req({action:'intent',ref:'界'.repeat(400)}))).status,413);assert.equal(calls,0);
});
test('P2 Edge forbids production and foreign origins before upstream',async()=>{
 let calls=0;const fetcher=async()=>{calls++};assert.equal((await createHandler({env:n=>n==='SUPABASE_URL'?'https://oslefjmwfnddxlotalxu.supabase.co':'',fetch:fetcher})(req({action:'inspect'}))).status,403);
 assert.equal((await handler(fetcher)(new Request('https://example.invalid',{method:'POST',headers:{origin:'https://pepday.com.br'},body:'{}'}))).status,403);assert.equal(calls,0);
});
test('P2 Edge enforces methods and shared rate limit, returns generic errors without secrets',async()=>{
 assert.equal((await handler()(new Request('https://example.invalid',{method:'OPTIONS',headers:{origin}}))).status,204);assert.equal((await handler()(new Request('https://example.invalid',{headers:{origin}}))).status,405);
 assert.equal((await handler(async()=>Response.json({limited:true}))(req({action:'inspect'}))).status,429);
 const res=await handler(async()=>Response.json({message:'secret internal failure'},{status:500}))(req({action:'inspect'}));assert.equal(await res.text(),'{"code":"UNAVAILABLE"}');
});
