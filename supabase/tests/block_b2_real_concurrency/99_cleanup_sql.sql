-- Remove somente a conta fixture SQL reservada e seus dados. Executar inteiro.
do $$ begin
  if exists(select 1 from auth.users where id='f2600000-0000-4000-8000-000000000001'
    and email is distinct from 'pepday-b2-sql-concurrency@example.invalid') then
    raise exception 'CLEANUP ABORTADO: UUID fixture possui e-mail inesperado';
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
), total as (select coalesce(sum(n),0)::bigint n from remaining)
select n as total_fixtures,case when n=0 then 'PASS — LIMPEZA CONFIRMADA' else 'FAIL — FIXTURES REMANESCENTES' end as resultado from total;
