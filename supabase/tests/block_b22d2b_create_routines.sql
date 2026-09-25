-- Executar após D2-A e D2-B somente em PostgreSQL descartável. Fixtures revertidas.
begin;

insert into auth.users(id,email) values
  ('d2b00000-0000-4000-8000-000000000001','d2b-trial@example.invalid'),
  ('d2b00000-0000-4000-8000-000000000002','d2b-free@example.invalid'),
  ('d2b00000-0000-4000-8000-000000000003','d2b-other@example.invalid');

update public.trials set trial_used=true,started_at=now()-interval '1 day',
  ends_at=now()+interval '6 days'
  where user_id in ('d2b00000-0000-4000-8000-000000000001',
    'd2b00000-0000-4000-8000-000000000003');
update public.subscriptions set status='trial'
  where user_id in ('d2b00000-0000-4000-8000-000000000001',
    'd2b00000-0000-4000-8000-000000000003');

insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on,active,deleted_at)
values
  ('d2b10000-0000-4000-8000-000000000001','d2b00000-0000-4000-8000-000000000001',
    'Disponível',10,9,2,date '2026-09-25',true,null),
  ('d2b10000-0000-4000-8000-000000000002','d2b00000-0000-4000-8000-000000000001',
    'Inativo',10,8,2,date '2026-09-25',false,null),
  ('d2b10000-0000-4000-8000-000000000003','d2b00000-0000-4000-8000-000000000001',
    'Excluído',10,7,2,date '2026-09-25',false,now()),
  ('d2b10000-0000-4000-8000-000000000004','d2b00000-0000-4000-8000-000000000003',
    'Outra conta',10,6,2,date '2026-09-25',true,null);

-- Rotina e versão preexistentes exercitam as duas colisões determinísticas.
insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,weekdays,start_date,status,version,deleted_at)
values('d2b20000-0000-4000-8000-000000000001','d2b00000-0000-4000-8000-000000000001',
  'd2b10000-0000-4000-8000-000000000001','Preexistente',1,'mg',100,'daily','{}',
  date '2026-09-25','active',1,null);
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select 'd2b30000-0000-4000-8000-000000000001',r.user_id,r.id,1,
  public.pepday_routine_snapshot(r) from public.routines r
where r.id='d2b20000-0000-4000-8000-000000000001';
set constraints routines_current_version_guard immediate;
set constraints routines_current_version_guard deferred;

set local role authenticated;
select set_config('request.jwt.claim.sub','d2b00000-0000-4000-8000-000000000001',true);

-- A/B/I: criação canônica, snapshot explícito, ausência de efeitos de aplicação e replay.
do $$
declare
  first_result jsonb;
  replay_result jsonb;
  stored_snapshot jsonb;
  balance_before numeric;
  movement_before bigint;
  application_before bigint;
