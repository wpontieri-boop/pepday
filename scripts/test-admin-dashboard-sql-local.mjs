// PostgreSQL local (PGlite). Sem rede, contas reais, envio ou alteração de PROD/TEST.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw new Error('Defina PGLITE_MODULE para o dist/index.js do runtime PGlite local.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const db=new PGlite();
try{
  await db.exec(`create role anon;create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table public.profiles(id uuid primary key,role text,created_at timestamptz default now());
    create table public.admin_memberships(user_id uuid primary key,access_level text,active boolean,password_configured boolean);
    create table public.settings(user_id uuid primary key,marketing_opt_in boolean);
    create table public.trials(user_id uuid primary key,trial_used boolean,started_at timestamptz,ends_at timestamptz);
    create table public.subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid unique,
      provider text,status text,plan text,started_at timestamptz,current_period_end timestamptz,grace_until timestamptz,
      billing_status text,cancel_at_period_end boolean);
    create table public.card_pro_grants(id uuid primary key default gen_random_uuid(),user_id uuid unique,
      granted_at timestamptz,starts_at timestamptz,ends_at timestamptz,first_used_at timestamptz);
    create table public.promo_redemptions(user_id uuid,starts_at timestamptz,ends_at timestamptz);
    create table public.acquisition_attributions(user_id uuid unique,source text,medium text,campaign text,attributed_at timestamptz);
    create table public.billing_events(subscription_id uuid,provider_resource_id text,event_type text,effect text,outcome text,provider_event_at timestamptz);`);
  const team=await read('supabase/migrations/20261004230000_admin_team_roles_mfa.sql');
  const start=team.indexOf('create or replace function public.admin_assert_access');
  assert.ok(start>=0);
  await db.exec(team.slice(start,team.indexOf('end $$;',start)+7));
  let legacy=await read('supabase/migrations/20260929022500_fix_admin_lifecycle_marketing_column.sql');
  await db.exec(legacy.replaceAll('get_admin_acquisition_metrics','get_admin_acquisition_metrics_legacy'));
  const card=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  const cardStart=card.indexOf('create or replace function public.get_admin_card_campaign_metrics');
  await db.exec(card.slice(cardStart,card.indexOf('create or replace function public.export_my_data',cardStart))
    .replaceAll('get_admin_card_campaign_metrics','get_admin_card_campaign_metrics_legacy'));
  await db.exec(await read('supabase/migrations/20261005150845_admin_dashboard_lifecycle.sql'));
  // Permissões legadas iguais ao rollout; helpers privados não são RPCs públicas.
  await db.exec(`revoke all on function public.get_admin_acquisition_metrics_legacy(integer) from public,anon,authenticated;
    revoke all on function public.get_admin_card_campaign_metrics_legacy(integer) from public,anon,authenticated;
    insert into profiles values('00000000-0000-4000-8000-000000000001','admin',now());
    insert into admin_memberships values('00000000-0000-4000-8000-000000000001','owner',true,true);
    select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
    select set_config('request.jwt.claims','{"aal":"aal2"}',false);`);
  const uid=i=>`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  for(let i=1;i<=10;i++)await db.query('insert into profiles(id,role) values($1,$2)',[uid(i),'user']);
  // 1 FREE (inclusive sem linhas auxiliares), 2 trial, 3 cartão + trial sobreposto,
  // 4 promo + trial, 5 pago + cartão, 6 tolerância, 7 cartão expirado + trial expirado,
  // 8 trial expirado sem consentimento, 9 cartão expirado sem consentimento, 10 promo futuro.
  await db.exec(`insert into trials values
    ('${uid(2)}',true,now()-interval '6 days',now()+interval '1 day'),
    ('${uid(3)}',true,now()-interval '1 day',now()+interval '6 days'),
    ('${uid(4)}',true,now()-interval '1 day',now()+interval '6 days'),
    ('${uid(7)}',true,now()-interval '40 days',now()-interval '33 days'),
    ('${uid(8)}',true,now()-interval '10 days',now()-interval '3 days');
    insert into card_pro_grants(user_id,granted_at,starts_at,ends_at,first_used_at) values
    ('${uid(3)}',now()-interval '28 days',now()-interval '28 days',now()+interval '2 days',now()),
    ('${uid(5)}',now()-interval '40 days',now()-interval '40 days',now()+interval '1 day',now()),
    ('${uid(7)}',now()-interval '35 days',now()-interval '35 days',now()-interval '5 days',null),
    ('${uid(9)}',now()-interval '32 days',now()-interval '32 days',now()-interval '2 days',null);
    insert into promo_redemptions values
    ('${uid(4)}',now()-interval '1 day',now()+interval '30 days'),
    ('${uid(4)}',now()-interval '2 days',now()+interval '29 days'),
    ('${uid(10)}',now()+interval '1 day',now()+interval '31 days');
    insert into subscriptions(user_id,provider,status,plan,started_at,current_period_end,grace_until,billing_status,cancel_at_period_end) values
    ('${uid(5)}','mercado_pago','pro_active','annual',now()-interval '5 days',now()+interval '365 days',null,'active',true),
    ('${uid(6)}','mercado_pago','pro_active','monthly',now()-interval '40 days',now()-interval '1 day',now()+interval '2 days','grace',false);
    insert into settings values('${uid(7)}',true),('${uid(8)}',false),('${uid(9)}',null);
    insert into acquisition_attributions values
    ('${uid(3)}','card','qr','cartao-v1',now()-interval '28 days'),
    ('${uid(5)}','card','qr','cartao-v1',now()-interval '40 days');
    insert into billing_events select id,'same-invoice','subscription_authorized_payment','payment_approved','applied',now() from subscriptions where user_id='${uid(5)}';
    insert into billing_events select id,'same-invoice','subscription_authorized_payment','payment_approved','applied',now() from subscriptions where user_id='${uid(5)}';`);
  const metric=async days=>(await db.query('select get_admin_acquisition_metrics($1) m',[days])).rows[0].m;
  const m=await metric(30);
  for(const [key,value] of Object.entries({total_users_now:10,free_now:5,trial_active_now:1,
    card_active_now:1,promo_active_now:1,paid_active_now:2,trial_ending_3d_now:1,card_ending_3d_now:1,
    trial_expired_no_pro_now:1,card_expired_no_pro_now:2,recovery_eligible_now:1,
    recovery_card_eligible_now:1,recovery_trial_eligible_now:0,recovery_without_consent_now:2,
    grace_active_now:1,cancel_scheduled_now:1,approved_charges_in_window:1}))assert.equal(m[key],value,key);
  assert.equal(m.free_now+m.trial_active_now+m.card_active_now+m.promo_active_now+m.paid_active_now,m.total_users_now);
  assert.equal(m.revenue_available,false);console.log('PASS SQL: acesso exclusivo, sobreposições, expiração, consentimento, tolerância e cobranças únicas');
  for(const days of [7,90]){const other=await metric(days);assert.equal(other.free_now,m.free_now);assert.equal(other.recovery_eligible_now,m.recovery_eligible_now)}
  await assert.rejects(()=>metric(14));console.log('PASS SQL: base independente da janela e janela inválida rejeitada');
  const rates=async days=>(await db.query('select get_admin_card_campaign_metrics($1) m',[days])).rows[0].m;
  const rate=await rates(30);assert.equal(rate.cohort_paid,0);assert.equal(rate.grant_to_paid_percent,0);
  assert.equal(rate.qr_to_grant_percent,100);assert.equal(rate.grants_used,2);assert.equal(rate.grant_to_used_percent,100);
  const empty=await rates(7);assert.equal(empty.qr_to_grant_percent,null);assert.equal(empty.grant_to_paid_percent,null);
  console.log('PASS SQL: conversão de benefício antigo não distorce coorte recente; base vazia sem taxa');
  await db.exec(`select set_config('request.jwt.claims','{"aal":"aal1"}',false);`);
  await assert.rejects(()=>metric(30));
  await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false);
    update admin_memberships set access_level='viewer';`);
  assert.equal((await metric(30)).free_now,5);
  await db.exec('update admin_memberships set active=false');await assert.rejects(()=>rates(30));
  console.log('PASS SQL: AAL1/inativo negados; VIEWER AAL2 consulta');
  const grants=await db.query(`select has_function_privilege('anon','public.get_admin_acquisition_metrics(integer)','execute') anon,
    has_function_privilege('authenticated','public.get_admin_acquisition_metrics_legacy(integer)','execute') legacy`);
  assert.equal(grants.rows[0].anon,false);assert.equal(grants.rows[0].legacy,false);
  console.log('PASS SQL: RPC anon e acesso legado bloqueados');
}finally{await db.close()}
