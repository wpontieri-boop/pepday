import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isPartnerEnvironment,createPartnerCardClient} from '../src/partner-environment.mjs';
import {approvedStages,productionMigration,productionEdge} from '../scripts/partners-production-artifacts.mjs';
import {createHandler as publicHandler} from '../supabase/functions/partner-public/index.production.mjs';
import {createHandler as referralHandler} from '../supabase/functions/partner-referral/index.production.mjs';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
const prod={environment:'production',projectRef:'oslefjmwfnddxlotalxu',supabaseUrl:'https://oslefjmwfnddxlotalxu.supabase.co',supabasePublishableKey:'sb_publishable_synthetic'};
test('Production module requires exact environment/project/domain and separate client Auth storage',()=>{
 assert.equal(isPartnerEnvironment(prod,{hostname:'pepday.com.br'}),true);
 for(const [cfg,host] of [[prod,'homologacao.pepday.com.br'],[{...prod,projectRef:'fsbqpyyprtymwrmzsacp'},'pepday.com.br'],[{...prod,supabaseUrl:'https://example.invalid'},'pepday.com.br'],[{...prod,environment:'unknown'},'pepday.com.br']])assert.equal(isPartnerEnvironment(cfg,{hostname:host}),false);
 let opts;createPartnerCardClient((url,key,o)=>{opts=o},prod,{hostname:'pepday.com.br'});
 assert.equal(opts.auth.storageKey,'pepday-production-oslefjmwfnddxlotalxu-auth');assert.equal(opts.auth.flowType,'pkce');
 assert.throws(()=>createPartnerCardClient(()=>{},prod,{hostname:'homologacao.pepday.com.br'}));
});
test('PROD SQL promotion exactly preserves approved stages except environment and outer transaction',async()=>{
 const sources=await Promise.all(approvedStages.map(n=>read('supabase/migrations/'+n+'.sql')));
 const sql=await read('supabase/migrations/20261008225617_partners_p1_p2_production.sql');
 assert.equal(sql.replaceAll('\r\n','\n'),productionMigration(sources).replaceAll('\r\n','\n'));
 assert.doesNotMatch(sql,/fsbqpyyprtymwrmzsacp|create table public\.(partner_commissions|partner_ledger|partner_payouts)/);
 assert.match(sql,/PARTNERS_ALREADY_EXISTS_RECONCILE/);assert.match(sql,/referral_enabled boolean not null default false/);
});
test('PROD Edges differ only in deployment environment, reject TEST origin and foreign project, retain privacy',async()=>{
 for(const [name,handler,body] of [['partner-public',publicHandler,{query:'QA'}],['partner-referral',referralHandler,{action:'inspect'}]]){
  assert.equal((await read('supabase/functions/'+name+'/index.production.mjs')).replaceAll('\r\n','\n'),productionEdge(await read('supabase/functions/'+name+'/index.mjs')).replaceAll('\r\n','\n'));
  let calls=0;const env=n=>({SUPABASE_URL:prod.supabaseUrl,SUPABASE_SERVICE_ROLE_KEY:'synthetic'}[n]||'');
  const h=handler({env,fetch:async url=>{calls++;assert.ok(url.startsWith(prod.supabaseUrl));return Response.json({enabled:true,partners:[{public_name:'QA',email:'private',pix_key:'private'}],partner:{public_name:'QA',email:'private',pix_key:'private'}})}});
  const req=origin=>new Request('https://example.invalid',{method:'POST',headers:{origin},body:JSON.stringify(body)});
  assert.equal((await h(req('https://homologacao.pepday.com.br'))).status,403);assert.equal(calls,0);
  const res=await h(req('https://pepday.com.br'));assert.equal(res.status,200);assert.doesNotMatch(await res.text(),/private|pix_key|email/);
  const denied=handler({env:n=>n==='SUPABASE_URL'?'https://fsbqpyyprtymwrmzsacp.supabase.co':'',fetch:()=>assert.fail('cross environment')});assert.equal((await denied(req('https://pepday.com.br'))).status,403);
 }
});
