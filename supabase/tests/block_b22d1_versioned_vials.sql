-- Executar somente após A, A4, B1, B2.1 e B2.2-D1 em banco descartável.
-- Todas as fixtures são revertidas no final.
begin;

-- Registro criado antes da migration recebe a versão editável inicial.
do $$ begin
  if (select edit_version from public.vials
      where id='d1f00000-0000-4000-8000-000000000002')<>1 then
    raise exception 'FAIL existing vial edit_version backfill';
  end if;
end $$;

insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','d1-trial@example.invalid'),
 ('d1000000-0000-4000-8000-000000000002','d1-free@example.invalid'),
 ('d1000000-0000-4000-8000-000000000003','d1-other@example.invalid');

update public.profiles set is_adult_confirmed=true,terms_accepted_at=now(),terms_version='test',
  privacy_accepted_at=now(),privacy_version='test'
  where id in ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000003');
update public.trials set trial_used=true,started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id in ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003');
update public.subscriptions set status='trial'
  where user_id in ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);

-- 1-4: create, replay, intenção divergente e create concorrente serializado.
do $$ declare first jsonb; replay jsonb; second jsonb; blocked boolean:=false; begin
  first:=public.create_vial_versioned(
    'd1100000-0000-4000-8000-000000000001',auth.uid(),
    'd1200000-0000-4000-8000-000000000001','Frasco D1',10,2,date '2026-09-16',100);
  if first->>'outcome'<>'success' or (first->>'replay')::boolean
    or (first->'vial'->>'version')::bigint<>1 or (first->'vial'->>'edit_version')::bigint<>1
    or (first->'vial'->>'remaining_mg')::numeric<>10 then raise exception 'FAIL create success'; end if;
  replay:=public.create_vial_versioned(
    'd1100000-0000-4000-8000-000000000001',auth.uid(),
    'd1200000-0000-4000-8000-000000000001','Frasco D1',10.0,2.00,date '2026-09-16',100.00);
  if replay->>'outcome'<>'success' or not (replay->>'replay')::boolean
    or replay-'replay'<>first-'replay'
    or (select count(*) from public.vials where id='d1200000-0000-4000-8000-000000000001')<>1
    then raise exception 'FAIL create replay'; end if;
  begin
    perform public.create_vial_versioned(
      'd1100000-0000-4000-8000-000000000001',auth.uid(),
      'd1200000-0000-4000-8000-000000000001','Outra intenção',10,2,date '2026-09-16',100);
  exception when others then blocked:=sqlerrm like 'UUID de operação reutilizado%'; end;
  if not blocked then raise exception 'FAIL same UUID different intent'; end if;
  second:=public.create_vial_versioned(
    'd1100000-0000-4000-8000-000000000002',auth.uid(),
    'd1200000-0000-4000-8000-000000000001','Frasco D1',10,2,date '2026-09-16',100);
  if second->>'outcome'<>'conflict' or second->>'code'<>'ENTITY_ALREADY_EXISTS'
    or (second->>'remote_version')::bigint<>1
    or (select count(*) from public.vials where id='d1200000-0000-4000-8000-000000000001')<>1
    then raise exception 'FAIL deterministic competing create'; end if;
end $$;

