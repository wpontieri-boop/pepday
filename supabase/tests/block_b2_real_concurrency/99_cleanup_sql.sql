-- Remove somente a execução que possui o marcador inequívoco deste pacote.
do $$ begin
  if not exists(select 1 from public.local_data_imports
    where id='a2600000-0000-4000-8000-000000000001'
      and user_id='f2600000-0000-4000-8000-000000000001'
      and source_hash=repeat('c',64) and source_version='b2.1-concurrency'
      and source_snapshot->>'fixture'='pepday-b2.1-real-concurrency'
      and source_snapshot->>'package_version'='v2'
      and source_snapshot->>'run_marker'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'CLEANUP RECUSADO: marcador desta execução ausente ou divergente';
  end if;
  if not exists(select 1 from auth.users
    where id='f2600000-0000-4000-8000-000000000001'
      and email='pepday-b2-sql-concurrency@example.invalid') then
    raise exception 'CLEANUP RECUSADO: identidade fixture ausente ou divergente';
  end if;
end $$;

begin;
delete from public.vial_movements where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.applications where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.routine_versions where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.routines where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.vials where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.legacy_import_records where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.local_data_imports where user_id='f2600000-0000-4000-8000-000000000001';
delete from public.audit_logs where user_id='f2600000-0000-4000-8000-000000000001';
delete from auth.users where id='f2600000-0000-4000-8000-000000000001'
  and email='pepday-b2-sql-concurrency@example.invalid';
commit;

select set_config('pepday.b2.auth_internal_remaining','0',false);
do $$ declare n bigint:=0; c bigint; ids text[]:=array['f2600000-0000-4000-8000-000000000001']; begin
  if to_regclass('auth.identities') is not null then
    execute 'select count(*) from auth.identities where user_id::text=any($1)' into c using ids; n:=n+c;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'select count(*) from auth.sessions where user_id::text=any($1)' into c using ids; n:=n+c;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'select count(*) from auth.refresh_tokens where user_id::text=any($1)' into c using ids; n:=n+c;
  end if;
  perform set_config('pepday.b2.auth_internal_remaining',n::text,false);
end $$;

with fixture_users(id) as (values ('f2600000-0000-4000-8000-000000000001'::uuid)), remaining as (
  select count(*)::bigint n from auth.users where id in (select id from fixture_users)
  union all select count(*) from public.profiles where id in (select id from fixture_users)
  union all select count(*) from public.subscriptions where user_id in (select id from fixture_users)
  union all select count(*) from public.trials where user_id in (select id from fixture_users)
  union all select count(*) from public.settings where user_id in (select id from fixture_users)
  union all select count(*) from public.vials where user_id in (select id from fixture_users)
  union all select count(*) from public.routines where user_id in (select id from fixture_users)
  union all select count(*) from public.routine_versions where user_id in (select id from fixture_users)
  union all select count(*) from public.applications where user_id in (select id from fixture_users)
  union all select count(*) from public.vial_movements where user_id in (select id from fixture_users)
  union all select count(*) from public.local_data_imports where user_id in (select id from fixture_users)
  union all select count(*) from public.legacy_import_records where user_id in (select id from fixture_users)
  union all select count(*) from public.audit_logs where user_id in (select id from fixture_users)
), totals as (
  select coalesce(sum(n),0)::bigint domain_remaining,
    current_setting('pepday.b2.auth_internal_remaining')::bigint auth_internal_remaining from remaining
)
select domain_remaining,auth_internal_remaining,
  domain_remaining+auth_internal_remaining total_fixtures,
  case when domain_remaining+auth_internal_remaining=0 then 'PASS — LIMPEZA CONFIRMADA'
    else 'FAIL — FIXTURES REMANESCENTES' end resultado from totals;
