-- Synthetic SQL-only fixtures. No signup, login, e-mail, or existing QA accounts.
begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();u uuid;u2 uuid;sid uuid:=gen_random_uuid();attr uuid;row_data jsonb;old_token text;token text;second_token text;event uuid:=gen_random_uuid();n integer;scenario text;
begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'TEST_ONLY';end if;
 update public.partner_config set enabled=true,referral_enabled=false;
 row_data:=public.partner_referral_action('intent','missing');
 if row_data->'enabled'<>'false'::jsonb then raise exception 'gate default OFF';end if;
 update public.partner_config set referral_enabled=true;
 insert into public.partners(id,public_name,partner_type,city,slug,public_code,status)
 values(a,'P2 SQL Homônimo','loja','Cidade A','p2-'||a,upper(left(replace(a::text,'-',''),8)),'active'),
 (b,'P2 SQL Homônimo','loja','Cidade B','p2-'||b,upper(left(replace(b::text,'-',''),8)),'active');
 insert into public.partner_commission_rules(partner_id,version,commission_percent) values(a,1,16),(b,1,23);
 row_data:=public.partner_referral_action('intent','p2-'||a,'link','',false,event);token:=row_data->>'token';
 if length(token)<>64 or row_data->>'source'<>'link' then raise exception 'link intent';end if;
 if not exists(select 1 from public.partner_referral_intents where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and expires_at=created_at+interval '30 days') then raise exception 'hash/30d server';end if;
 if row_data->'partner' ?| array['email','document','pix_key','commission_percent','id'] then raise exception 'public privacy';end if;
 row_data:=public.partner_referral_action('intent','p2-'||a,'link',token,false,event);
 if row_data->>'token'<>token or (select clicks from public.partner_click_daily where partner_id=a)<>1 then raise exception 'reload/click retry';end if;
 row_data:=public.partner_referral_action('intent','p2-'||b,'manual',token);
 if row_data->>'code'<>'CONFIRM_SWAP_REQUIRED' or row_data ? 'token' then raise exception 'manual explicit swap confirmation';end if;
 row_data:=public.partner_referral_action('inspect','','link',token);
 if row_data->'partner'->>'city'<>'Cidade A' then raise exception 'cancel swap retains selection/homonym';end if;
 row_data:=public.partner_referral_action('intent','p2-'||b,'manual',token,true);old_token:=token;token:=row_data->>'token';
 if not exists(select 1 from public.partner_referral_intents where token_hash=encode(sha256(convert_to(old_token,'UTF8')),'hex') and superseded_reason='replaced') then raise exception 'confirmed replacement';end if;
 row_data:=public.partner_referral_action('intent',upper(left(replace(a::text,'-',''),8)),'code',token);token:=row_data->>'token';
 if row_data->>'source'<>'code' or row_data->'partner'->>'city'<>'Cidade A' then raise exception 'explicit code wins';end if;
 row_data:=public.partner_referral_action('intent','not-found','link',token);
 if row_data->>'code'<>'PARTNER_UNAVAILABLE' or row_data ? 'token' then raise exception 'invalid ref';end if;
 -- Onboarding delays attribution and consumption, with exact same capability afterwards.
 u:=gen_random_uuid();insert into auth.users(id) values(u);
 perform set_config('request.jwt.claim.sub',u::text,true);
 row_data:=public.claim_partner_card_acquisition(token);
 if row_data->'benefit'->>'code'<>'CARD_PRO_NEEDS_ONBOARDING' or (select count(*) from public.partner_attributions where user_id=u)<>0 then raise exception 'before onboarding';end if;
 update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),privacy_accepted_at=now(),sensitive_data_consent_at=now(),sensitive_data_consent_version='health-data-2026-09-30' where id=u;
 row_data:=public.claim_partner_card_acquisition(token);
 if row_data->'benefit'->>'code'<>'CARD_PRO_GRANTED' or row_data->>'partner_locked'<>'true' then raise exception 'activation';end if;
 if not exists(select 1 from public.partner_attributions x join public.card_pro_grants g on g.id=x.card_grant_id where x.user_id=u and x.partner_id=a and x.commission_percent=16 and x.rule_version=1 and g.ends_at=g.starts_at+interval '30 days') then raise exception 'atomic 30d snapshot';end if;
 row_data:=public.claim_partner_card_acquisition(token);
 if row_data->'benefit'->>'code'<>'CARD_PRO_ALREADY_GRANTED' or (select count(*) from public.partner_attributions where user_id=u)<>1 then raise exception 'retry';end if;
 second_token:=public.partner_referral_action('intent','p2-'||b,'link')->>'token';
 perform public.claim_partner_card_acquisition(second_token);
 if (select partner_id from public.partner_attributions where user_id=u)<>a then raise exception 'post activation changed partner';end if;
 begin update public.partner_attributions set commission_percent=99 where user_id=u;raise exception 'snapshot update accepted';exception when others then if sqlerrm<>'PARTNER_ATTRIBUTION_LOCKED' then raise;end if;end;
 -- Replay against another account never assigns a consumed intent.
 u2:=gen_random_uuid();insert into auth.users(id) values(u2);
 update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),privacy_accepted_at=now(),sensitive_data_consent_at=now(),sensitive_data_consent_version='health-data-2026-09-30' where id=u2;
 perform set_config('request.jwt.claim.sub',u2::text,true);row_data:=public.claim_partner_card_acquisition(token);
 if row_data->'benefit'->>'code'<>'CARD_PRO_GRANTED' or (select source from public.partner_attributions where user_id=u2)<>'none' then raise exception 'cross-account replay';end if;
 -- Each failure still grants the benefit, seals absence, and prevents a later referral.
 foreach scenario in array array['suspended','archived','expired','replaced','cleared','invalid','none','legacy','paid','admin'] loop
  update public.partners set status='active' where id=b;
  token:=public.partner_referral_action('intent','p2-'||b,'link')->>'token';
  if scenario in ('suspended','archived') then update public.partners set status=scenario where id=b;
  elsif scenario='expired' then update public.partner_referral_intents set created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
  elsif scenario='replaced' then perform public.partner_referral_action('intent','p2-'||a,'link',token);
  elsif scenario='cleared' then perform public.partner_referral_action('clear','','link',token);
  elsif scenario='invalid' then token:=repeat('0',64);
  elsif scenario='none' then token:=null;
  end if;
  u:=gen_random_uuid();insert into auth.users(id) values(u);
  update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),privacy_accepted_at=now(),sensitive_data_consent_at=now(),sensitive_data_consent_version='health-data-2026-09-30' where id=u;
  if scenario='paid' then update public.subscriptions set status='pro_active',provider='mercado_pago',current_period_end=now()+interval '10 days' where user_id=u;
  elsif scenario='admin' then update public.profiles set role='admin' where id=u;
  end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  row_data:=case when scenario='legacy' then public.claim_card_acquisition() else public.claim_partner_card_acquisition(token) end;
  if scenario in ('paid','admin') then
   if exists(select 1 from public.card_pro_grants where user_id=u) or exists(select 1 from public.partner_attributions where user_id=u) then raise exception 'eligibility changed %',scenario;end if;
  else
   if row_data->'benefit'->>'code'<>'CARD_PRO_GRANTED' or (select source from public.partner_attributions where user_id=u)<>'none' then raise exception 'sealed absence %',scenario;end if;
   update public.partners set status='active' where id=b;
   second_token:=public.partner_referral_action('intent','p2-'||b,'link')->>'token';perform public.claim_partner_card_acquisition(second_token);
   if (select partner_id from public.partner_attributions where user_id=u) is not null then raise exception 'retroactive assignment %',scenario;end if;
  end if;
 end loop;
 -- Manual origin without an explicit predecessor can be activated normally.
 update public.partners set status='active' where id=b;
 token:=public.partner_referral_action('intent','p2-'||b,'manual')->>'token';
 u:=gen_random_uuid();insert into auth.users(id) values(u);
 update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),privacy_accepted_at=now(),sensitive_data_consent_at=now(),sensitive_data_consent_version='health-data-2026-09-30' where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);perform public.claim_partner_card_acquisition(token);
 if (select source from public.partner_attributions where user_id=u)<>'manual' then raise exception 'manual activation';end if;
 row_data:=public.export_my_data()->'partner_attribution';
 if row_data->>'source' is distinct from 'manual' or row_data->'partner'->>'city' is distinct from 'Cidade B' then raise exception 'own attribution export';end if;
 if row_data::text ~ '"(token|token_hash|email|phone|pix_key|document|commission_percent|rule_id|intent_id)"' then raise exception 'export private partner data';end if;
 perform set_config('request.jwt.claim.sub',u2::text,true);row_data:=public.export_my_data()->'partner_attribution';
 if row_data->>'source' is distinct from 'none' or row_data->'partner' is distinct from 'null'::jsonb then raise exception 'export cross-account isolation';end if;
 select id into attr from public.partner_attributions where user_id=u2;
 delete from auth.users where id=u2;
 if not exists(select 1 from public.partner_attributions where id=attr and user_id is null and card_grant_id is null) then raise exception 'deletion anonymization';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 -- Aggregate metrics reuse active membership + fresh signed password/TOTP + server session.
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','aal','aal2')::text,true);
 begin perform public.admin_partner_referral_metrics();raise exception 'customer accessed metrics';exception when insufficient_privilege then null;end;
 update public.profiles set role='admin' where id=u;
 insert into public.admin_memberships(user_id,access_level,active,password_configured) values(u,'admin',true,true);
 insert into auth.sessions(id,user_id,created_at) values(sid,u,now());
 insert into auth.mfa_factors(id,user_id,status,factor_type,created_at,updated_at) values(gen_random_uuid(),u,'verified','totp',now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
 foreach scenario in array array['admin','viewer'] loop
  update public.admin_memberships set access_level=scenario where user_id=u;
  row_data:=public.admin_partner_referral_metrics();
  if (row_data->>'intents_consumed')::integer<2 or (row_data->>'benefits_with_partner')::integer<2 or (row_data->>'clicks')::integer<1 then raise exception 'metric counts';end if;
  if row_data::text ~ '"(token|token_hash|email|phone|pix_key|document|user_id|commission_percent)"' then raise exception 'metrics private data';end if;
 end loop;
 update public.admin_memberships set active=false where user_id=u;
 begin perform public.admin_partner_referral_metrics();raise exception 'inactive accessed metrics';exception when insufficient_privilege then null;end;
 update public.admin_memberships set active=true where user_id=u;
 update auth.sessions set created_at=now()-interval '9 hours' where id=sid;
 begin perform public.admin_partner_referral_metrics();raise exception 'expired session accessed metrics';exception when insufficient_privilege then null;end;
 -- Closed privilege boundary, all four tables, private helpers, no anonymous grant.
 foreach scenario in array array['partner_referral_intents','partner_attributions','partner_click_events','partner_click_daily'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||scenario)::regclass) then raise exception 'RLS %',scenario;end if;
  if has_table_privilege('authenticated','public.'||scenario,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon','public.'||scenario,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role','public.'||scenario,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'direct table privilege %',scenario;end if;
 end loop;
 if has_function_privilege('authenticated','public.partner_claim_card(timestamptz,text)','execute') or has_function_privilege('authenticated','public.claim_card_acquisition_core_p2(timestamptz)','execute') or has_function_privilege('anon','public.claim_partner_card_acquisition(text,timestamptz)','execute') or has_function_privilege('authenticated','public.partner_referral_action(text,text,text,text,boolean,uuid)','execute') then raise exception 'RPC boundary';end if;
end $$;
select 'PASS P2 SQL rollback: gate, link/code/manual, homonyms, confirmation, server expiry/hash, eligibility, snapshot, retry/replay, absence, legacy, RLS/grants' as result;
rollback;