-- 5-10: update, stale conflict durável, saldo preservado e campo proibido.
do $$ declare base jsonb; changed jsonb; changed_replay jsonb; conflict_first jsonb; conflict_replay jsonb;
  later jsonb; blocked boolean:=false; before_balance numeric; begin
  select to_jsonb(v) into base from public.vials v
    where id='d1200000-0000-4000-8000-000000000001';
  select remaining_mg into before_balance from public.vials where id='d1200000-0000-4000-8000-000000000001';
  changed:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000003',auth.uid(),
    'd1200000-0000-4000-8000-000000000001',1,base,'{"name":"Frasco editado","cost":null}');
  if changed->>'outcome'<>'success' or (changed->'vial'->>'edit_version')::bigint<>2
    or (changed->'vial'->>'version')::bigint<>2 or changed->'vial'->>'name'<>'Frasco editado'
    or (changed->'vial'->>'remaining_mg')::numeric<>before_balance then raise exception 'FAIL versioned update'; end if;
  changed_replay:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000003',auth.uid(),
    'd1200000-0000-4000-8000-000000000001',1,base,'{"cost":null,"name":"Frasco editado"}');
  if not (changed_replay->>'replay')::boolean or changed_replay-'replay'<>changed-'replay' then
    raise exception 'FAIL canonical JSON order or null fingerprint';
  end if;
  conflict_first:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000004',auth.uid(),
    'd1200000-0000-4000-8000-000000000001',1,base,'{"name":"Stale"}');
  if conflict_first->>'outcome'<>'conflict' or conflict_first->>'code'<>'STALE_VERSION'
    or conflict_first->>'entity_type'<>'vial'
    or conflict_first->>'entity_id'<>'d1200000-0000-4000-8000-000000000001'
    or (conflict_first->>'expected_version')::bigint<>1 or (conflict_first->>'remote_version')::bigint<>2
    or conflict_first->'base' is null or conflict_first->'local' is null or conflict_first->'remote' is null
    then raise exception 'FAIL stale conflict contract'; end if;
  later:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000005',auth.uid(),
    'd1200000-0000-4000-8000-000000000001',2,changed->'vial','{"name":"Versão três"}');
  if later->>'outcome'<>'success' then raise exception 'FAIL later valid update'; end if;
  conflict_replay:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000004',auth.uid(),
    'd1200000-0000-4000-8000-000000000001',1,base,'{"name":"Stale"}'::jsonb);
  if not (conflict_replay->>'replay')::boolean or conflict_replay-'replay'<>conflict_first-'replay'
    or (conflict_replay->>'remote_version')::bigint<>2
    or (select name from public.vials where id='d1200000-0000-4000-8000-000000000001')<>'Versão três'
    then raise exception 'FAIL conflict replay changed entity'; end if;
  begin
    perform public.update_vial_versioned('d1100000-0000-4000-8000-000000000006',auth.uid(),
      'd1200000-0000-4000-8000-000000000001',3,later->'vial','{"remaining_mg":1}');
  exception when others then blocked:=sqlerrm like 'Campo não permitido%'; end;
  if not blocked then raise exception 'FAIL remaining_mg accepted'; end if;
end $$;

-- 11-15: initial_mg é imutável; diluição só antes de movimento; B2.1 altera só version.
select public.create_vial_versioned('d1100000-0000-4000-8000-000000000010',auth.uid(),
  'd1200000-0000-4000-8000-000000000002','Frasco transacional',10,2,date '2026-09-16',null);
reset role;
insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,start_date) values('d1300000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000002',
  'Rotina D1',1,'mg',100,'daily',date '2026-09-16');
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  select 'd1400000-0000-4000-8000-000000000001',r.user_id,r.id,1,to_jsonb(r)
  from public.routines r where id='d1300000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare base jsonb; changed jsonb; app jsonb; undone jsonb; blocked_initial boolean:=false;
  blocked_water boolean:=false; edit_before bigint; version_before bigint; app_id uuid; begin
  select to_jsonb(v) into base from public.vials v
    where id='d1200000-0000-4000-8000-000000000002';
  begin
    perform public.update_vial_versioned('d1100000-0000-4000-8000-000000000011',auth.uid(),
      'd1200000-0000-4000-8000-000000000002',1,base,'{"initial_mg":12}');
  exception when others then blocked_initial:=sqlerrm like 'Campo não permitido%'; end;
  if not blocked_initial then raise exception 'FAIL initial_mg changed after create'; end if;
  changed:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000012',auth.uid(),
    'd1200000-0000-4000-8000-000000000002',1,base,'{"water_ml":3}');
  if changed->>'outcome'<>'success' or (changed->'vial'->>'initial_mg')::numeric<>10
    or (changed->'vial'->>'water_ml')::numeric<>3
    or (changed->'vial'->>'remaining_mg')::numeric<>10
    or (changed->'vial'->>'concentration')::numeric is distinct from 10::numeric/3
    then raise exception 'FAIL pre-movement dilution update'; end if;

  select edit_version,version into edit_before,version_before from public.vials
    where id='d1200000-0000-4000-8000-000000000002';
  app:=public.register_application('d1500000-0000-4000-8000-000000000001',auth.uid(),
    'd1300000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000002',date '2026-09-16',null);
  app_id:=(app->'application'->>'id')::uuid;
  if (select edit_version from public.vials where id='d1200000-0000-4000-8000-000000000002')<>edit_before
    or (select version from public.vials where id='d1200000-0000-4000-8000-000000000002')<>version_before+1
    then raise exception 'FAIL application changed edit_version'; end if;
  base:=changed->'vial';
  changed:=public.update_vial_versioned('d1100000-0000-4000-8000-000000000015',auth.uid(),
    'd1200000-0000-4000-8000-000000000002',edit_before,base,'{"name":"Editada após Application"}');
  if changed->>'outcome'<>'success' or (changed->'vial'->>'remaining_mg')::numeric<>9
    then raise exception 'FAIL descriptive update concurrent with application'; end if;
  blocked_initial:=false;
  begin
    perform public.update_vial_versioned('d1100000-0000-4000-8000-000000000013',auth.uid(),
      'd1200000-0000-4000-8000-000000000002',edit_before+1,changed->'vial','{"initial_mg":13}');
  exception when others then blocked_initial:=sqlerrm like 'Campo não permitido%'; end;
  begin
    perform public.update_vial_versioned('d1100000-0000-4000-8000-000000000014',auth.uid(),
      'd1200000-0000-4000-8000-000000000002',edit_before+1,changed->'vial','{"water_ml":4}');
  exception when others then blocked_water:=sqlerrm like 'Diluição não pode mudar%'; end;
  if not blocked_initial or not blocked_water then raise exception 'FAIL preparation changed after movement'; end if;
  edit_before:=(select edit_version from public.vials where id='d1200000-0000-4000-8000-000000000002');
  version_before:=(select version from public.vials where id='d1200000-0000-4000-8000-000000000002');
  undone:=public.undo_application('d1500000-0000-4000-8000-000000000002',auth.uid(),app_id,null);
  if (select edit_version from public.vials where id='d1200000-0000-4000-8000-000000000002')<>edit_before
    or (select version from public.vials where id='d1200000-0000-4000-8000-000000000002')<>version_before+1
    or (undone->'vial'->>'remaining_mg')::numeric<>10 then raise exception 'FAIL undo changed edit_version'; end if;
