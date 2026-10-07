-- Real TEST schema only. Existing OWNER is used inside rollback; no Auth signup,
-- credential, benefit, billing or outbound message is created or modified.
begin;
do $$declare u uuid;begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'TEST_ONLY';end if;
  select m.user_id into strict u from public.admin_memberships m where m.active and m.access_level='owner'
    and exists(select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified' and f.factor_type='totp') limit 1;
  insert into auth.sessions(id,user_id,created_at) values('10000000-0000-4000-8000-000000000002',u,now());
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id','10000000-0000-4000-8000-000000000002','aal','aal2','iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
end $$;
update public.partner_config set enabled=true;
-- Append partners_p1_assertions.sql; its final ROLLBACK removes every fixture.
