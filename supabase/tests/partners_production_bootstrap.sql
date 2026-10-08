-- Synthetic Auth IDs only, no signup/login/email. Append assertions and ROLLBACK.
begin;
do $$declare u uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://oslefjmwfnddxlotalxu.supabase.co') then raise exception 'PROD_ONLY';end if;
 insert into auth.users(id) values(u);
 update public.profiles set role='admin' where id=u;
 -- The unique active OWNER rule is preserved. This uncommitted change is
 -- invisible to other sessions and restored by each suite's ROLLBACK.
 update public.admin_memberships set active=false where access_level='owner' and active;
 insert into public.admin_memberships(user_id,access_level,active,password_configured) values(u,'owner',true,true);
 insert into auth.sessions(id,user_id,created_at) values(sid,u,now());
 insert into auth.mfa_factors(id,user_id,status,factor_type,created_at,updated_at) values(gen_random_uuid(),u,'verified','totp',now(),now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'aal','aal2','iss','https://oslefjmwfnddxlotalxu.supabase.co/auth/v1','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
end $$;
update public.partner_config set enabled=true;
