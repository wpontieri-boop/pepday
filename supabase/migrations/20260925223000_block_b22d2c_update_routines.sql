-- PepDay V3.0 / Bloco B2.2-D2-C. Aplicar uma vez, somente em pepday-v3-test.
-- Atualizacao versionada de Rotinas. Nao implementa soft-delete nem altera historico.
begin;

create function public.update_routine_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_routine_id uuid,
  p_new_routine_version_id uuid,
  p_expected_version bigint,
  p_base jsonb,
  p_patch jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  entitlement jsonb;
  op public.domain_mutation_operations;
  current_routine public.routines;
  updated_routine public.routines;
  canonical_weekdays integer[];
  normalized_patch jsonb:='{}'::jsonb;
  intent jsonb;
  fingerprint jsonb;
  remote_snapshot jsonb;
  local_snapshot jsonb;
  confirmed_snapshot jsonb;
  result jsonb;
  target_vial_id uuid;
  target_name text;
  target_dose_value numeric;
  target_dose_unit text;
  target_syringe_capacity integer;
  target_frequency text;
  target_weekdays integer[];
  current_canonical_weekdays integer[];
  target_start_date date;
  target_time_of_day time;
  target_refill_at integer;
  semantic_change boolean;
  current_routine_version_id uuid;
begin
  if u is null then
    raise exception 'Autenticacao necessaria' using errcode='42501';
  end if;
  if p_expected_user is distinct from u then
    raise exception 'Conta alterada durante a operacao';
  end if;
  if p_operation_id is null or p_routine_id is null
    or p_new_routine_version_id is null or p_expected_version is null
    or p_expected_version<1 then
    raise exception 'Intencao incompleta';
  end if;
  if jsonb_typeof(p_base) is distinct from 'object'
    or jsonb_typeof(p_patch) is distinct from 'object'
    or octet_length(p_base::text)>65536
    or octet_length(p_patch::text)>16384 then
    raise exception 'Snapshot ou alteracao invalida';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) key
    where key not in ('vial_id','name','dose_value','dose_unit','syringe_capacity',
      'frequency','weekdays','start_date','time_of_day','refill_at')) then
    raise exception 'Campo nao permitido na edicao de Rotina';
  end if;

  -- Validacao e normalizacao estritas. O fingerprint nunca usa o patch bruto.
  if p_patch ? 'vial_id' then
    if jsonb_typeof(p_patch->'vial_id') is distinct from 'string'
      or (p_patch->>'vial_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Frasco invalido';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object('vial_id',(p_patch->>'vial_id')::uuid);
  end if;
  if p_patch ? 'name' then
    if jsonb_typeof(p_patch->'name') is distinct from 'string'
      or length(trim(p_patch->>'name')) not between 1 and 200 then
      raise exception 'Nome invalido';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object('name',trim(p_patch->>'name'));
  end if;
  if p_patch ? 'dose_value' then
    if jsonb_typeof(p_patch->'dose_value') is distinct from 'number' then
      raise exception 'Dose invalida';
    end if;
    if (p_patch->>'dose_value')::numeric<=0
      or (p_patch->>'dose_value')::numeric>=1000000000 then
      raise exception 'Dose invalida';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object(
      'dose_value',(p_patch->>'dose_value')::numeric);
  end if;
  if p_patch ? 'dose_unit' then
    if jsonb_typeof(p_patch->'dose_unit') is distinct from 'string'
      or p_patch->>'dose_unit' not in ('mg','mcg') then
      raise exception 'Unidade de dose invalida';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object('dose_unit',p_patch->>'dose_unit');
  end if;
  if p_patch ? 'syringe_capacity' then
    if jsonb_typeof(p_patch->'syringe_capacity') is distinct from 'number'
      or (p_patch->>'syringe_capacity') !~ '^[0-9]+$'
      or (p_patch->>'syringe_capacity')::numeric not in (30,50,100) then
      raise exception 'Capacidade de seringa invalida';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object(
      'syringe_capacity',(p_patch->>'syringe_capacity')::integer);
  end if;
  if p_patch ? 'frequency' then
    if jsonb_typeof(p_patch->'frequency') is distinct from 'string'
      or p_patch->>'frequency' not in ('daily','alternate','5on2off','weekdays') then
      raise exception 'Frequencia invalida';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object('frequency',p_patch->>'frequency');
  end if;
  if p_patch ? 'weekdays' then
    if jsonb_typeof(p_patch->'weekdays') is distinct from 'array'
      or exists(select 1 from jsonb_array_elements(p_patch->'weekdays') item
        where jsonb_typeof(item) is distinct from 'number'
          or item::text !~ '^[0-9]+$'
          or (item::text)::numeric<0 or (item::text)::numeric>6) then
      raise exception 'Dias da semana invalidos';
    end if;
    select coalesce(array_agg(distinct (item::text)::integer order by (item::text)::integer),
      '{}'::integer[]) into canonical_weekdays
    from jsonb_array_elements(p_patch->'weekdays') item;
    normalized_patch:=normalized_patch||jsonb_build_object('weekdays',canonical_weekdays);
  end if;
  if p_patch ? 'start_date' then
    if jsonb_typeof(p_patch->'start_date') is distinct from 'string'
      or (p_patch->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data inicial invalida';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object(
      'start_date',(p_patch->>'start_date')::date);
  end if;
  if p_patch ? 'time_of_day' then
    if jsonb_typeof(p_patch->'time_of_day') not in ('string','null')
      or (jsonb_typeof(p_patch->'time_of_day')='string' and
        (p_patch->>'time_of_day') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$') then
      raise exception 'Horario invalido';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object('time_of_day',
      case when jsonb_typeof(p_patch->'time_of_day')='null' then null
        else (p_patch->>'time_of_day')::time end);
  end if;
  if p_patch ? 'refill_at' then
    if jsonb_typeof(p_patch->'refill_at') is distinct from 'number'
      or (p_patch->>'refill_at') !~ '^[0-9]+$'
      or (p_patch->>'refill_at')::numeric not in (2,3,4,5) then
      raise exception 'Alerta de reposicao invalido';
    end if;
    normalized_patch:=normalized_patch||jsonb_build_object(
      'refill_at',(p_patch->>'refill_at')::integer);
  end if;

  intent:=jsonb_build_object(
    'mutation','update','entity_type','routine','entity_id',p_routine_id,
    'new_routine_version_id',p_new_routine_version_id,
    'expected_version',p_expected_version,'base',p_base,'patch',normalized_patch
  );
  fingerprint:=intent;

  -- Ordem global: profile -> ledger/operacao -> routine -> vials por UUID.
  perform 1 from public.profiles where id=u for update;
  if not found then raise exception 'Conta nao inicializada'; end if;
  if auth.uid() is distinct from u or p_expected_user is distinct from auth.uid() then
    raise exception 'Conta alterada durante a operacao';
  end if;

  select * into op from public.domain_mutation_operations
    where user_id=u and operation_id=p_operation_id for update;
  if found then
    if op.intent_fingerprint is distinct from fingerprint then
      raise exception 'UUID de operacao reutilizado com intencao diferente';
    end if;
    return jsonb_set(op.result,'{replay}','true'::jsonb,false);
  end if;

  -- Replay acima independe de entitlement futuro; operacao nova usa a autoridade atual.
  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessario' using errcode='42501';
  end if;

  select * into current_routine from public.routines
    where user_id=u and id=p_routine_id for update;
  if not found then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ROUTINE_NOT_AVAILABLE',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',null,
      'base',p_base,'local',p_base||normalized_patch,'remote',null,
      'routine_version_id',null,'snapshot',null
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'conflict',result);
    return result;
  end if;

  remote_snapshot:=public.pepday_routine_snapshot(current_routine);
  local_snapshot:=p_base||normalized_patch;
  if current_routine.deleted_at is not null then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ENTITY_DELETED',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',null,'snapshot',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'conflict',result);
    return result;
  end if;
  if current_routine.version is distinct from p_expected_version then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','STALE_VERSION',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',null,'snapshot',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'conflict',result);
    return result;
  end if;

  target_vial_id:=case when normalized_patch ? 'vial_id'
    then (normalized_patch->>'vial_id')::uuid else current_routine.vial_id end;
  target_name:=case when normalized_patch ? 'name'
    then normalized_patch->>'name' else current_routine.name end;
  target_dose_value:=case when normalized_patch ? 'dose_value'
    then (normalized_patch->>'dose_value')::numeric else current_routine.dose_value end;
  target_dose_unit:=case when normalized_patch ? 'dose_unit'
    then normalized_patch->>'dose_unit' else current_routine.dose_unit end;
  target_syringe_capacity:=case when normalized_patch ? 'syringe_capacity'
    then (normalized_patch->>'syringe_capacity')::integer else current_routine.syringe_capacity end;
  target_frequency:=case when normalized_patch ? 'frequency'
    then normalized_patch->>'frequency' else current_routine.frequency end;
  select coalesce(array_agg(distinct day order by day),'{}'::integer[])
    into current_canonical_weekdays from unnest(current_routine.weekdays) day;
  target_weekdays:=case when normalized_patch ? 'weekdays'
    then array(select jsonb_array_elements_text(normalized_patch->'weekdays')::integer)
    else current_canonical_weekdays end;
  target_start_date:=case when normalized_patch ? 'start_date'
    then (normalized_patch->>'start_date')::date else current_routine.start_date end;
  target_time_of_day:=case when normalized_patch ? 'time_of_day'
    then case when jsonb_typeof(normalized_patch->'time_of_day')='null' then null
      else (normalized_patch->>'time_of_day')::time end else current_routine.time_of_day end;
  target_refill_at:=case when normalized_patch ? 'refill_at'
    then (normalized_patch->>'refill_at')::integer else current_routine.refill_at end;

  if target_frequency='weekdays' and cardinality(target_weekdays)=0 then
    raise exception 'Dias da semana obrigatorios para esta frequencia';
  end if;

  -- Mesmo quando o resultado sera no-op, Frasco atual/novo e ownership sao validados.
  perform 1 from public.vials v
    where v.user_id=u and v.id in (current_routine.vial_id,target_vial_id)
    order by v.id for update;
  if not exists(select 1 from public.vials v where v.user_id=u
      and v.id=current_routine.vial_id and v.active and v.deleted_at is null)
    or not exists(select 1 from public.vials v where v.user_id=u
      and v.id=target_vial_id and v.active and v.deleted_at is null) then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','VIAL_NOT_AVAILABLE',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',null,'snapshot',remote_snapshot,
      'current_vial_id',current_routine.vial_id,'requested_vial_id',target_vial_id
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'conflict',result);
    return result;
  end if;

  semantic_change:=target_vial_id is distinct from current_routine.vial_id
    or target_name is distinct from current_routine.name
    or target_dose_value is distinct from current_routine.dose_value
    or target_dose_unit is distinct from current_routine.dose_unit
    or target_syringe_capacity is distinct from current_routine.syringe_capacity
    or target_frequency is distinct from current_routine.frequency
    or target_weekdays is distinct from current_canonical_weekdays
    or target_start_date is distinct from current_routine.start_date
    or target_time_of_day is distinct from current_routine.time_of_day
    or target_refill_at is distinct from current_routine.refill_at;

  if not semantic_change then
    select rv.id into current_routine_version_id from public.routine_versions rv
      where rv.user_id=u and rv.routine_id=p_routine_id
        and rv.version=current_routine.version;
    result:=jsonb_build_object(
      'outcome','success','replay',false,'no_op',true,
      'entity_type','routine','entity_id',p_routine_id,
      'version',current_routine.version,
      'routine_version_id',current_routine_version_id,
      'snapshot',remote_snapshot,'routine',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'success',result);
    return result;
  end if;

  if exists(select 1 from public.routine_versions
      where id=p_new_routine_version_id) then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ROUTINE_VERSION_ID_UNAVAILABLE',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',p_new_routine_version_id,'snapshot',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'conflict',result);
    return result;
  end if;

  if auth.uid() is distinct from u or p_expected_user is distinct from auth.uid() then
    raise exception 'Conta alterada durante a operacao';
  end if;
  update public.routines set
    vial_id=target_vial_id,name=target_name,dose_value=target_dose_value,
    dose_unit=target_dose_unit,syringe_capacity=target_syringe_capacity,
    frequency=target_frequency,weekdays=target_weekdays,start_date=target_start_date,
    time_of_day=target_time_of_day,refill_at=target_refill_at,
    version=version+1,updated_at=statement_timestamp()
    where user_id=u and id=p_routine_id and version=p_expected_version
    returning * into updated_routine;
  if not found then
    raise exception 'Versao da Rotina mudou durante a operacao';
  end if;

  confirmed_snapshot:=public.pepday_routine_snapshot(updated_routine);
  insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  values(p_new_routine_version_id,u,p_routine_id,updated_routine.version,confirmed_snapshot);

  result:=jsonb_build_object(
    'outcome','success','replay',false,'no_op',false,
    'entity_type','routine','entity_id',p_routine_id,
    'version',updated_routine.version,
    'routine_version_id',p_new_routine_version_id,
    'snapshot',confirmed_snapshot,'routine',confirmed_snapshot
  );
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values(u,p_operation_id,'routine',p_routine_id,'update',fingerprint,'success',result);
  return result;
end $$;

revoke all on function public.update_routine_versioned(
  uuid,uuid,uuid,uuid,bigint,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.update_routine_versioned(
  uuid,uuid,uuid,uuid,bigint,jsonb,jsonb
) to authenticated;

commit;
