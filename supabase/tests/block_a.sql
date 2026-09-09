-- Executar depois da migração SOMENTE em banco de testes. Tudo sofre rollback.
-- Este arquivo ainda precisa ser executado em PostgreSQL/Supabase.
begin;
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pepday-test-a@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pepday-test-b@example.invalid');

update public.profiles set role='admin' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.subscriptions set access_override='admin' where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.vials(user_id,name,initial_mg,remaining_mg,water_ml,prepared_on)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture A',10,10,2,current_date),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fixture B',10,10,2,current_date);

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$ begin
  if (select count(*) from public.profiles)<>1 then raise exception 'FAIL profiles RLS'; end if;
  if (select count(*) from public.vials)<>1 then raise exception 'FAIL vials RLS'; end if;
  if (public.get_entitlement()->>'pro')::boolean then raise exception 'FAIL automatic PRO'; end if;
  begin
    update public.profiles set role='admin';
    raise exception 'FAIL self promotion';
  exception when insufficient_privilege then null; end;
  begin
    update public.trials set trial_used=false;
    raise exception 'FAIL writable trial';
  exception when insufficient_privilege then null; end;
  begin
    update public.subscriptions set access_override='admin';
    raise exception 'FAIL writable subscription';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.applications;
    raise exception 'FAIL mutable history';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.audit_logs;
    raise exception 'FAIL exposed audit';
  exception when insufficient_privilege then null; end;
end $$;
select public.complete_onboarding('Pessoa de teste','BR','America/Sao_Paulo',true,'test','test',false);
do $$ declare first_id uuid; repeated_id uuid; begin
  first_id:=public.stage_local_import(repeat('a',64),'{"sourceVersion":"2.9","raw":{}}'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  repeated_id:=public.stage_local_import(repeat('a',64),'{"sourceVersion":"2.9","raw":{}}'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if first_id is distinct from repeated_id then raise exception 'FAIL duplicate import'; end if;
  begin
    perform public.stage_local_import(repeat('b',64),'{}'::jsonb,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'FAIL import account switch';
  exception when raise_exception then
    if SQLERRM<>'Conta alterada durante a importação' then raise; end if;
  end;
end $$;
select public.start_trial();
do $$ declare a timestamptz; b timestamptz; begin
  select ends_at into a from public.trials;
  perform public.start_trial();
  select ends_at into b from public.trials;
  if a is distinct from b or a is null then raise exception 'FAIL trial reset'; end if;
  if not (public.get_entitlement()->>'pro')::boolean then raise exception 'FAIL trial activation'; end if;
end $$;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$ begin
  if (select count(*) from public.vials)<>1 then raise exception 'FAIL admin private access'; end if;
  if exists(select 1 from public.profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'FAIL cross-account profile'; end if;
  if public.get_entitlement()->>'source'<>'admin' then raise exception 'FAIL admin entitlement'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin
    perform * from public.vials;
    raise exception 'FAIL anonymous access';
  exception when insufficient_privilege then null; end;
  begin
    perform public.start_trial();
    raise exception 'FAIL anonymous trial';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
