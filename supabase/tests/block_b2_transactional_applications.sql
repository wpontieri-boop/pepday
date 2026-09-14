-- Executar somente após as migrations A, A4, B1 e B2.1, em banco descartável. Rollback final.
begin;

insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','b2-free@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','b2-trial@example.invalid'),
 ('33333333-3333-4333-8333-333333333333','b2-pro@example.invalid'),
 ('44444444-4444-4444-8444-444444444444','b2-expired@example.invalid'),
 ('55555555-5555-4555-8555-555555555555','b2-other@example.invalid');

update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),terms_version='test',
  privacy_accepted_at=now(),privacy_version='test';
update public.trials set trial_used=true,started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id='22222222-2222-4222-8222-222222222222';
update public.subscriptions set status='trial' where user_id='22222222-2222-4222-8222-222222222222';
update public.subscriptions set status='pro_active',plan='monthly',started_at=now()-interval '1 day',
  current_period_end=now()+interval '10 days' where user_id in
  ('33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555');
update public.subscriptions set status='pro_expired',plan='monthly',started_at=now()-interval '31 days',
  current_period_end=now()-interval '1 day' where user_id='44444444-4444-4444-8444-444444444444';

insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','22222222-2222-4222-8222-222222222222','Trial mg',10,10,2,current_date),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002','22222222-2222-4222-8222-222222222222','Insuficiente',10,.5,2,current_date),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003','22222222-2222-4222-8222-222222222222','Rollback',10,10,2,current_date),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004','22222222-2222-4222-8222-222222222222','Undo limite',10,10,2,current_date),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000005','22222222-2222-4222-8222-222222222222','Legado',10,6,2,current_date),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000006','33333333-3333-4333-8333-333333333333','PRO mcg',10,10,2,current_date);

insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,start_date) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Trial mg',1,'mg',100,'daily',current_date),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000002','Insuficiente',1,'mg',100,'daily',current_date),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000003','Rollback',1,'mg',100,'daily',current_date),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000004','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','Undo limite',1,'mg',100,'daily',current_date),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000005','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000005','Legado',1,'mg',100,'daily',current_date),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000006','33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-000000000006','PRO mcg',250,'mcg',100,'daily',current_date);

insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select ('cccccccc-cccc-4ccc-8ccc-'||right('000000000000'||row_number() over(order by r.id)::text,12))::uuid,
  r.user_id,r.id,1,to_jsonb(r) from public.routines r;

-- Âncora consolidada do legado: não cria aplicação nem reconstrói histórico antigo.
insert into public.local_data_imports(id,user_id,source_hash,source_version,status,source_snapshot,
  verification,completed_at) values
 ('dddddddd-dddd-4ddd-8ddd-000000000001','22222222-2222-4222-8222-222222222222',repeat('a',64),
  '2.9','completed','{"sourceVersion":"2.9","raw":{}}',
  '{"history":"preserved_as_legacy"}',now());
insert into public.legacy_import_records(user_id,kind,legacy_id,target_id,import_id,source_record) values
 ('22222222-2222-4222-8222-222222222222','vial','eeeeeeee-eeee-4eee-8eee-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-000000000005','dddddddd-dddd-4ddd-8ddd-000000000001',
  '{"id":"eeeeeeee-eeee-4eee-8eee-000000000001","remainingMg":6,"history":[{"type":"dose"}]}'),
 ('22222222-2222-4222-8222-222222222222','routine','eeeeeeee-eeee-4eee-8eee-000000000002',
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000005','dddddddd-dddd-4ddd-8ddd-000000000001',
  '{"id":"eeeeeeee-eeee-4eee-8eee-000000000002","done":["2026-09-01"],"doseHistory":[{}]}');
insert into public.vial_movements(user_id,operation_id,vial_id,kind,delta_mg,balance_before,balance_after)
values('22222222-2222-4222-8222-222222222222','ffffffff-ffff-4fff-8fff-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-000000000005','import',6,0,6);

set local role authenticated;

