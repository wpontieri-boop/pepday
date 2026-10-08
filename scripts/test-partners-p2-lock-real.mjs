import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {validateDatabaseUrl,sanitizeError} from './test-b22d1-real-concurrency.mjs';
const db=new Client({connectionString:validateDatabaseUrl(process.env.SUPABASE_DB_URL),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000,query_timeout:20000,application_name:'pepday-p2-lock-read-validation'});
try{
 await db.connect();
 const snapshot=async()=>JSON.stringify((await db.query(`select (select referral_enabled from public.partner_config) gate,(select count(*) from auth.users) users,(select count(*) from public.partners) partners,(select count(*) from public.card_pro_grants) grants,(select count(*) from public.partner_attributions) attrs,(select count(*) from public.partner_referral_intents) intents,
 md5(replace(pg_get_functiondef('public.claim_card_acquisition_core_p2(timestamptz)'::regprocedure),'claim_card_acquisition_core_p2','claim_card_acquisition')) card,md5(pg_get_functiondef('public.get_entitlement()'::regprocedure)) entitlement`)).rows);
 const before=await snapshot();
 await db.query(await readFile(new URL('../supabase/tests/partners_p2_locked_read.sql',import.meta.url),'utf8'));
 assert.equal(await snapshot(),before,'Rollback must preserve gate, accounts, data and commercial definitions');
 console.log('PASS TEST lock-read SQL: authenticated own public projection, sealed absence, isolation, anon denied, no writes/grant, rollback and gate preserved');
}catch(e){console.error('FAIL '+sanitizeError(e));process.exitCode=1}
finally{try{await db.query('rollback')}catch{}await db.end().catch(()=>{})}