begin
  select remaining_mg into balance_before from public.vials
    where id='d2b10000-0000-4000-8000-000000000001';
  select count(*) into movement_before from public.vial_movements;
  select count(*) into application_before from public.applications;

  first_result:=public.create_routine_versioned(
    'd2b40000-0000-4000-8000-000000000001',auth.uid(),
    'd2b20000-0000-4000-8000-000000000010',
    'd2b30000-0000-4000-8000-000000000010',
    'd2b10000-0000-4000-8000-000000000001',' Rotina D2-B ',1.5,'mg',100,
    'weekdays',array[5,1,5,3],date '2026-09-25',time '08:30',3);

  select rv.snapshot
    into stored_snapshot
    from public.routines r join public.routine_versions rv
      on rv.user_id=r.user_id and rv.routine_id=r.id and rv.version=r.version
    where r.id='d2b20000-0000-4000-8000-000000000010';
  if first_result->>'outcome'<>'success' or (first_result->>'replay')::boolean
    or first_result->>'entity_type'<>'routine'
    or first_result->>'entity_id'<>'d2b20000-0000-4000-8000-000000000010'
    or (first_result->>'version')::bigint<>1
    or first_result->>'routine_version_id'<>'d2b30000-0000-4000-8000-000000000010'
    or first_result->'snapshot' is distinct from stored_snapshot
    or first_result->'routine' is distinct from stored_snapshot
    or stored_snapshot->'weekdays'<>'[1,3,5]'::jsonb
    or stored_snapshot->>'name'<>'Rotina D2-B'
    or stored_snapshot->>'status'<>'active'
    or (stored_snapshot->>'version')::bigint<>1
    or stored_snapshot->'deleted_at'<>'null'::jsonb
    or (select count(*) from public.routine_versions
      where routine_id='d2b20000-0000-4000-8000-000000000010')<>1
    or (select remaining_mg from public.vials
      where id='d2b10000-0000-4000-8000-000000000001')<>balance_before
    or (select count(*) from public.vial_movements)<>movement_before
    or (select count(*) from public.applications)<>application_before then
    raise exception 'FAIL criação normal D2-B: %',first_result;
  end if;

  replay_result:=public.create_routine_versioned(
    'd2b40000-0000-4000-8000-000000000001',auth.uid(),
    'd2b20000-0000-4000-8000-000000000010',
    'd2b30000-0000-4000-8000-000000000010',
    'd2b10000-0000-4000-8000-000000000001','Rotina D2-B',1.50,'mg',100,
    'weekdays',array[3,5,1,3],date '2026-09-25',time '08:30',3);
  if not (replay_result->>'replay')::boolean
    or replay_result-'replay' is distinct from first_result-'replay'
    or (select count(*) from public.routines
      where id='d2b20000-0000-4000-8000-000000000010')<>1
    or (select count(*) from public.routine_versions
      where routine_id='d2b20000-0000-4000-8000-000000000010')<>1 then
    raise exception 'FAIL replay D2-B: %',replay_result;
  end if;
end $$;

-- O helper é privado: a comparação exata é feita como proprietário, não pelo cliente.
reset role;
do $$ declare stored_snapshot jsonb; canonical_snapshot jsonb; begin
  select rv.snapshot,public.pepday_routine_snapshot(r)
    into stored_snapshot,canonical_snapshot
    from public.routines r join public.routine_versions rv
      on rv.user_id=r.user_id and rv.routine_id=r.id and rv.version=r.version
    where r.id='d2b20000-0000-4000-8000-000000000010';
  if stored_snapshot is distinct from canonical_snapshot then
    raise exception 'FAIL snapshot não corresponde a pepday_routine_snapshot';
  end if;
end $$;

-- Replay permanece recuperável após expiração; uma operação nova continua bloqueada.
update public.trials set started_at=now()-interval '8 days',ends_at=now()-interval '1 day'
  where user_id='d2b00000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d2b00000-0000-4000-8000-000000000001',true);
do $$ declare replay_result jsonb; begin
  replay_result:=public.create_routine_versioned(
    'd2b40000-0000-4000-8000-000000000001',auth.uid(),
    'd2b20000-0000-4000-8000-000000000010',
    'd2b30000-0000-4000-8000-000000000010',
    'd2b10000-0000-4000-8000-000000000001','Rotina D2-B',1.5,'mg',100,
    'weekdays',array[1,3,5],date '2026-09-25',time '08:30',3);
  if replay_result->>'outcome'<>'success' or not (replay_result->>'replay')::boolean then
    raise exception 'FAIL replay após expiração: %',replay_result;
  end if;
end $$;
reset role;
update public.trials set started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id='d2b00000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d2b00000-0000-4000-8000-000000000001',true);

-- C: mesmo operation_id com intenção divergente é rejeitado sem efeito adicional.
do $$ declare blocked boolean:=false; before_routines bigint; before_versions bigint; begin
  select count(*) into before_routines from public.routines;
  select count(*) into before_versions from public.routine_versions;
  begin
    perform public.create_routine_versioned(
      'd2b40000-0000-4000-8000-000000000001',auth.uid(),
      'd2b20000-0000-4000-8000-000000000010',
      'd2b30000-0000-4000-8000-000000000010',
      'd2b10000-0000-4000-8000-000000000001','Intenção diferente',1.5,'mg',100,
      'weekdays',array[1,3,5],date '2026-09-25',time '08:30',3);
  exception when others then
    blocked:=sqlerrm like 'UUID de operação reutilizado com intenção diferente%';
  end;
  if not blocked or (select count(*) from public.routines)<>before_routines
    or (select count(*) from public.routine_versions)<>before_versions then
    raise exception 'FAIL operation_id divergente';
  end if;
end $$;

