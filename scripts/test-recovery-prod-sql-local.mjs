import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw new Error('PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const read=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const db=new PGlite();let passed=0;
const check=(value,expected,label)=>{assert.deepEqual(value,expected,label);passed++;};
const uid=i=>`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema extensions;create schema vault;create schema net;create schema cron;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select convert_to($1,'UTF8')$$;
    create function public.admin_assert_access(boolean,boolean) returns text language sql as $$select 'owner'::text$$;
    create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
    insert into vault.decrypted_secrets(name,decrypted_secret) values('pepday_supabase_project_url','https://oslefjmwfnddxlotalxu.supabase.co');
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$select 1::bigint$$;`);
  const table=async(file,name)=>{const sql=await read(file),start=sql.indexOf('create table public.'+name+' (');
    assert.ok(start>=0,name);await db.exec(sql.slice(start,sql.indexOf('\n);',start)+4));};
  for(const name of ['profiles','subscriptions','trials','settings'])await table('202609090001_block_a.sql',name);
  const billing=await read('20260928202253_block_c_billing_foundation.sql');
  await db.exec(billing.slice(billing.indexOf('alter table public.subscriptions'),billing.indexOf('create table public.billing_events')));
  await db.exec('create table public.acquisition_attributions(id uuid primary key);');
  await table('20261001184711_card_qr_30d_benefit.sql','card_pro_grants');
  for(const name of ['promo_codes','promo_redemptions'])await table('20260929172504_promo_codes_access.sql',name);
  await db.exec(await read('20261005224500_recovery_production_campaign.sql'));

  for(let i=1;i<=6;i++)await db.exec(`insert into auth.users values('${uid(i)}');
    insert into profiles(id,email) values('${uid(i)}','prod-recovery${i}@example.invalid');
    insert into subscriptions(user_id) values('${uid(i)}');
    insert into settings(user_id,marketing_opt_in,marketing_accepted_at) values('${uid(i)}',true,now());`);
  await db.exec(`insert into trials(user_id,trial_used,started_at,ends_at) values
      ('${uid(1)}',true,now()-interval '12 days',now()-interval '5 days'),
      ('${uid(2)}',true,now()-interval '5 days',now()+interval '2 days'),
      ('${uid(3)}',true,now()-interval '12 days',now()-interval '5 days'),
      ('${uid(4)}',true,now()-interval '12 days',now()-interval '5 days');
    update settings set marketing_opt_in=false,marketing_accepted_at=null where user_id='${uid(3)}';
    update profiles set role='admin' where id='${uid(4)}';
    update subscriptions set status='pro_active',plan='monthly',current_period_end=now()+interval '30 days' where user_id='${uid(5)}';
    insert into acquisition_attributions values('${uid(6)}');
    insert into card_pro_grants(user_id,acquisition_id,starts_at,ends_at)
      values('${uid(6)}','${uid(6)}',now()-interval '35 days',now()-interval '5 days');`);

  const scalar=async sql=>(await db.query(sql)).rows[0];
  check((await scalar('select enabled from recovery_config where singleton')).enabled,false,'production recovery disabled by default');
  check((await scalar('select provider_ready from recovery_config where singleton')).provider_ready,false,'provider disabled by default');
  check((await scalar('select prepare_recovery_campaigns() result')).result.outcome,'disabled','disabled migration cannot enroll');
  await db.exec(`update recovery_config set enabled=true,provider_ready=true,template_ids='{"warning":1,"ended":2,"resume":3,"offer":4,"last":5}' where singleton;`);
  await db.exec('select prepare_recovery_campaigns();select prepare_recovery_campaigns();');
  check((await scalar('select count(*)::int n from recovery_campaigns')).n,3,'automatic audience includes only eligible commercial accounts');
  check((await scalar('select count(*)::int n from recovery_email_outbox')).n,15,'automatic audience gets unique stages only');
  check((await scalar(`select source from recovery_campaigns where user_id='${uid(6)}'`)).source,'card','card priority remains');
  check((await scalar(`select extract(day from offer_starts_at-benefit_start)::int d from recovery_campaigns where user_id='${uid(1)}'`)).d,12,'trial offer day12');
  check((await scalar(`select extract(day from offer_starts_at-benefit_start)::int d from recovery_campaigns where user_id='${uid(6)}'`)).d,35,'card offer day35');
  check((await scalar(`select count(*)::int n from recovery_campaigns where user_id in ('${uid(3)}','${uid(4)}','${uid(5)}')`)).n,0,'consent admin and active paid excluded');

  const req=uid(2);
  const offer=(await scalar(`select reserve_recovery_offer('${uid(1)}','${req}') r`)).r;
  check(offer.outcome,'reserved','eligible account can reserve offer');
  check((await scalar(`select claim_recovery_checkout('${offer.campaign_id}') ok`)).ok,true,'single provider creator');
  check((await scalar(`select claim_recovery_checkout('${offer.campaign_id}') ok`)).ok,false,'duplicate provider creator blocked');
  await db.exec(`select bind_recovery_checkout('${offer.campaign_id}','prod-provider-fixture','https://www.mercadopago.com.br/subscriptions/checkout?fixture=1');`);
  const paid=(await scalar(`select record_recovery_payment('prod-provider-fixture','prod-invoice',9.90,now()) r`)).r;
  check(paid.outcome,'converted','canonical R$9.90 converts production campaign');
  check((await scalar(`select record_recovery_payment('prod-provider-fixture','prod-invoice',9.90,now()) r`)).r.outcome,'duplicate','payment replay idempotent');
  await db.exec(`select update_recovery_provider_state('prod-provider-fixture','reset');`);
  check((await scalar(`select price_reset_at is not null ok from recovery_campaigns where user_id='${uid(1)}'`)).ok,true,'R$14.90 reset confirmation recorded');
  check((await scalar(`select has_function_privilege('authenticated','reserve_recovery_offer(uuid,uuid)','execute') ok`)).ok,false,'browser cannot forge another recovery account');
  check((await scalar(`select has_function_privilege('authenticated','get_my_recovery_offer()','execute') ok`)).ok,true,'own offer RPC available');
  check((await scalar(`select has_table_privilege('service_role','recovery_campaigns','SELECT') ok`)).ok,false,'tables remain backend-only');
  check((await scalar(`select dispatch_recovery_worker() r`)).r.outcome,'requested','production dispatcher validates exact project URL');
  console.log(`PASS recovery PROD SQL: ${passed} assertions; no network or recipients.`);
}catch(error){console.error(error.message,error.internalQuery||'');process.exitCode=1;}finally{await db.close()}
