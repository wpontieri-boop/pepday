-- COPIAR PARA FORA DO REPOSITÓRIO e substituir os dois placeholders.
select set_config('pepday.b2.jwt_a','REPLACE_WITH_USER_A_UUID',false);
select set_config('pepday.b2.jwt_b','REPLACE_WITH_USER_B_UUID',false);

do $$ declare a text:=current_setting('pepday.b2.jwt_a'); b text:=current_setting('pepday.b2.jwt_b'); begin
  if a like 'REPLACE_%' or b like 'REPLACE_%' or a=b then raise exception 'CLEANUP JWT: IDs ausentes ou iguais'; end if;
  if exists(select 1 from auth.users where id=a::uuid and email is distinct from 'pepday-b2-jwt-a@example.invalid')
    or exists(select 1 from auth.users where id=b::uuid and email is distinct from 'pepday-b2-jwt-b@example.invalid') then
    raise exception 'CLEANUP JWT ABORTADO: UUID possui e-mail inesperado';
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
), total as (select coalesce(sum(n),0)::bigint n from remaining)
select n as total_fixtures,case when n=0 then 'PASS — LIMPEZA JWT CONFIRMADA' else 'FAIL — FIXTURES JWT REMANESCENTES' end as resultado from total;
