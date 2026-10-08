// TEST only. Rollback suite + actual overlapping PostgreSQL sessions.
// Credentials supplied via protected environment; never printed or copied to Git.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {validateDatabaseUrl,sanitizeError} from './test-b22d1-real-concurrency.mjs';
const connectionString=validateDatabaseUrl(process.env.SUPABASE_DB_URL);
const clients=Array.from({length:3},(_,i)=>new Client({connectionString,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000,query_timeout:20000,application_name:'pepday-p2-validation-'+i}));
const [db,a,b]=clients,partners=[randomUUID(),randomUUID()],users=[];
let connected=false,setup=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 await Promise.all(clients.map(c=>c.connect()));connected=true;
 const gate=await db.query('select referral_enabled from public.partner_config');assert.equal(gate.rows[0].referral_enabled,false,'Validate while public gate remains OFF');
 const core=await db.query(`select md5(replace(pg_get_functiondef('public.claim_card_acquisition_core_p2(timestamptz)'::regprocedure),'claim_card_acquisition_core_p2','claim_card_acquisition')) card,md5(pg_get_functiondef('public.get_entitlement()'::regprocedure)) entitlement`);
 assert.equal(core.rows[0].card,'4b66fcb9c9c68b33883ab10ad95dc03a');assert.equal(core.rows[0].entitlement,'329cdee20d77a221ec365af6a4fb0de6');
 const exported=await db.query("select md5(replace(pg_get_functiondef('public.export_my_data_core_p2()'::regprocedure),'export_my_data_core_p2','export_my_data')) digest");assert.equal(exported.rows[0].digest,'185c06d43cb30c0015b731aafaaf4bf6');
 await db.query(await readFile(new URL('../supabase/tests/partners_p2_assertions.sql',import.meta.url),'utf8'));
 console.log('PASS TEST SQL rollback: all P2 assertions, original commercial definitions unchanged');
 await db.query('begin');
 for(const [i,id] of partners.entries()){
  await db.query(`insert into public.partners(id,public_name,partner_type,city,slug,public_code,status) values($1,'P2 SQL concorrência','campanha',$2,$3,$4,'active')`,[id,'Cidade '+i,'p2-'+id,id.replaceAll('-','').slice(0,8).toUpperCase()]);
  await db.query('insert into public.partner_commission_rules(partner_id,version,commission_percent) values($1,1,$2)',[id,16+i]);
 }
 await db.query('commit');setup=true;
 for(const scenario of ['new-new','legacy-new','new-legacy']){
  const user=randomUUID();users.push(user);
  await db.query('begin');await db.query('insert into auth.users(id) values($1)',[user]);
  await db.query("update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),privacy_accepted_at=now(),sensitive_data_consent_at=now(),sensitive_data_consent_version='health-data-2026-09-30' where id=$1",[user]);await db.query('commit');
  await a.query('begin');
  // Gate true is visible ONLY inside session A; restore OFF before committing.
  // Public visitors never see P2 enabled during validation.
  await a.query('update public.partner_config set referral_enabled=true');
  const tokens=[];for(const id of partners)tokens.push((await a.query("select public.partner_referral_action('intent',$1,'link')->>'token' token",['p2-'+id])).rows[0].token);
  await a.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  const firstLegacy=scenario.startsWith('legacy'),secondLegacy=scenario.endsWith('legacy');
  const first=await a.query(firstLegacy?'select public.claim_card_acquisition() result':'select public.claim_partner_card_acquisition($1) result',firstLegacy?[]:[tokens[0]]);
  assert.equal(first.rows[0].result.benefit.code,'CARD_PRO_GRANTED');
  await b.query('begin');await b.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  const bPid=(await b.query('select pg_backend_pid() pid')).rows[0].pid,aPid=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const started=Date.now();let done=false;
  const pending=b.query(secondLegacy?'select public.claim_card_acquisition() result':'select public.claim_partner_card_acquisition($1) result',secondLegacy?[]:[tokens[1]]).then(r=>{done=true;return r});
  // Observe a real blocker; a fast sequential execution cannot pass this test.
  let observed=false;for(let i=0;i<15;i++){await sleep(80);const lock=await db.query('select $1::int=any(pg_blocking_pids($2)) blocked',[aPid,bPid]);if(lock.rows[0].blocked){observed=true;break}if(done)break}
  assert.equal(observed,true,'Real overlapping row lock required: '+scenario);await sleep(600);
  await a.query('update public.partner_config set referral_enabled=false');await a.query('commit');
  const second=await pending;await b.query('commit');assert.ok(Date.now()-started>=600);assert.equal(second.rows[0].result.benefit.code,'CARD_PRO_ALREADY_GRANTED');
  const counts=await db.query(`select (select count(*)::int from public.card_pro_grants where user_id=$1) grants,(select count(*)::int from public.partner_attributions where user_id=$1) attrs,(select partner_id from public.partner_attributions where user_id=$1) partner,(select count(*)::int from public.partner_referral_intents where partner_id=any($2::uuid[]) and consumed_at is not null) consumed`,[user,partners]);
  assert.equal(counts.rows[0].grants,1);assert.equal(counts.rows[0].attrs,1);assert.equal(counts.rows[0].partner,firstLegacy?null:partners[0]);
  console.log('PASS TEST concurrent '+scenario+': real lock observed, one grant, one immutable attribution');
 }
 assert.equal((await db.query('select referral_enabled from public.partner_config')).rows[0].referral_enabled,false);
}catch(e){console.error('FAIL P2 TEST: '+sanitizeError(e));process.exitCode=1}
finally{
 if(connected)for(const c of clients)try{await c.query('rollback')}catch{}
 if(connected&&setup)try{
  await db.query('begin');
  await db.query('delete from public.partner_attributions where user_id=any($1::uuid[]) or partner_id=any($2::uuid[])',[users,partners]);
  await db.query('delete from public.partner_referral_intents where partner_id=any($1::uuid[])',[partners]);
  await db.query('delete from public.partner_click_events where partner_id=any($1::uuid[])',[partners]);
  await db.query('delete from public.partner_click_daily where partner_id=any($1::uuid[])',[partners]);
  await db.query('delete from public.partner_commission_rules where partner_id=any($1::uuid[])',[partners]);
  await db.query('delete from public.partners where id=any($1::uuid[])',[partners]);
  await db.query('delete from public.audit_logs where user_id=any($1::uuid[])',[users]);
  await db.query('delete from auth.users where id=any($1::uuid[])',[users]);
  const clean=await db.query(`select (select count(*) from auth.users where id=any($1::uuid[]))+(select count(*) from public.profiles where id=any($1::uuid[]))+(select count(*) from public.card_pro_grants where user_id=any($1::uuid[]))+(select count(*) from public.partner_attributions where user_id=any($1::uuid[]) or partner_id=any($2::uuid[]))+(select count(*) from public.partners where id=any($2::uuid[]))+(select count(*) from public.partner_referral_intents where partner_id=any($2::uuid[])) remaining`,[users,partners]);
  assert.equal(Number(clean.rows[0].remaining),0);await db.query('commit');console.log('PASS cleanup: zero SQL-only fixture users, partners, grants, attributions and intents');
 }catch(e){try{await db.query('rollback')}catch{}console.error('FAIL cleanup: '+sanitizeError(e));process.exitCode=1}
 await Promise.all(clients.map(c=>c.end().catch(()=>{})));
}
