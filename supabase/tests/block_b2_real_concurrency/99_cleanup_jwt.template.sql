-- COPIAR PARA FORA DO REPOSITÓRIO e substituir os dois placeholders.
select set_config('pepday.b2.jwt_a','REPLACE_WITH_USER_A_UUID',false);
select set_config('pepday.b2.jwt_b','REPLACE_WITH_USER_B_UUID',false);
select set_config('pepday.b2.run_marker','REPLACE_WITH_RUN_MARKER_UUID',false);

do $$ declare a text:=current_setting('pepday.b2.jwt_a'); b text:=current_setting('pepday.b2.jwt_b');
  marker text:=current_setting('pepday.b2.run_marker'); begin
  if a like 'REPLACE_%' or b like 'REPLACE_%' or marker like 'REPLACE_%' or a=b
    or marker!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'CLEANUP JWT: IDs ou run marker ausentes/inválidos';
  end if;
  if not exists(select 1 from public.local_data_imports
    where id='a2640000-0000-4000-8000-000000000004' and user_id=a::uuid
      and source_hash=repeat('d',64) and source_version='b2.1-concurrency'
      and source_snapshot->>'fixture'='pepday-b2.1-real-concurrency'
      and source_snapshot->>'package_version'='v2'
      and source_snapshot->>'run_marker'=marker
      and source_snapshot->>'user_a'=a and source_snapshot->>'user_b'=b) then
    raise exception 'CLEANUP JWT RECUSADO: marcador desta execução ausente ou divergente';
  end if;
  if not exists(select 1 from auth.users where id=a::uuid and email='pepday-b2-jwt-a@example.invalid'
      and raw_user_meta_data->>'pepday_b2_run_marker'=marker)
    or not exists(select 1 from auth.users where id=b::uuid and email='pepday-b2-jwt-b@example.invalid'
      and raw_user_meta_data->>'pepday_b2_run_marker'=marker) then
    raise exception 'CLEANUP JWT RECUSADO: identidades fixtures ausentes ou divergentes';
  end if;
end $$;

begin;
delete from public.vial_movements where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.applications where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.routine_versions where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.routines where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.vials where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.legacy_import_records where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.local_data_imports where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from public.audit_logs where user_id in (current_setting('pepday.b2.jwt_a')::uuid,current_setting('pepday.b2.jwt_b')::uuid);
delete from auth.users where
  (id=current_setting('pepday.b2.jwt_a')::uuid and email='pepday-b2-jwt-a@example.invalid')
  or (id=current_setting('pepday.b2.jwt_b')::uuid and email='pepday-b2-jwt-b@example.invalid');
commit;

select set_config('pepday.b2.auth_internal_remaining','0',false);
do $$ declare n bigint:=0; c bigint; ids text[]:=array[current_setting('pepday.b2.jwt_a'),current_setting('pepday.b2.jwt_b')]; begin
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

with fixture_users(id) as (values
  (current_setting('pepday.b2.jwt_a')::uuid),(current_setting('pepday.b2.jwt_b')::uuid)
), remaining as (
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
  case when domain_remaining+auth_internal_remaining=0 then 'PASS — LIMPEZA JWT CONFIRMADA'
    else 'FAIL — FIXTURES JWT REMANESCENTES' end resultado from totals;