end $$;

-- 16-19: soft-delete, stale, dependência ativa e preservação histórica.
select public.create_vial_versioned('d1100000-0000-4000-8000-000000000020',auth.uid(),
  'd1200000-0000-4000-8000-000000000003','Para excluir',5,1,date '2026-09-16',null);
reset role;
insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,start_date) values('d1300000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000003',
  'Histórico real D1',1,'mg',100,'daily',date '2026-09-16');
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  select 'd1400000-0000-4000-8000-000000000002',r.user_id,r.id,1,to_jsonb(r)
  from public.routines r where id='d1300000-0000-4000-8000-000000000002';
set local role authenticated;
select public.register_application('d1500000-0000-4000-8000-000000000010',auth.uid(),
  'd1300000-0000-4000-8000-000000000002','d1400000-0000-4000-8000-000000000002',
  'd1200000-0000-4000-8000-000000000003',date '2026-09-16',null);
reset role;
update public.routines set status='inactive'
  where id='d1300000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ declare base jsonb; removed jsonb; stale jsonb; dependency jsonb;
  movement_count integer; application_count integer; begin
  select to_jsonb(v) into base from public.vials v
    where id='d1200000-0000-4000-8000-000000000003';
  select count(*) into movement_count from public.vial_movements
    where vial_id='d1200000-0000-4000-8000-000000000003';
  select count(*) into application_count from public.applications
    where vial_id='d1200000-0000-4000-8000-000000000003';
  if movement_count<>1 or application_count<>1 then raise exception 'FAIL real history fixture'; end if;
  removed:=public.soft_delete_vial_versioned('d1100000-0000-4000-8000-000000000021',auth.uid(),
    'd1200000-0000-4000-8000-000000000003',1,base);
  if removed->>'outcome'<>'success' or (removed->'vial'->>'active')::boolean
    or removed->'vial'->'deleted_at'='null'::jsonb
    or (removed->'vial'->>'edit_version')::bigint<>2
    or (select count(*) from public.vial_movements where vial_id='d1200000-0000-4000-8000-000000000003')<>movement_count
    or (select count(*) from public.applications where vial_id='d1200000-0000-4000-8000-000000000003')<>application_count
    then raise exception 'FAIL soft delete or history preservation'; end if;
  stale:=public.soft_delete_vial_versioned('d1100000-0000-4000-8000-000000000022',auth.uid(),
    'd1200000-0000-4000-8000-000000000003',1,base);
  if stale->>'outcome'<>'conflict' or stale->>'code'<>'STALE_VERSION' then raise exception 'FAIL stale delete'; end if;
  select to_jsonb(v) into base from public.vials v
    where id='d1200000-0000-4000-8000-000000000002';
  dependency:=public.soft_delete_vial_versioned('d1100000-0000-4000-8000-000000000023',auth.uid(),
    'd1200000-0000-4000-8000-000000000002',(base->>'edit_version')::bigint,base);
  if dependency->>'outcome'<>'conflict' or dependency->>'code'<>'ACTIVE_ROUTINE_DEPENDENCY'
    or not (select active from public.vials where id='d1200000-0000-4000-8000-000000000002')
    then raise exception 'FAIL active routine dependency'; end if;
