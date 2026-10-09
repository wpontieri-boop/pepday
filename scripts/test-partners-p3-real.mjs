// TEST only. All financial fixtures roll back. Concurrency uses row locks only.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {validateDatabaseUrl,sanitizeError} from './test-b22d1-real-concurrency.mjs';
const connectionString=validateDatabaseUrl(process.env.SUPABASE_DB_URL);
const clients=Array.from({length:3},(_,i)=>new Client({connectionString,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000,query_timeout:45000,application_name:'pepday-p3-validation-'+i}));
const [db,a,b]=clients;
const baseline=async()=> (await db.query(`select jsonb_build_object('users',(select count(*) from auth.users),'partners',(select count(*) from partners),'attrs',(select count(*) from partner_attributions),'billing',(select count(*) from billing_events),'payments',(select count(*) from partner_financial_payments),'commissions',(select count(*) from partner_commissions),'payouts',(select count(*) from partner_payouts),'ledger',(select count(*) from partner_ledger_entries),'gate',(select finance_enabled from partner_config),'cores',(select jsonb_object_agg(proname,md5(prosrc)) from pg_proc where proname in ('get_entitlement','apply_billing_event','claim_card_acquisition_core_p2','export_my_data_core_p2'))) snapshot`)).rows[0].snapshot;
try{
 await Promise.all(clients.map(c=>c.connect()));const before=await baseline();assert.equal(before.gate,false);
 await db.query(await readFile(new URL('../supabase/tests/partners_p3_assertions.sql',import.meta.url),'utf8'));assert.deepEqual(await baseline(),before);
 console.log('PASS P3 TEST SQL: all synthetic financial scenarios rolled back; baseline/core digests unchanged');
 const partner=(await db.query('select id from public.partners order by id limit 1')).rows[0]?.id;assert.ok(partner,'An existing partner is needed only as a read-lock target');
 await a.query('begin');await a.query('select public.partner_finance_lock($1)',[partner]);const aPid=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
 await b.query('begin');const bPid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;let done=false;
 const pending=b.query('select public.partner_finance_lock($1)',[partner]).then(r=>{done=true;return r});let observed=false;
 for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,80));const result=await db.query('select $1::int=any(pg_blocking_pids($2)) blocked',[aPid,bPid]);if(result.rows[0].blocked){observed=true;break}if(done)break}
 assert.equal(observed,true,'Actual overlapping row lock must be observed');await a.query('rollback');await pending;await b.query('rollback');assert.deepEqual(await baseline(),before);
 console.log('PASS P3 TEST concurrency: pg_blocking_pids proved serialization; both sessions rolled back, zero financial writes');
}catch(e){console.error('FAIL P3 TEST: '+sanitizeError(e));process.exitCode=1}
finally{for(const c of clients)try{await c.query('rollback')}catch{}await Promise.all(clients.map(c=>c.end().catch(()=>{})))}
