-- SQL-only fixtures, no signup/e-mail/real account changes. Always rollback.
begin;
do $$
declare u uuid:=gen_random_uuid();none_u uuid:=gen_random_uuid();fresh_u uuid:=gen_random_uuid();p uuid:=gen_random_uuid();r jsonb;token text;before_state jsonb;
begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'TEST_ONLY';end if;
 insert into auth.users(id) values(u),(none_u),(fresh_u);
 update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),privacy_accepted_at=now(),sensitive_data_consent_at=now(),sensitive_data_consent_version='health-data-2026-09-30' where id in(u,none_u,fresh_u);
 insert into public.partners(id,public_name,partner_type,city,description,slug,public_code,status) values(p,'P2 lock SQL','campanha','Cidade QA','@qa','p2-lock-'||p,upper(left(replace(p::text,'-',''),8)),'active');
 insert into public.partner_commission_rules(partner_id,version,commission_percent) values(p,1,16);
 -- This gate update is transaction-local and rolled back. No live gate change.
 update public.partner_config set enabled=true,referral_enabled=true;
 token:=public.partner_referral_action('intent','p2-lock-'||p,'link')->>'token';
 perform set_config('request.jwt.claim.sub',u::text,true);perform public.claim_partner_card_acquisition(token);
 perform set_config('request.jwt.claim.sub',none_u::text,true);perform public.claim_card_acquisition();
 before_state:=jsonb_build_object('attrs',(select jsonb_agg(to_jsonb(a) order by id) from public.partner_attributions a),'grants',(select jsonb_agg(to_jsonb(g) order by id) from public.card_pro_grants g),'intents',(select jsonb_agg(to_jsonb(i) order by id) from public.partner_referral_intents i));
 if has_function_privilege('anon','public.get_my_partner_attribution()','EXECUTE') or has_function_privilege('service_role','public.get_my_partner_attribution()','EXECUTE') or not has_function_privilege('authenticated','public.get_my_partner_attribution()','EXECUTE') then raise exception 'RPC grants';end if;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claim.sub',u::text,true);r:=public.get_my_partner_attribution();
 if r<>jsonb_build_object('partner_locked',true,'partner',jsonb_build_object('public_name','P2 lock SQL','city','Cidade QA','description','@qa')) then raise exception 'own public projection';end if;
 perform set_config('request.jwt.claim.sub',none_u::text,true);r:=public.get_my_partner_attribution();
 if r<>'{"partner_locked":true,"partner":null}'::jsonb then raise exception 'sealed absence/cross account';end if;
 perform set_config('request.jwt.claim.sub',fresh_u::text,true);r:=public.get_my_partner_attribution();
 if r<>'{"partner_locked":false,"partner":null}'::jsonb then raise exception 'fresh account read must not claim';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.get_my_partner_attribution();raise exception 'missing uid accepted';exception when insufficient_privilege then null;end;
 perform set_config('role','anon',true);
 begin perform public.get_my_partner_attribution();raise exception 'anon accepted';exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 if before_state<>jsonb_build_object('attrs',(select jsonb_agg(to_jsonb(a) order by id) from public.partner_attributions a),'grants',(select jsonb_agg(to_jsonb(g) order by id) from public.card_pro_grants g),'intents',(select jsonb_agg(to_jsonb(i) order by id) from public.partner_referral_intents i)) then raise exception 'read mutated attribution/benefit/intent';end if;
 update public.partners set status='archived' where id=p;
 perform set_config('request.jwt.claim.sub',u::text,true);r:=public.get_my_partner_attribution();
 if r->'partner'->>'public_name'<>'P2 lock SQL' then raise exception 'original must survive partner status change';end if;
 if exists(select 1 from public.card_pro_grants where user_id=fresh_u) then raise exception 'read granted benefit';end if;
end $$;
rollback;