-- FREE e PRO expirado são recusados antes de qualquer mutação.
do $$ declare blocked boolean:=false; begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  begin
    perform public.register_application('10000000-0000-4000-8000-000000000001',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-14',null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL FREE allowed'; end if;
  blocked:=false;
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
  begin
    perform public.register_application('10000000-0000-4000-8000-000000000002',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-14',null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL expired PRO allowed'; end if;
end $$;

-- TRIAL: mg, cálculos, movimento, replay, horário estável e conflitos.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare first jsonb; replay jsonb; applied timestamptz; before_count integer; conflict boolean; begin
  first:=public.register_application('20000000-0000-4000-8000-000000000001',auth.uid(),
    'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-14',null);
  if (first->>'replay')::boolean or first->'application'->>'dose_value'<>'1'
    or first->'application'->>'dose_unit'<>'mg'
    or (first->'application'->>'dose_mg')::numeric<>1
    or (first->'application'->>'concentration')::numeric<>5
    or (first->'application'->>'volume_ml')::numeric<>.2
    or (first->'application'->>'ui')::numeric<>20
    or (first->'application'->>'balance_before')::numeric<>10
    or (first->'application'->>'balance_after')::numeric<>9
    or first->'movement'->>'kind'<>'application'
    or (first->'movement'->>'delta_mg')::numeric<>-1
    or first->'movement'->>'operation_id'<>first->'application'->>'operation_id'
    or first->'movement'->>'application_id'<>first->'application'->>'id'
    then raise exception 'FAIL valid mg application'; end if;
  applied:=(first->'application'->>'applied_at')::timestamptz;
  select count(*) into before_count from public.applications where user_id=auth.uid();
  replay:=public.register_application('20000000-0000-4000-8000-000000000001',auth.uid(),
    'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-14',null);
  if not (replay->>'replay')::boolean or (replay->'application'->>'applied_at')::timestamptz<>applied
    or replay->'application'<>first->'application' or replay->'movement'<>first->'movement'
    or replay->'vial'<>first->'vial'
    or (select count(*) from public.applications where user_id=auth.uid())<>before_count
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001')<>9
    then raise exception 'FAIL application replay'; end if;
  conflict:=false;
  begin
    perform public.register_application('20000000-0000-4000-8000-000000000001',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-15',null);
  exception when others then conflict:=sqlerrm like 'UUID de operação reutilizado%'; end;
  if not conflict then raise exception 'FAIL reused UUID conflict'; end if;
  conflict:=false;
  begin
    perform public.register_application('20000000-0000-4000-8000-000000000002',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-14',null);
  exception when others then conflict:=sqlerrm like 'Já existe aplicação ativa%'; end;
  if not conflict or (select count(*) from public.applications where user_id=auth.uid()
    and routine_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' and scheduled_date='2026-09-14')<>1
    then raise exception 'FAIL active day conflict'; end if;
end $$;

-- Saldo insuficiente: aplicação, movimento e saldo permanecem intactos.
do $$ declare failed boolean:=false; begin
  begin
    perform public.register_application('20000000-0000-4000-8000-000000000003',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000002','cccccccc-cccc-4ccc-8ccc-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',date '2026-09-14',null);
  exception when others then failed:=sqlerrm='Saldo insuficiente'; end;
  if not failed
    or exists(select 1 from public.applications where user_id=auth.uid() and operation_id='20000000-0000-4000-8000-000000000003')
    or exists(select 1 from public.vial_movements where user_id=auth.uid() and operation_id='20000000-0000-4000-8000-000000000003')
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000002')<>.5
    then raise exception 'FAIL insufficient balance rollback'; end if;
end $$;

-- Isolamento: outro usuário PRO não consegue usar IDs pertencentes ao TRIAL.
do $$ declare blocked boolean:=false; switched boolean:=false; begin
  perform set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
  begin
    perform public.register_application('50000000-0000-4000-8000-000000000002',
      '22222222-2222-4222-8222-222222222222',
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-16',null);
  exception when others then switched:=sqlerrm='Conta alterada durante a operação'; end;
  begin
    perform public.register_application('50000000-0000-4000-8000-000000000001',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',date '2026-09-16',null);
  exception when others then blocked:=sqlerrm='Rotina não encontrada'; end;
  if not switched or not blocked
    or (select count(*) from public.vials)<>0 then raise exception 'FAIL cross-user RPC/RLS'; end if;
end $$;

-- PRO ativo: conversão de mcg e snapshot antigo preservado após edição.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ declare result jsonb; begin
  result:=public.register_application('30000000-0000-4000-8000-000000000001',auth.uid(),
    'bbbbbbbb-bbbb-4bbb-8bbb-000000000006','cccccccc-cccc-4ccc-8ccc-000000000006',
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',date '2026-09-14',null);
  if (result->'application'->>'dose_value')::numeric<>250
    or result->'application'->>'dose_unit'<>'mcg'
    or (result->'application'->>'dose_mg')::numeric<>.25
    or (result->'application'->>'concentration')::numeric<>5
    or (result->'application'->>'volume_ml')::numeric<>.05
    or (result->'application'->>'ui')::numeric<>5
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000006')<>9.75
    then raise exception 'FAIL active PRO mcg application'; end if;
end $$;

reset role;
update public.routines set dose_value=500,dose_unit='mcg',version=2,updated_at=now()
  where id='bbbbbbbb-bbbb-4bbb-8bbb-000000000006';
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select 'cccccccc-cccc-4ccc-8ccc-000000000016',user_id,id,2,to_jsonb(r)
  from public.routines r where id='bbbbbbbb-bbbb-4bbb-8bbb-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ declare app_id uuid; result jsonb; begin
  select id into app_id from public.applications where user_id=auth.uid()
    and operation_id='30000000-0000-4000-8000-000000000001';
  result:=public.undo_application('30000000-0000-4000-8000-000000000002',auth.uid(),app_id,null);
  if (result->'application'->>'dose_value')::numeric<>250
    or result->'application'->>'dose_unit'<>'mcg'
    or (result->'application'->>'dose_mg')::numeric<>.25
    or (result->'movement'->>'delta_mg')::numeric<>.25
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000006')<>10
    then raise exception 'FAIL immutable version undo'; end if;
end $$;

-- Undo normal, preservação do original, replay e segundo UUID conflitante.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare app_id uuid; first jsonb; replay jsonb; conflict boolean:=false; before_count integer; begin
  select id into app_id from public.applications where user_id=auth.uid()
    and operation_id='20000000-0000-4000-8000-000000000001';
  first:=public.undo_application('20000000-0000-4000-8000-000000000010',auth.uid(),app_id,null);
  if (first->>'replay')::boolean or first->'movement'->>'kind'<>'undo'
    or (first->'movement'->>'delta_mg')::numeric<>1
    or first->'movement'->>'operation_id'<>'20000000-0000-4000-8000-000000000010'
    or first->'movement'->>'application_id'<>app_id::text
    or (first->'movement'->>'balance_before')::numeric<>9
    or (first->'movement'->>'balance_after')::numeric<>10
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001')<>10
    or (select count(*) from public.applications where user_id=auth.uid() and id=app_id)<>1
    or (select count(*) from public.vial_movements where user_id=auth.uid() and application_id=app_id and kind='application')<>1
    then raise exception 'FAIL normal undo'; end if;
  select count(*) into before_count from public.vial_movements where user_id=auth.uid() and application_id=app_id;
  replay:=public.undo_application('20000000-0000-4000-8000-000000000010',auth.uid(),app_id,null);
  if not (replay->>'replay')::boolean
    or replay->'application'<>first->'application' or replay->'movement'<>first->'movement'
    or replay->'vial'<>first->'vial'
    or (select count(*) from public.vial_movements where user_id=auth.uid() and application_id=app_id)<>before_count
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001')<>10
    then raise exception 'FAIL undo replay'; end if;
  begin
    perform public.undo_application('20000000-0000-4000-8000-000000000011',auth.uid(),app_id,null);
  exception when others then conflict:=sqlerrm like 'Aplicação já desfeita%'; end;
  if not conflict then raise exception 'FAIL second undo conflict'; end if;
end $$;

-- Constraints impedem dois movimentos application/undo para a mesma aplicação.
reset role;
do $$ declare app_id uuid; blocked_application boolean:=false; blocked_undo boolean:=false; begin
  select id into app_id from public.applications where operation_id='20000000-0000-4000-8000-000000000001';
  begin
    insert into public.vial_movements(user_id,operation_id,vial_id,application_id,kind,delta_mg,balance_before,balance_after)
    values('22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000020',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',app_id,'application',-1,10,9);
  exception when unique_violation then blocked_application:=true; end;
  begin
    insert into public.vial_movements(user_id,operation_id,vial_id,application_id,kind,delta_mg,balance_before,balance_after)
    values('22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000021',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',app_id,'undo',1,9,10);
  exception when unique_violation then blocked_undo:=true; end;
  if not blocked_application or not blocked_undo then raise exception 'FAIL duplicate movement constraints'; end if;
end $$;

-- Undo que ultrapassaria initial_mg reverte tudo.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare result jsonb; begin
  result:=public.register_application('20000000-0000-4000-8000-000000000030',auth.uid(),
    'bbbbbbbb-bbbb-4bbb-8bbb-000000000004','cccccccc-cccc-4ccc-8ccc-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',date '2026-09-14',null);
end $$;
reset role;
update public.vials set remaining_mg=initial_mg where id='aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare app_id uuid; failed boolean:=false; begin
  select id into app_id from public.applications where user_id=auth.uid()
    and operation_id='20000000-0000-4000-8000-000000000030';
  begin
    perform public.undo_application('20000000-0000-4000-8000-000000000031',auth.uid(),app_id,null);
  exception when others then failed:=sqlerrm like 'Undo excederia%'; end;
  if not failed or (select remaining_mg from public.vials where user_id=auth.uid()
    and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000004')<>10
    or exists(select 1 from public.vial_movements where user_id=auth.uid() and operation_id='20000000-0000-4000-8000-000000000031')
    or exists(select 1 from public.applications where user_id=auth.uid() and id=app_id and undone_at is not null)
    then raise exception 'FAIL excessive undo rollback'; end if;
end $$;

-- Falha no último passo da RPC reverte application + movement + saldo.
reset role;
create function public.b2_test_fail_vial_update() returns trigger language plpgsql as $$
begin
  if new.id='aaaaaaaa-aaaa-4aaa-8aaa-000000000003' then raise exception 'falha intermediária de teste'; end if;
  return new;
end $$;
create trigger b2_test_fail_vial_update before update of remaining_mg on public.vials
for each row execute function public.b2_test_fail_vial_update();
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare failed boolean:=false; begin
  begin
    perform public.register_application('20000000-0000-4000-8000-000000000040',auth.uid(),
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000003','cccccccc-cccc-4ccc-8ccc-000000000003',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',date '2026-09-14',null);
  exception when others then failed:=sqlerrm='falha intermediária de teste'; end;
  if not failed
    or exists(select 1 from public.applications where user_id=auth.uid() and operation_id='20000000-0000-4000-8000-000000000040')
    or exists(select 1 from public.vial_movements where user_id=auth.uid() and operation_id='20000000-0000-4000-8000-000000000040')
    or (select remaining_mg from public.vials where user_id=auth.uid() and id='aaaaaaaa-aaaa-4aaa-8aaa-000000000003')<>10
    then raise exception 'FAIL intermediate rollback'; end if;
end $$;
reset role;
drop trigger b2_test_fail_vial_update on public.vials;
drop function public.b2_test_fail_vial_update();

-- O saldo legado consolidado (6) é o ponto de partida; nenhum evento antigo é fabricado.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ declare result jsonb; begin
  if exists(select 1 from public.applications where user_id=auth.uid()
    and vial_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000005') then raise exception 'FAIL fabricated legacy application'; end if;
  result:=public.register_application('20000000-0000-4000-8000-000000000050',auth.uid(),
    'bbbbbbbb-bbbb-4bbb-8bbb-000000000005','cccccccc-cccc-4ccc-8ccc-000000000005',
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',date '2026-09-14',null);
  if (result->'application'->>'balance_before')::numeric<>6
    or (result->'application'->>'balance_after')::numeric<>5
    or (select count(*) from public.vial_movements where user_id=auth.uid()
      and vial_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000005' and kind='import')<>1
    or (select count(*) from public.applications where user_id=auth.uid()
      and vial_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000005')<>1
    then raise exception 'FAIL legacy consolidated balance'; end if;
end $$;

-- Superfície pública: somente authenticated executa RPC; tabelas continuam sem escrita direta.
reset role;
do $$ declare register_oid oid; undo_oid oid; begin
  select p.oid into register_oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='register_application';
  select p.oid into undo_oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='undo_application';
  if pg_catalog.has_function_privilege('anon',register_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',undo_oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',register_oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',undo_oid,'EXECUTE')
    or pg_catalog.has_table_privilege('authenticated','public.applications','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('authenticated','public.vial_movements','INSERT,UPDATE,DELETE')
    then raise exception 'FAIL RPC grants/direct writes'; end if;
end $$;

rollback;
