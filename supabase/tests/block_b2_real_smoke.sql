-- PepDay V3 / B2.1 — smoke seguro para o PostgreSQL real de pepday-v3-test.
-- Executar o arquivo inteiro em uma única aba do SQL Editor.
-- Cria somente fixtures com UUIDs reservados nesta transação e termina em ROLLBACK.
-- Não contém DELETE, não altera objetos globais e não modifica linhas preexistentes.

begin;

-- Primeiro erro controlado da suíte. Blocos seguintes não escrevem depois dele.
select set_config('pepday.b2_real_failure','',true);

-- UUIDs de usuários: FREE, TRIAL, PRO e segundo PRO para isolamento.
-- O preflight aborta antes da primeira escrita se qualquer fixture já existir.
do $$
begin
  if exists (
      select 1 from auth.users where id in (
        'f2100000-0000-4000-8000-000000000001',
        'f2200000-0000-4000-8000-000000000002',
        'f2300000-0000-4000-8000-000000000003',
        'f2400000-0000-4000-8000-000000000004'
      )
    ) or exists (
      select 1 from public.vials where id in (
        'e2100000-0000-4000-8000-000000000001',
        'e2300000-0000-4000-8000-000000000003'
      )
    ) or exists (
      select 1 from public.routines where id in (
        'd2100000-0000-4000-8000-000000000001',
        'd2300000-0000-4000-8000-000000000003'
      )
    ) or exists (
      select 1 from public.routine_versions where id in (
        'c2100000-0000-4000-8000-000000000001',
        'c2300000-0000-4000-8000-000000000003'
      )
    ) or exists (
      select 1 from public.local_data_imports
      where id='a2100000-0000-4000-8000-000000000001'
    ) or exists (
      select 1 from public.legacy_import_records
      where legacy_id='a2110000-0000-4000-8000-000000000001'
    ) or exists (
      select 1 from public.applications
      where operation_id in (
        'b2100000-0000-4000-8000-000000000001',
        'b2200000-0000-4000-8000-000000000001',
        'b2210000-0000-4000-8000-000000000001',
        'b2220000-0000-4000-8000-000000000001',
        'b2220000-0000-4000-8000-000000000002',
        'b2310000-0000-4000-8000-000000000001',
        'b2410000-0000-4000-8000-000000000001',
        'b2420000-0000-4000-8000-000000000001'
      ) or undo_operation_id in (
        'b2100000-0000-4000-8000-000000000001',
        'b2200000-0000-4000-8000-000000000001',
        'b2210000-0000-4000-8000-000000000001',
        'b2220000-0000-4000-8000-000000000001',
        'b2220000-0000-4000-8000-000000000002',
        'b2310000-0000-4000-8000-000000000001',
        'b2410000-0000-4000-8000-000000000001',
        'b2420000-0000-4000-8000-000000000001'
      )
    ) or exists (
      select 1 from public.vial_movements
      where operation_id in (
        'b2100000-0000-4000-8000-000000000001',
        'b2200000-0000-4000-8000-000000000001',
        'b2210000-0000-4000-8000-000000000001',
        'b2220000-0000-4000-8000-000000000001',
        'b2220000-0000-4000-8000-000000000002',
        'b2310000-0000-4000-8000-000000000001',
        'b2410000-0000-4000-8000-000000000001',
        'b2420000-0000-4000-8000-000000000001'
      )
    ) then
    perform set_config('pepday.b2_real_failure',
      'PREFLIGHT: um UUID literal reservado do smoke B2.1 já existe',true);
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',
    format('PREFLIGHT [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- Prova a capacidade do SQL Editor de assumir a role antes da primeira escrita.
-- Se esta etapa técnica falhar, nenhuma fixture ainda terá sido criada.
set local role authenticated;
reset role;

-- O trigger pepday_auth_created cria profiles/subscriptions/trials/settings
-- somente para estes quatro usuários recém-inseridos.
do $$ begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  insert into auth.users(id,email) values
    ('f2100000-0000-4000-8000-000000000001','b2-real-free@example.invalid'),
    ('f2200000-0000-4000-8000-000000000002','b2-real-trial@example.invalid'),
    ('f2300000-0000-4000-8000-000000000003','b2-real-pro@example.invalid'),
    ('f2400000-0000-4000-8000-000000000004','b2-real-other@example.invalid');
exception when others then
  perform set_config('pepday.b2_real_failure',format('SETUP USERS [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- Cadastro e início real do TRIAL apenas na conta fixture TRIAL.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2200000-0000-4000-8000-000000000002',true);
do $$ declare entitlement jsonb; begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  perform public.complete_onboarding('B2 real trial','BR','America/Sao_Paulo',true,
    'b2-real-smoke','b2-real-smoke',false);
  entitlement:=public.start_trial();
  if entitlement->>'status'<>'trial' or not (entitlement->>'pro')::boolean then
    raise exception 'FAIL: fixture TRIAL não recebeu entitlement';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('SETUP TRIAL [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- Completa somente as duas contas PRO fixtures.
select set_config('request.jwt.claim.sub','f2300000-0000-4000-8000-000000000003',true);
do $$ begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  perform public.complete_onboarding('B2 real pro','BR','America/Sao_Paulo',true,
    'b2-real-smoke','b2-real-smoke',false);
exception when others then
  perform set_config('pepday.b2_real_failure',format('SETUP PRO [%s]: %s',sqlstate,sqlerrm),true);
end $$;
select set_config('request.jwt.claim.sub','f2400000-0000-4000-8000-000000000004',true);
do $$ begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  perform public.complete_onboarding('B2 real other','BR','America/Sao_Paulo',true,
    'b2-real-smoke','b2-real-smoke',false);
exception when others then
  perform set_config('pepday.b2_real_failure',format('SETUP OTHER [%s]: %s',sqlstate,sqlerrm),true);
end $$;
reset role;

-- Estas são linhas criadas acima pelo trigger e identificadas pelos UUIDs novos.
-- Nenhuma assinatura preexistente satisfaz este predicado após o preflight.
do $$ begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  update public.subscriptions
    set status='pro_active',plan='monthly',started_at=statement_timestamp(),
      current_period_start=statement_timestamp(),
      current_period_end=statement_timestamp()+interval '1 day',updated_at=statement_timestamp()
    where user_id in (
      'f2300000-0000-4000-8000-000000000003',
      'f2400000-0000-4000-8000-000000000004'
    ) and status='free';
  if (select count(*) from public.subscriptions where status='pro_active' and user_id in (
      'f2300000-0000-4000-8000-000000000003',
      'f2400000-0000-4000-8000-000000000004'
    ))<>2 then
    raise exception 'FAIL: preparação das assinaturas PRO fixtures';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('SETUP ENTITLEMENT [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- Frasco TRIAL começa em 6 mg para representar saldo legado consolidado.
do $$ begin
if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on) values
  ('e2100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000002',
    'B2 real legado',10,6,2,current_date),
  ('e2300000-0000-4000-8000-000000000003','f2300000-0000-4000-8000-000000000003',
    'B2 real PRO',10,10,2,current_date);

insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,start_date) values
  ('d2100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000002',
    'e2100000-0000-4000-8000-000000000001','B2 real TRIAL',1,'mg',100,'daily',current_date),
  ('d2300000-0000-4000-8000-000000000003','f2300000-0000-4000-8000-000000000003',
    'e2300000-0000-4000-8000-000000000003','B2 real PRO',0.5,'mg',100,'daily',current_date);

insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select 'c2100000-0000-4000-8000-000000000001'::uuid,user_id,id,1,to_jsonb(r)
  from public.routines r
  where user_id='f2200000-0000-4000-8000-000000000002'
    and id='d2100000-0000-4000-8000-000000000001'
union all
select 'c2300000-0000-4000-8000-000000000003'::uuid,user_id,id,1,to_jsonb(r)
  from public.routines r
  where user_id='f2300000-0000-4000-8000-000000000003'
    and id='d2300000-0000-4000-8000-000000000003';

-- Âncora de legado: saldo consolidado + movimento import, sem aplicação fabricada.
insert into public.local_data_imports(id,user_id,source_hash,source_version,status,
  source_snapshot,verification,completed_at) values
  ('a2100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000002',
    repeat('b',64),'2.9','completed','{"smoke":"b2-real","raw":{}}',
    '{"history":"preserved_as_legacy"}',statement_timestamp());
insert into public.legacy_import_records(user_id,kind,legacy_id,target_id,import_id,source_record)
values
  ('f2200000-0000-4000-8000-000000000002','vial',
    'a2110000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000001',
    'a2100000-0000-4000-8000-000000000001','{"remainingMg":6,"history":[{"type":"dose"}]}');
insert into public.vial_movements(user_id,operation_id,vial_id,kind,delta_mg,
  balance_before,balance_after)
values
  ('f2200000-0000-4000-8000-000000000002','b2100000-0000-4000-8000-000000000001',
    'e2100000-0000-4000-8000-000000000001','import',6,0,6);
exception when others then
  perform set_config('pepday.b2_real_failure',format('SETUP DOMAIN [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- FREE é bloqueado antes de qualquer mutação, mesmo recebendo IDs de outro dono.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2100000-0000-4000-8000-000000000001',true);
do $$ declare blocked boolean:=false; entitlement jsonb; begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  entitlement:=public.get_entitlement();
  if entitlement->>'status'<>'free' or (entitlement->>'pro')::boolean then
    raise exception 'FAIL: fixture FREE com entitlement incorreto';
  end if;
  begin
    perform public.register_application('b2200000-0000-4000-8000-000000000001',auth.uid(),
      'd2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',
      'e2100000-0000-4000-8000-000000000001',current_date,null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: FREE conseguiu registrar aplicação'; end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('FREE [%s]: %s',sqlstate,sqlerrm),true);
end $$;
reset role;
do $$ begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  if exists(select 1 from public.applications
      where user_id='f2100000-0000-4000-8000-000000000001')
    or exists(select 1 from public.vial_movements
      where operation_id='b2200000-0000-4000-8000-000000000001')
    or (select remaining_mg from public.vials
      where id='e2100000-0000-4000-8000-000000000001')<>6 then
    raise exception 'FAIL: tentativa FREE alterou dados';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('FREE INTEGRITY [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- TRIAL: aplicação + movimento + saldo, replay, Undo, replay e segundo Undo.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2200000-0000-4000-8000-000000000002',true);
do $$
declare
  first_result jsonb; replay_result jsonb; undo_result jsonb; undo_replay jsonb;
  target_application_id uuid; blocked boolean:=false;
begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  first_result:=public.register_application(
    'b2210000-0000-4000-8000-000000000001',auth.uid(),
    'd2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',
    'e2100000-0000-4000-8000-000000000001',current_date,null);
  target_application_id:=(first_result->'application'->>'id')::uuid;
  if (first_result->>'replay')::boolean
    or (first_result->'application'->>'balance_before')::numeric<>6
    or (first_result->'application'->>'balance_after')::numeric<>5
    or (first_result->'movement'->>'delta_mg')::numeric<>-1
    or (select remaining_mg from public.vials
      where id='e2100000-0000-4000-8000-000000000001')<>5 then
    raise exception 'FAIL: aplicação TRIAL, movimento ou saldo';
  end if;

  replay_result:=public.register_application(
    'b2210000-0000-4000-8000-000000000001',auth.uid(),
    'd2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',
    'e2100000-0000-4000-8000-000000000001',current_date,null);
  if not (replay_result->>'replay')::boolean
    or replay_result->'application'<>first_result->'application'
    or replay_result->'movement'<>first_result->'movement'
    or (select count(*) from public.applications where operation_id=
      'b2210000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.vial_movements where operation_id=
      'b2210000-0000-4000-8000-000000000001')<>1 then
    raise exception 'FAIL: replay da aplicação não foi idempotente';
  end if;

  undo_result:=public.undo_application(
    'b2220000-0000-4000-8000-000000000001',auth.uid(),target_application_id,null);
  if (undo_result->>'replay')::boolean
    or (undo_result->'movement'->>'delta_mg')::numeric<>1
    or (undo_result->'movement'->>'balance_before')::numeric<>5
    or (undo_result->'movement'->>'balance_after')::numeric<>6
    or (select remaining_mg from public.vials
      where id='e2100000-0000-4000-8000-000000000001')<>6 then
    raise exception 'FAIL: Undo ou devolução de saldo';
  end if;

  undo_replay:=public.undo_application(
    'b2220000-0000-4000-8000-000000000001',auth.uid(),target_application_id,null);
  if not (undo_replay->>'replay')::boolean
    or undo_replay->'application'<>undo_result->'application'
    or undo_replay->'movement'<>undo_result->'movement'
    or (select count(*) from public.vial_movements vm
      where vm.application_id=target_application_id and vm.kind='undo')<>1 then
    raise exception 'FAIL: replay do Undo não foi idempotente';
  end if;

  begin
    perform public.undo_application(
      'b2220000-0000-4000-8000-000000000002',auth.uid(),target_application_id,null);
  exception when others then
    blocked:=sqlerrm like 'Aplicação já desfeita%';
  end;
  if not blocked then raise exception 'FAIL: segundo Undo foi aceito'; end if;

  if (select count(*) from public.applications
      where user_id=auth.uid() and vial_id='e2100000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.vial_movements
      where user_id=auth.uid() and vial_id='e2100000-0000-4000-8000-000000000001'
        and kind='import')<>1
    or (select count(*) from public.vial_movements
      where user_id=auth.uid() and vial_id='e2100000-0000-4000-8000-000000000001'
        and kind in ('application','undo'))<>2 then
    raise exception 'FAIL: legado foi reprocessado ou histórico divergiu';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('TRIAL/RPC [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- PRO ativo também pode registrar, usando apenas seus próprios IDs.
select set_config('request.jwt.claim.sub','f2300000-0000-4000-8000-000000000003',true);
do $$ declare result jsonb; entitlement jsonb; begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  entitlement:=public.get_entitlement();
  if entitlement->>'status'<>'pro_active' or not (entitlement->>'pro')::boolean then
    raise exception 'FAIL: fixture PRO com entitlement incorreto';
  end if;
  result:=public.register_application(
    'b2310000-0000-4000-8000-000000000001',auth.uid(),
    'd2300000-0000-4000-8000-000000000003','c2300000-0000-4000-8000-000000000003',
    'e2300000-0000-4000-8000-000000000003',current_date,null);
  if (result->>'replay')::boolean
    or (result->'application'->>'balance_before')::numeric<>10
    or (result->'application'->>'balance_after')::numeric<>9.5
    or (select remaining_mg from public.vials
      where id='e2300000-0000-4000-8000-000000000003')<>9.5 then
    raise exception 'FAIL: aplicação PRO ou saldo';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('PRO/RPC [%s]: %s',sqlstate,sqlerrm),true);
end $$;
reset role;

-- Guarda o ID gerado da aplicação TRIAL em configuração local, sem criar objeto.
do $$ declare target_id uuid; begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  select id into strict target_id from public.applications
    where user_id='f2200000-0000-4000-8000-000000000002'
      and operation_id='b2210000-0000-4000-8000-000000000001';
  perform set_config('pepday.b2_real_trial_application',target_id::text,true);
exception when others then
  perform set_config('pepday.b2_real_failure',format('ISOLATION SETUP [%s]: %s',sqlstate,sqlerrm),true);
end $$;

-- RLS real sob role authenticated + segundo usuário: nenhuma leitura cruzada.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2400000-0000-4000-8000-000000000004',true);
do $$ declare blocked_register boolean:=false; blocked_undo boolean:=false; begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  if (select count(*) from public.vials
      where user_id='f2200000-0000-4000-8000-000000000002')<>0
    or (select count(*) from public.applications
      where user_id='f2200000-0000-4000-8000-000000000002')<>0 then
    raise exception 'FAIL: RLS permitiu leitura cruzada';
  end if;
  begin
    perform public.register_application(
      'b2410000-0000-4000-8000-000000000001',auth.uid(),
      'd2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',
      'e2100000-0000-4000-8000-000000000001',current_date,null);
  exception when others then blocked_register:=sqlerrm='Rotina não encontrada'; end;
  begin
    perform public.undo_application(
      'b2420000-0000-4000-8000-000000000001',auth.uid(),
      current_setting('pepday.b2_real_trial_application')::uuid,null);
  exception when others then blocked_undo:=sqlerrm='Aplicação não encontrada'; end;
  if not blocked_register or not blocked_undo then
    raise exception 'FAIL: RPC permitiu acesso cruzado';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('ISOLATION [%s]: %s',sqlstate,sqlerrm),true);
end $$;
reset role;

-- Grants/RLS: authenticated executa RPC, mas não grava diretamente nas tabelas.
do $$ declare register_oid oid; undo_oid oid; begin
  if current_setting('pepday.b2_real_failure',true)<>'' then return; end if;
  select p.oid into register_oid from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='register_application';
  select p.oid into undo_oid from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='undo_application';
  if register_oid is null or undo_oid is null
    or pg_catalog.has_function_privilege('anon',register_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',undo_oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',register_oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',undo_oid,'EXECUTE')
    or pg_catalog.has_table_privilege('authenticated','public.vials','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('authenticated','public.routines','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('authenticated','public.routine_versions','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('authenticated','public.applications','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('authenticated','public.vial_movements','INSERT,UPDATE,DELETE') then
    raise exception 'FAIL: grants de RPC ou escrita direta';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('vials','routines','routine_versions','applications','vial_movements')
      and not c.relrowsecurity
  ) then
    raise exception 'FAIL: RLS desabilitada em tabela B2.1';
  end if;
exception when others then
  perform set_config('pepday.b2_real_failure',format('GRANTS/RLS [%s]: %s',sqlstate,sqlerrm),true);
end $$;

select case when current_setting('pepday.b2_real_failure',true)=''
  then 'PASS — B2.1 real smoke; a próxima instrução é ROLLBACK'
  else 'FAIL CONTROLADO — '||current_setting('pepday.b2_real_failure',true)
  end as resultado;

rollback;

-- Esta é deliberadamente a última consulta. Todos os totais devem ser zero.
with fixture_users(id) as (
  values
    ('f2100000-0000-4000-8000-000000000001'::uuid),
    ('f2200000-0000-4000-8000-000000000002'::uuid),
    ('f2300000-0000-4000-8000-000000000003'::uuid),
    ('f2400000-0000-4000-8000-000000000004'::uuid)
), remaining as (
  select 'auth.users'::text as objeto,count(*)::bigint as linhas
    from auth.users where id in (select id from fixture_users)
  union all select 'profiles',count(*) from public.profiles where id in (select id from fixture_users)
  union all select 'subscriptions',count(*) from public.subscriptions where user_id in (select id from fixture_users)
  union all select 'trials',count(*) from public.trials where user_id in (select id from fixture_users)
  union all select 'settings',count(*) from public.settings where user_id in (select id from fixture_users)
  union all select 'vials',count(*) from public.vials where user_id in (select id from fixture_users)
  union all select 'routines',count(*) from public.routines where user_id in (select id from fixture_users)
  union all select 'routine_versions',count(*) from public.routine_versions where user_id in (select id from fixture_users)
  union all select 'applications',count(*) from public.applications where user_id in (select id from fixture_users)
  union all select 'vial_movements',count(*) from public.vial_movements where user_id in (select id from fixture_users)
  union all select 'local_data_imports',count(*) from public.local_data_imports where user_id in (select id from fixture_users)
  union all select 'legacy_import_records',count(*) from public.legacy_import_records where user_id in (select id from fixture_users)
  union all select 'audit_logs',count(*) from public.audit_logs where user_id in (select id from fixture_users)
)
select objeto,linhas,
  case when linhas=0 then 'OK — rollback confirmado' else 'ATENÇÃO — fixture remanescente' end as verificacao
from remaining
union all
select 'TOTAL',sum(linhas),
  case when sum(linhas)=0 then 'PASS — nenhum UUID de fixture permaneceu'
    else 'FAIL — revisar antes de qualquer novo teste' end
from remaining
order by objeto;

-- RECUPERAÇÃO RESIDUAL — somente se o SQL Editor interromper o lote antes do
-- ROLLBACK acima por erro de parser/protocolo, perda de conexão ou falha da
-- própria ferramenta:
--   1. Na mesma sessão ainda aberta, execute isoladamente: ROLLBACK;
--   2. Execute novamente, isoladamente, a consulta iniciada por WITH fixture_users.
--   3. Não use DELETE/UPDATE de limpeza. Se a conexão tiver sido encerrada, o
--      PostgreSQL já reverteu a transação; a consulta deve confirmar TOTAL = 0.
