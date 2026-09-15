-- B2.1 concorrência real / setup confirmado e temporário em pepday-v3-test.
-- Executar inteiro. Nenhuma linha preexistente é alterada.

do $$ begin
  if exists(select 1 from auth.users where id='f2600000-0000-4000-8000-000000000001')
    or exists(select 1 from public.vials where id in (
      'e2610000-0000-4000-8000-000000000001','e2620000-0000-4000-8000-000000000002',
      'e2630000-0000-4000-8000-000000000003'))
    or exists(select 1 from public.routines where id in (
      'd2610000-0000-4000-8000-000000000001','d2610000-0000-4000-8000-000000000002',
      'd2620000-0000-4000-8000-000000000001','d2630000-0000-4000-8000-000000000001'))
    or exists(select 1 from public.routine_versions where id in (
      'c2610000-0000-4000-8000-000000000001','c2610000-0000-4000-8000-000000000002',
      'c2620000-0000-4000-8000-000000000001','c2630000-0000-4000-8000-000000000001'))
    or exists(select 1 from public.applications where operation_id in (
      'b2610000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000002',
      'b2620000-0000-4000-8000-000000000001','b2630000-0000-4000-8000-000000000001',
      'b2630000-0000-4000-8000-000000000002') or undo_operation_id in (
      'b2610000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000002',
      'b2620000-0000-4000-8000-000000000001','b2630000-0000-4000-8000-000000000001',
      'b2630000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.vial_movements where operation_id in (
      'b2610000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000002',
      'b2620000-0000-4000-8000-000000000001','b2630000-0000-4000-8000-000000000001',
      'b2630000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.audit_logs where operation_id in (
      'b2610000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000002',
      'b2620000-0000-4000-8000-000000000001','b2630000-0000-4000-8000-000000000001',
      'b2630000-0000-4000-8000-000000000002')) then
    raise exception 'PREFLIGHT: UUID reservado B2.1 concorrência já existe';
  end if;
end $$;

begin;
insert into auth.users(id,email) values
  ('f2600000-0000-4000-8000-000000000001','pepday-b2-sql-concurrency@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('B2 concurrency SQL','BR','America/Sao_Paulo',true,
  'b2-concurrency','b2-concurrency',false);
reset role;

update public.subscriptions set status='pro_active',plan='monthly',
  started_at=statement_timestamp(),current_period_start=statement_timestamp(),
  current_period_end=statement_timestamp()+interval '1 day',updated_at=statement_timestamp()
where user_id='f2600000-0000-4000-8000-000000000001' and status='free';

do $$ begin
  if (select count(*) from public.subscriptions where
      user_id='f2600000-0000-4000-8000-000000000001' and status='pro_active')<>1 then
    raise exception 'SETUP: entitlement PRO fixture não preparado';
  end if;
end $$;

insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on) values
  ('e2610000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001','B2 concorrência mesmo frasco',10,10,2,current_date),
  ('e2620000-0000-4000-8000-000000000002','f2600000-0000-4000-8000-000000000001','B2 contenção FOR UPDATE',10,10,2,current_date),
  ('e2630000-0000-4000-8000-000000000003','f2600000-0000-4000-8000-000000000001','B2 corrida rotina data',10,10,2,current_date);

insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,frequency,start_date) values
  ('d2610000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001','e2610000-0000-4000-8000-000000000001','B2 mesmo frasco A',1,'mg',100,'daily',current_date),
  ('d2610000-0000-4000-8000-000000000002','f2600000-0000-4000-8000-000000000001','e2610000-0000-4000-8000-000000000001','B2 mesmo frasco B',1,'mg',100,'daily',current_date),
  ('d2620000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001','e2620000-0000-4000-8000-000000000002','B2 lock explícito',1,'mg',100,'daily',current_date),
  ('d2630000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001','e2630000-0000-4000-8000-000000000003','B2 mesma rotina data',1,'mg',100,'daily',current_date);

insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select x.version_id,r.user_id,r.id,1,to_jsonb(r)
from public.routines r join (values
  ('d2610000-0000-4000-8000-000000000001'::uuid,'c2610000-0000-4000-8000-000000000001'::uuid),
  ('d2610000-0000-4000-8000-000000000002'::uuid,'c2610000-0000-4000-8000-000000000002'::uuid),
  ('d2620000-0000-4000-8000-000000000001'::uuid,'c2620000-0000-4000-8000-000000000001'::uuid),
  ('d2630000-0000-4000-8000-000000000001'::uuid,'c2630000-0000-4000-8000-000000000001'::uuid)
) x(routine_id,version_id) on x.routine_id=r.id
where r.user_id='f2600000-0000-4000-8000-000000000001';
commit;

select 'PASS — SETUP SQL' as resultado;
