-- Minimal local schema fixtures. Kept separate from TEST real-schema smoke.
begin;
insert into profiles values('10000000-0000-4000-8000-000000000001','admin');
insert into admin_memberships values('10000000-0000-4000-8000-000000000001','owner',true,true);
insert into auth.sessions(id,user_id) values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
insert into auth.mfa_factors(user_id,status,factor_type) values('10000000-0000-4000-8000-000000000001','verified','totp');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001','session_id','10000000-0000-4000-8000-000000000002','aal','aal2','iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
update partner_config set enabled=true;
-- Assertions shared with TEST smoke are appended by the runner below.
