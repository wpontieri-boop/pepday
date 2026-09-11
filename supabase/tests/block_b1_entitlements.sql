-- Executar somente após a migration B1, em banco descartável/de testes. Rollback final.
begin;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','b1-free@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','b1-trial@example.invalid'),
 ('33333333-3333-4333-8333-333333333333','b1-pro@example.invalid'),
 ('44444444-4444-4444-8444-444444444444','b1-expired@example.invalid');

update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),terms_version='test',
  privacy_accepted_at=now(),privacy_version='test' where id in
  ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444');
update public.subscriptions set status='pro_active',plan='monthly',started_at=now()-interval '2 days',
  current_period_end=now()+interval '5 days' where user_id='33333333-3333-4333-8333-333333333333';
update public.subscriptions set status='pro_expired',plan='monthly',started_at=now()-interval '32 days',
  current_period_end=now()-interval '2 days' where user_id='44444444-4444-4444-8444-444444444444';
insert into public.vials(user_id,name,initial_mg,remaining_mg,water_ml,prepared_on)
 values('44444444-4444-4444-8444-444444444444','Preservado',10,8,2,current_date);

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare e jsonb; begin
  e:=public.get_entitlement();
  if e->>'status'<>'free' or (e->>'pro')::boolean or not (e->>'trial_available')::boolean
    then raise exception 'FAIL logged FREE'; end if;
end $$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare first jsonb; second jsonb; begin
  first:=public.start_trial(); second:=public.start_trial();
  if first->>'status'<>'trial' or not (first->>'pro')::boolean then raise exception 'FAIL start trial'; end if;
  if (first->>'ends_at')::timestamptz-(first->>'started_at')::timestamptz<>interval '7 days'
    then raise exception 'FAIL seven days'; end if;
  if first->>'started_at' is distinct from second->>'started_at'
    or first->>'ends_at' is distinct from second->>'ends_at' then raise exception 'FAIL idempotency'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.audit_logs where user_id='22222222-2222-4222-8222-222222222222'
    and action='trial_started')<>1 then raise exception 'FAIL duplicate audit'; end if;
end $$;
set local role authenticated;
-- Simula nova sessão/login da mesma conta: o prazo permanece no servidor.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare saved timestamptz; current_end timestamptz; begin
  select ends_at into saved from public.trials where user_id=auth.uid();
  current_end:=(public.get_entitlement()->>'ends_at')::timestamptz;
  if saved is distinct from current_end then raise exception 'FAIL relogin reset'; end if;
end $$;

reset role;
update public.trials set started_at=now()-interval '8 days',ends_at=now()-interval '1 day',
  completed_at=now(),updated_at=now() where user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare e jsonb; begin
  e:=public.get_entitlement();
  if e->>'status'<>'pro_expired' or (e->>'pro')::boolean or e->>'source'<>'trial'
    then raise exception 'FAIL expired trial'; end if;
end $$;

select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
  if public.get_entitlement()->>'status'<>'pro_active'
    or not (public.get_entitlement()->>'pro')::boolean then raise exception 'FAIL active PRO'; end if;
end $$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$ declare before_count integer; after_count integer; e jsonb; begin
  select count(*) into before_count from public.vials where user_id=auth.uid();
  e:=public.get_entitlement();
  select count(*) into after_count from public.vials where user_id=auth.uid();
  if e->>'status'<>'pro_expired' or (e->>'pro')::boolean then raise exception 'FAIL expired PRO'; end if;
  e:=public.start_trial();
  if e->>'status'<>'pro_expired' or (e->>'trial_available')::boolean
    or exists(select 1 from public.trials where user_id=auth.uid() and trial_used)
    then raise exception 'FAIL expired subscriber trial'; end if;
  if before_count<>1 or after_count<>before_count then raise exception 'FAIL data preservation'; end if;
end $$;
rollback;
