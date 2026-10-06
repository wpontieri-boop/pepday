import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../supabase/functions/partner-public/index.mjs';
import {isPartnerTest} from '../src/partner-public.mjs';
const origin='https://homologacao.pepday.com.br';
const request=(data={},headers={})=>new Request('https://example.invalid/partner-public',{method:'POST',headers:{origin,...headers},body:JSON.stringify(data)});
const env=n=>({SUPABASE_URL:'https://fsbqpyyprtymwrmzsacp.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-secret'}[n]||'');
const handler=(fetcher=async()=>Response.json({enabled:true,partners:[]}))=>createHandler({env,fetch:fetcher});
test('P1 public search strips private fields even if upstream accidentally returns them',async()=>{
  const res=await handler(async()=>Response.json({enabled:true,partners:[{id:'fixture',public_name:'QA',email:'private@example.invalid',document:'private',pix_key:'private',commission_percent:99}]}))(request({query:'QA'}));
  assert.equal(res.status,200);const data=await res.json();assert.deepEqual(Object.keys(data.partners[0]),['id','public_name']);assert.equal(res.headers.get('cache-control'),'no-store');
});
test('P1 public search denies production before any provider request',async()=>{
  let calls=0;const res=await createHandler({env:n=>n==='SUPABASE_URL'?'https://oslefjmwfnddxlotalxu.supabase.co':'',fetch:async()=>{calls++}})(request());assert.equal(res.status,403);assert.equal(calls,0);
});
test('P1 public search rejects unknown keys and wrong types without backend calls',async()=>{
  let calls=0;const h=handler(async()=>{calls++});for(const data of [{query:42},{query:'x'.repeat(81)},{ref:'../../secret'},{partner_id:'forged'},[],null])assert.equal((await h(request(data))).status,400);assert.equal(calls,0);
});
test('P1 public search rejects foreign origins',async()=>assert.equal((await handler()(request({}, {origin:'https://pepday.com.br'}))).status,403));
test('P1 public search enforces body bound and does not expose SQL failures',async()=>{
  assert.equal((await handler()(request({query:'x'.repeat(600)}))).status,413);
  assert.equal((await handler()(request({query:'界'.repeat(200)}))).status,413);
  const res=await handler(async()=>Response.json({message:'private details'},{status:500}))(request());assert.equal(res.status,503);assert.equal(await res.text(),'{"code":"UNAVAILABLE"}');
});
test('P1 public search exposes 429 and clamps public page to 10',async()=>{
  assert.equal((await handler(async()=>Response.json({limited:true}))(request())).status,429);
  const data=await (await handler(async()=>Response.json({enabled:true,partners:Array.from({length:15},()=>({public_name:'QA'}))}))(request())).json();assert.equal(data.partners.length,10);
});
test('P1 public search handles disabled gate without showing data',async()=>{
  const data=await (await handler(async()=>Response.json({enabled:false,partners:[]}))(request())).json();assert.equal(data.enabled,false);assert.deepEqual(data.partners,[]);
});
test('P1 preflight and methods are constrained',async()=>{
  assert.equal((await handler()(new Request('https://example.invalid',{method:'OPTIONS',headers:{origin}}))).status,204);
  assert.equal((await handler()(new Request('https://example.invalid',{headers:{origin}}))).status,405);
});
test('P1 public browser guard requires TEST project and hostname',()=>{
  const cfg={environment:'test',projectRef:'fsbqpyyprtymwrmzsacp'};assert.equal(isPartnerTest(cfg,{hostname:'homologacao.pepday.com.br'}),true);assert.equal(isPartnerTest({...cfg,environment:'production'},{hostname:'homologacao.pepday.com.br'}),false);assert.equal(isPartnerTest(cfg,{hostname:'pepday.com.br'}),false);
});
test('P1 keeps P2+ entrypoints absent and preserves immutable commission version data',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20261006213126_partners_p1_test.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql,/create (?:or replace )?function public\.(?:claim_card_acquisition|apply_billing_event|record_recovery_payment)/i);
  assert.doesNotMatch(sql,/create table public\.(?:partner_attributions|partner_payouts|partner_portal_memberships|partner_commissions)/i);
  assert.match(sql,/payload_hash=encode\(sha256/);assert.match(sql,/used_at is null and expires_at>statement_timestamp/);
});