-- D: routine_id preexistente não ganha versão adicional.
do $$ declare result jsonb; before_versions bigint; begin
  select count(*) into before_versions from public.routine_versions
    where routine_id='d2b20000-0000-4000-8000-000000000001';
  result:=public.create_routine_versioned(
    'd2b40000-0000-4000-8000-000000000002',auth.uid(),
    'd2b20000-0000-4000-8000-000000000001',
    'd2b30000-0000-4000-8000-000000000020',
    'd2b10000-0000-4000-8000-000000000001','Colisão entidade',1,'mg',100,
    'daily','{}',date '2026-09-25',null,3);
  if result->>'outcome'<>'conflict' or result->>'code'<>'ENTITY_ALREADY_EXISTS'
    or (select count(*) from public.routine_versions
      where routine_id='d2b20000-0000-4000-8000-000000000001')<>before_versions then
    raise exception 'FAIL ENTITY_ALREADY_EXISTS: %',result;
  end if;
end $$;

-- E: routine_version_id ocupado não deixa Rotina parcial.
do $$ declare result jsonb; begin
  result:=public.create_routine_versioned(
    'd2b40000-0000-4000-8000-000000000003',auth.uid(),
    'd2b20000-0000-4000-8000-000000000020',
    'd2b30000-0000-4000-8000-000000000001',
    'd2b10000-0000-4000-8000-000000000001','Versão ocupada',1,'mg',100,
    'daily','{}',date '2026-09-25',null,3);
  if result->>'outcome'<>'conflict' or result->>'code'<>'ROUTINE_VERSION_ID_UNAVAILABLE'
    or exists(select 1 from public.routines where id='d2b20000-0000-4000-8000-000000000020') then
    raise exception 'FAIL ROUTINE_VERSION_ID_UNAVAILABLE: %',result;
  end if;
end $$;

-- F: Frasco de outra conta, inativo ou excluído produz o mesmo conflito sem escrita parcial.
do $$ declare vial uuid; suffix integer:=0; result jsonb; begin
  foreach vial in array array[
    'd2b10000-0000-4000-8000-000000000004'::uuid,
    'd2b10000-0000-4000-8000-000000000002'::uuid,
    'd2b10000-0000-4000-8000-000000000003'::uuid
  ] loop
    suffix:=suffix+1;
    result:=public.create_routine_versioned(
      ('d2b40000-0000-4000-8000-'||lpad((10+suffix)::text,12,'0'))::uuid,auth.uid(),
      ('d2b20000-0000-4000-8000-'||lpad((30+suffix)::text,12,'0'))::uuid,
      ('d2b30000-0000-4000-8000-'||lpad((30+suffix)::text,12,'0'))::uuid,
      vial,'Frasco indisponível',1,'mg',100,'daily','{}',date '2026-09-25',null,3);
    if result->>'outcome'<>'conflict' or result->>'code'<>'VIAL_NOT_AVAILABLE'
      or exists(select 1 from public.routines
        where id=('d2b20000-0000-4000-8000-'||lpad((30+suffix)::text,12,'0'))::uuid) then
      raise exception 'FAIL VIAL_NOT_AVAILABLE: %',result;
    end if;
  end loop;
end $$;

