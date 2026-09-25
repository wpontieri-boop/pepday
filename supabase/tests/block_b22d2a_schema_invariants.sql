-- Executar após D2-A somente em PostgreSQL descartável. Todas as fixtures revertem.
begin;

-- O ledger D1 foi ampliado sem alterar seus registros e aceita o novo domínio.
do $$ begin
  if (select result from public.domain_mutation_operations
      where operation_id='d2a00000-0000-4000-8000-000000000005')<>'{"preserve":true}'::jsonb then
    raise exception 'FAIL ledger D1 não preservado';
  end if;
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values('d2a00000-0000-4000-8000-000000000001','d2a00000-0000-4000-8000-000000000010',
    'routine','d2a00000-0000-4000-8000-000000000003','update','{}','success','{}');
end $$;

-- Snapshot novo: campos exatos, sem timestamps técnicos e weekdays canônicos.
do $$ declare snapshot jsonb; expected text[]:=array[
  'deleted_at','dose_unit','dose_value','frequency','id','name','refill_at','start_date','status',
  'syringe_capacity','time_of_day','user_id','version','vial_id','weekdays']; begin
  select public.pepday_routine_snapshot(r) into snapshot from public.routines r
    where id='d2a00000-0000-4000-8000-000000000003';
  if (select array_agg(key order by key) from jsonb_object_keys(snapshot) key)<>expected
    or snapshot ? 'created_at' or snapshot ? 'updated_at'
    or snapshot->'weekdays'<>'[1,3,5]'::jsonb then
    raise exception 'FAIL snapshot canônico: %',snapshot;
  end if;
end $$;

-- Frequência legada inválida nunca é aceita.
do $$ declare blocked boolean:=false; begin
  begin
    update public.routines set frequency='5x2'
      where id='d2a00000-0000-4000-8000-000000000003';
  exception when check_violation then blocked:=true; end;
  if not blocked then raise exception 'FAIL frequência 5x2 aceita'; end if;
end $$;

-- UPDATE de versões é bloqueado; o trigger não bloqueia DELETE por cascade.
do $$ declare blocked boolean:=false; begin
  begin
    update public.routine_versions set snapshot=snapshot||'{"x":1}'::jsonb
      where id='d2a00000-0000-4000-8000-000000000004';
  exception when sqlstate '55000' then blocked:=true; end;
  if not blocked then raise exception 'FAIL routine_versions mutável'; end if;
end $$;

-- Remover a versão corrente isoladamente viola a garantia diferida.
do $$ declare blocked boolean:=false; begin
  begin
    delete from public.routine_versions
      where id='d2a00000-0000-4000-8000-000000000004';
    set constraints routine_versions_current_guard immediate;
  exception when check_violation then blocked:=true; end;
  if not blocked then raise exception 'FAIL versão corrente pôde ser removida'; end if;
end $$;
set constraints routine_versions_current_guard deferred;

-- Inatividade sem exclusão é válida; deleted_at exige status inactive.
update public.routines set status='inactive'
  where id='d2a00000-0000-4000-8000-000000000003';
do $$ declare blocked boolean:=false; begin
  begin
    update public.routines set status='active',deleted_at=now()
      where id='d2a00000-0000-4000-8000-000000000003';
  exception when check_violation then blocked:=true; end;
  if not blocked then raise exception 'FAIL deleted_at ativo aceito'; end if;
end $$;

-- INSERT da Rotina seguido de versão na mesma transação satisfaz a constraint diferida.
insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,start_date,version)
values('d2a00000-0000-4000-8000-000000000011','d2a00000-0000-4000-8000-000000000001',
  'd2a00000-0000-4000-8000-000000000002','Nova D2-A',1,'mg',100,'daily',date '2026-09-25',1);
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select 'd2a00000-0000-4000-8000-000000000012',user_id,id,version,
  public.pepday_routine_snapshot(r) from public.routines r
where id='d2a00000-0000-4000-8000-000000000011';
set constraints routines_current_version_guard immediate;
set constraints routines_current_version_guard deferred;

-- A FK composta rejeita versão pertencente a outra Rotina.
do $$ declare blocked boolean:=false; begin
  begin
    insert into public.applications(id,user_id,operation_id,routine_id,routine_version_id,vial_id,
      scheduled_date,applied_at,dose_value,dose_unit,dose_mg,volume_ml,ui,concentration,balance_before,balance_after)
    values('d2a00000-0000-4000-8000-000000000013','d2a00000-0000-4000-8000-000000000001',
      'd2a00000-0000-4000-8000-000000000014','d2a00000-0000-4000-8000-000000000003',
      'd2a00000-0000-4000-8000-000000000012','d2a00000-0000-4000-8000-000000000002',
      date '2026-09-25',now(),1,'mg',1,0.2,20,5,10,9);
  exception when foreign_key_violation then blocked:=true; end;
  if not blocked then raise exception 'FAIL FK composta de Application'; end if;
end $$;

-- Conta descartável prova que DELETE em cascade continua disponível.
insert into auth.users(id,email) values('d2a00000-0000-4000-8000-000000000020','cascade-d2a@example.invalid');
insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on)
values('d2a00000-0000-4000-8000-000000000021','d2a00000-0000-4000-8000-000000000020',
  'Cascade',5,5,1,date '2026-09-25');
insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
  frequency,start_date)
values('d2a00000-0000-4000-8000-000000000022','d2a00000-0000-4000-8000-000000000020',
  'd2a00000-0000-4000-8000-000000000021','Cascade',1,'mg',100,'daily',date '2026-09-25');
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select 'd2a00000-0000-4000-8000-000000000023',user_id,id,version,
  public.pepday_routine_snapshot(r) from public.routines r
where id='d2a00000-0000-4000-8000-000000000022';
set constraints routines_current_version_guard immediate;
delete from auth.users where id='d2a00000-0000-4000-8000-000000000020';
do $$ begin
  if exists(select 1 from public.routines where user_id='d2a00000-0000-4000-8000-000000000020')
    or exists(select 1 from public.routine_versions where user_id='d2a00000-0000-4000-8000-000000000020') then
    raise exception 'FAIL DELETE cascade bloqueado';
  end if;
end $$;

-- Índice, privilégios e hardening das funções/trigger helpers.
do $$ begin
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='routines_active_vial_idx'
    and indexdef like '%(user_id, vial_id)%' and indexdef like '%status = ''active''%'
    and indexdef like '%deleted_at IS NULL%') then raise exception 'FAIL índice ativo por Frasco'; end if;
  if has_table_privilege('authenticated','public.routines','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.routine_versions','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.domain_mutation_operations','INSERT,UPDATE,DELETE') then
    raise exception 'FAIL CRUD direto authenticated';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('pepday_routine_snapshot',
      'pepday_prevent_routine_version_update','pepday_assert_routine_current_version',
      'pepday_assert_version_keeps_current_routine')
      and (p.prosecdef or not exists(select 1 from unnest(p.proconfig) cfg
        where cfg in ('search_path=','search_path=""')))) then
    raise exception 'FAIL security invoker/search_path';
  end if;
  if has_function_privilege('authenticated','public.pepday_routine_snapshot(public.routines)','EXECUTE')
    or has_function_privilege('anon','public.pepday_routine_snapshot(public.routines)','EXECUTE') then
    raise exception 'FAIL helper exposto';
  end if;
end $$;

rollback;
