-- COPIAR PARA FORA DO REPOSITÓRIO e substituir os dois placeholders pelos UUIDs
-- exibidos pelo runner. Executar somente em pepday-v3-test.
select set_config('pepday.b2.jwt_a','REPLACE_WITH_USER_A_UUID',false);
select set_config('pepday.b2.jwt_b','REPLACE_WITH_USER_B_UUID',false);

do $$ declare a text:=current_setting('pepday.b2.jwt_a'); b text:=current_setting('pepday.b2.jwt_b'); begin
  if a like 'REPLACE_%' or b like 'REPLACE_%' or a=b then raise exception 'PREFLIGHT JWT: IDs ausentes ou iguais'; end if;
  if not exists(select 1 from auth.users where id=a::uuid and email='pepday-b2-jwt-a@example.invalid')
    or not exists(select 1 from auth.users where id=b::uuid and email='pepday-b2-jwt-b@example.invalid') then
    raise exception 'PREFLIGHT JWT: contas/e-mails fixtures não conferem';
  end if;
  if exists(select 1 from public.vials where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.routines where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.routine_versions where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.applications where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.vial_movements where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.local_data_imports where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.legacy_import_records where user_id in (a::uuid,b::uuid))
    or exists(select 1 from public.vials where id in ('e2640000-0000-4000-8000-000000000004','e2650000-0000-4000-8000-000000000005'))
    or exists(select 1 from public.routines where id in ('d2640000-0000-4000-8000-000000000004','d2650000-0000-4000-8000-000000000005'))
    or exists(select 1 from public.routine_versions where id in ('c2640000-0000-4000-8000-000000000004','c2650000-0000-4000-8000-000000000005'))
    or exists(select 1 from public.applications where operation_id in (
      'b2640000-0000-4000-8000-000000000001','b2640000-0000-4000-8000-000000000002',
      'b2640000-0000-4000-8000-000000000003','b2650000-0000-4000-8000-000000000001',
      'b2650000-0000-4000-8000-000000000002') or undo_operation_id in (
      'b2640000-0000-4000-8000-000000000001','b2640000-0000-4000-8000-000000000002',
      'b2640000-0000-4000-8000-000000000003','b2650000-0000-4000-8000-000000000001',
      'b2650000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.vial_movements where operation_id in (
      'b2640000-0000-4000-8000-000000000001','b2640000-0000-4000-8000-000000000002',
      'b2640000-0000-4000-8000-000000000003','b2650000-0000-4000-8000-000000000001',
      'b2650000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.audit_logs where operation_id in (
      'b2640000-0000-4000-8000-000000000001','b2640000-0000-4000-8000-000000000002',
      'b2640000-0000-4000-8000-000000000003','b2650000-0000-4000-8000-000000000001',
      'b2650000-0000-4000-8000-000000000002')) then
    raise exception 'PREFLIGHT JWT: UUID de domínio/operação reservado já existe';
  end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('pepday.b2.jwt_a'),false);
do $$ begin
  if coalesce((public.get_entitlement()->>'pro')::boolean,false) is not true then raise exception 'PREFLIGHT JWT: conta A sem TRIAL/PRO'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('pepday.b2.jwt_b'),false);
do $$ begin
  if coalesce((public.get_entitlement()->>'pro')::boolean,false) is not true then raise exception 'PREFLIGHT JWT: conta B sem TRIAL/PRO'; end if;
end $$;

begin;
insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on) values
  ('e2640000-0000-4000-8000-000000000004',current_setting('pepday.b2.jwt_a')::uuid,'B2 JWT RLS',10,10,2,current_date),
  ('e2650000-0000-4000-8000-000000000005',current_setting('pepday.b2.jwt_a')::uuid,'B2 JWT replay undo',10,10,2,current_date);
insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,frequency,start_date) values
  ('d2640000-0000-4000-8000-000000000004',current_setting('pepday.b2.jwt_a')::uuid,'e2640000-0000-4000-8000-000000000004','B2 JWT RLS',1,'mg',100,'daily',current_date),
  ('d2650000-0000-4000-8000-000000000005',current_setting('pepday.b2.jwt_a')::uuid,'e2650000-0000-4000-8000-000000000005','B2 JWT replay undo',1,'mg',100,'daily',current_date);
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select x.version_id,r.user_id,r.id,1,to_jsonb(r) from public.routines r join (values
  ('d2640000-0000-4000-8000-000000000004'::uuid,'c2640000-0000-4000-8000-000000000004'::uuid),
  ('d2650000-0000-4000-8000-000000000005'::uuid,'c2650000-0000-4000-8000-000000000005'::uuid)
) x(routine_id,version_id) on x.routine_id=r.id
where r.user_id=current_setting('pepday.b2.jwt_a')::uuid;
commit;
select 'PASS — SETUP JWT' as resultado,current_setting('pepday.b2.jwt_a')::uuid as user_a,current_setting('pepday.b2.jwt_b')::uuid as user_b;