-- G/H/I: auth, expected_user, entitlement e frequência legada são bloqueados sem escrita.
do $$ declare blocked boolean:=false; begin
  begin
    perform public.create_routine_versioned(
      'd2b40000-0000-4000-8000-000000000020',
      'd2b00000-0000-4000-8000-000000000003',
      'd2b20000-0000-4000-8000-000000000040',
      'd2b30000-0000-4000-8000-000000000040',
      'd2b10000-0000-4000-8000-000000000001','Conta divergente',1,'mg',100,
      'daily','{}',date '2026-09-25',null,3);
  exception when others then blocked:=sqlerrm like 'Conta alterada%'; end;
  if not blocked or exists(select 1 from public.routines
    where id='d2b20000-0000-4000-8000-000000000040') then
    raise exception 'FAIL expected_user divergente';
  end if;

  blocked:=false;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.create_routine_versioned(
      'd2b40000-0000-4000-8000-000000000021',
      'd2b00000-0000-4000-8000-000000000001',
      'd2b20000-0000-4000-8000-000000000041',
      'd2b30000-0000-4000-8000-000000000041',
      'd2b10000-0000-4000-8000-000000000001','Sem auth',1,'mg',100,
      'daily','{}',date '2026-09-25',null,3);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL auth.uid nulo'; end if;

  blocked:=false;
  perform set_config('request.jwt.claim.sub','d2b00000-0000-4000-8000-000000000002',true);
  begin
    perform public.create_routine_versioned(
      'd2b40000-0000-4000-8000-000000000022',auth.uid(),
      'd2b20000-0000-4000-8000-000000000042',
      'd2b30000-0000-4000-8000-000000000042',
      'd2b10000-0000-4000-8000-000000000001','FREE',1,'mg',100,
      'daily','{}',date '2026-09-25',null,3);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked or exists(select 1 from public.routines
    where id='d2b20000-0000-4000-8000-000000000042') then
    raise exception 'FAIL entitlement bloqueado';
  end if;

  blocked:=false;
  perform set_config('request.jwt.claim.sub','d2b00000-0000-4000-8000-000000000001',true);
  begin
    perform public.create_routine_versioned(
      'd2b40000-0000-4000-8000-000000000023',auth.uid(),
      'd2b20000-0000-4000-8000-000000000043',
      'd2b30000-0000-4000-8000-000000000043',
      'd2b10000-0000-4000-8000-000000000001','Legado inválido',1,'mg',100,
      '5x2','{}',date '2026-09-25',null,3);
  exception when others then blocked:=sqlerrm='Rotina inválida'; end;
  if not blocked then
    raise exception 'FAIL frequência 5x2 aceita ou persistida';
  end if;
end $$;

-- Transação: falha ao inserir a versão reverte também a Rotina.
reset role;
create function pg_temp.fail_d2b_version() returns trigger language plpgsql as $$
begin
  if new.id='d2b30000-0000-4000-8000-000000000050' then raise exception 'falha injetada D2-B'; end if;
  return new;
end $$;
create trigger fail_d2b_version before insert on public.routine_versions
for each row execute function pg_temp.fail_d2b_version();
set local role authenticated;
select set_config('request.jwt.claim.sub','d2b00000-0000-4000-8000-000000000001',true);
do $$ declare blocked boolean:=false; begin
  begin
    perform public.create_routine_versioned(
      'd2b40000-0000-4000-8000-000000000050',auth.uid(),
      'd2b20000-0000-4000-8000-000000000050',
      'd2b30000-0000-4000-8000-000000000050',
      'd2b10000-0000-4000-8000-000000000001','Rollback',1,'mg',100,
      'daily','{}',date '2026-09-25',null,3);
  exception when others then blocked:=sqlerrm='falha injetada D2-B'; end;
  if not blocked
    or exists(select 1 from public.routines where id='d2b20000-0000-4000-8000-000000000050') then
    raise exception 'FAIL atomicidade D2-B';
  end if;
end $$;
reset role;
drop trigger fail_d2b_version on public.routine_versions;

-- J: apenas authenticated executa a RPC; CRUD direto permanece fechado.
do $$ begin
  if (select result->>'outcome' from public.domain_mutation_operations
      where operation_id='d2b40000-0000-4000-8000-000000000001')<>'success'
    or (select result->>'replay' from public.domain_mutation_operations
      where operation_id='d2b40000-0000-4000-8000-000000000001')<>'false'
    or exists(select 1 from public.domain_mutation_operations where operation_id in
      ('d2b40000-0000-4000-8000-000000000023',
       'd2b40000-0000-4000-8000-000000000050')) then
    raise exception 'FAIL persistência exata ou rollback do ledger D2-B';
  end if;
  if not has_function_privilege('authenticated',
    'public.create_routine_versioned(uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time,integer)',
    'EXECUTE')
    or has_function_privilege('anon',
    'public.create_routine_versioned(uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time,integer)',
    'EXECUTE')
    or has_function_privilege('public',
    'public.create_routine_versioned(uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time,integer)',
    'EXECUTE') then
    raise exception 'FAIL grants da RPC D2-B';
  end if;
  if has_table_privilege('authenticated','public.routines','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.routine_versions','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.domain_mutation_operations','INSERT,UPDATE,DELETE') then
    raise exception 'FAIL CRUD direto authenticated D2-B';
  end if;
end $$;

rollback;