end $$;

-- 20: falha intermediária no ledger reverte a alteração da entidade.
reset role;
create function pg_temp.fail_d1_ledger() returns trigger language plpgsql as $$
begin
  if new.operation_id='d1100000-0000-4000-8000-000000000030' then raise exception 'falha injetada'; end if;
  return new;
end $$;
create trigger fail_d1_ledger before insert on public.domain_mutation_operations
for each row execute function pg_temp.fail_d1_ledger();
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
do $$ declare base jsonb; before_name text; before_version bigint; blocked boolean:=false; begin
  select to_jsonb(v),name,edit_version into base,before_name,before_version
    from public.vials v where id='d1200000-0000-4000-8000-000000000001';
  begin
    perform public.update_vial_versioned('d1100000-0000-4000-8000-000000000030',auth.uid(),
      'd1200000-0000-4000-8000-000000000001',before_version,base,'{"name":"Não pode persistir"}');
  exception when others then blocked:=sqlerrm='falha injetada'; end;
  if not blocked
    or (select name from public.vials where id='d1200000-0000-4000-8000-000000000001')<>before_name
    or (select edit_version from public.vials where id='d1200000-0000-4000-8000-000000000001')<>before_version
    then raise exception 'FAIL intermediate rollback'; end if;
end $$;
reset role;
drop trigger fail_d1_ledger on public.domain_mutation_operations;
set local role authenticated;

-- 21-25: Auth, expected user, entitlement, isolamento e privilégios.
do $$ declare blocked boolean:=false; begin
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.create_vial_versioned('d1100000-0000-4000-8000-000000000040',
      'd1000000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000040',
      'Sem auth',10,2,current_date,null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL unauthenticated allowed'; end if;
  blocked:=false;
  perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
  begin
    perform public.create_vial_versioned('d1100000-0000-4000-8000-000000000041',
      'd1000000-0000-4000-8000-000000000003','d1200000-0000-4000-8000-000000000041',
      'Wrong expected',10,2,current_date,null);
  exception when others then blocked:=sqlerrm like 'Conta alterada%'; end;
  if not blocked then raise exception 'FAIL expected user mismatch'; end if;
  blocked:=false;
  perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
  begin
    perform public.create_vial_versioned('d1100000-0000-4000-8000-000000000042',auth.uid(),
      'd1200000-0000-4000-8000-000000000042','FREE',10,2,current_date,null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL FREE allowed'; end if;
  blocked:=false;
  perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
  begin
    perform public.update_vial_versioned('d1100000-0000-4000-8000-000000000043',auth.uid(),
      'd1200000-0000-4000-8000-000000000001',1,'{}','{"name":"Cross user"}');
  exception when others then blocked:=sqlerrm='Frasco não encontrado'; end;
  if not blocked then raise exception 'FAIL cross-user update'; end if;
end $$;

reset role;
do $$ begin
  if exists(select 1 from public.domain_mutation_operations where operation_id in
    ('d1100000-0000-4000-8000-000000000006','d1100000-0000-4000-8000-000000000011',
      'd1100000-0000-4000-8000-000000000030')) then
    raise exception 'FAIL rejected operation persisted ledger';
  end if;
  if has_table_privilege('authenticated','public.vials','INSERT')
    or has_table_privilege('authenticated','public.vials','UPDATE')
    or has_table_privilege('authenticated','public.vials','DELETE')
    or has_table_privilege('authenticated','public.domain_mutation_operations','INSERT')
    or has_table_privilege('authenticated','public.domain_mutation_operations','UPDATE')
    or has_table_privilege('authenticated','public.domain_mutation_operations','DELETE') then
    raise exception 'FAIL authenticated direct CRUD';
  end if;
  if not has_function_privilege('authenticated',
    'public.create_vial_versioned(uuid,uuid,uuid,text,numeric,numeric,date,numeric)','EXECUTE')
    or not has_function_privilege('authenticated',
    'public.update_vial_versioned(uuid,uuid,uuid,bigint,jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated',
    'public.soft_delete_vial_versioned(uuid,uuid,uuid,bigint,jsonb)','EXECUTE') then
    raise exception 'FAIL RPC execute grants';
  end if;
end $$;

rollback;
