-- PepDay V3.0 / Bloco B2.2-D2-B. Aplicar uma vez, somente em pepday-v3-test.
-- Criação versionada de Rotinas. Não implementa update nem soft-delete.
begin;

create function public.create_routine_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_routine_id uuid,
  p_routine_version_id uuid,
  p_vial_id uuid,
  p_name text,
  p_dose_value numeric,
  p_dose_unit text,
  p_syringe_capacity integer,
  p_frequency text,
  p_weekdays integer[],
  p_start_date date,
  p_time_of_day time,
  p_refill_at integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  entitlement jsonb;
  op public.domain_mutation_operations;
  existing public.routines;
  available_vial public.vials;
  created public.routines;
  canonical_weekdays integer[];
  local_snapshot jsonb;
  intent jsonb;
  fingerprint jsonb;
  confirmed_snapshot jsonb;
  result jsonb;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;
  if p_expected_user is distinct from u then
    raise exception 'Conta alterada durante a operação';
  end if;
  if p_operation_id is null or p_routine_id is null or p_routine_version_id is null
    or p_vial_id is null or p_start_date is null or p_weekdays is null then
    raise exception 'Intenção incompleta';
  end if;

  select coalesce(array_agg(distinct day order by day),'{}'::integer[])
    into canonical_weekdays from unnest(p_weekdays) day;
  if p_name is null or length(trim(p_name)) not between 1 and 200
    or p_dose_value is null or p_dose_value<=0 or p_dose_value>=1000000000
    or p_dose_unit is null or p_dose_unit not in ('mg','mcg')
    or p_syringe_capacity is null or p_syringe_capacity not in (30,50,100)
    or p_frequency is null or p_frequency not in ('daily','alternate','5on2off','weekdays')
    or exists(select 1 from unnest(canonical_weekdays) day
      where day is null or day<0 or day>6)
    or (p_frequency='weekdays' and cardinality(canonical_weekdays)=0)
    or p_refill_at is null or p_refill_at not in (2,3,4,5) then
    raise exception 'Rotina inválida';
  end if;

  local_snapshot:=jsonb_build_object(
    'id',p_routine_id,
    'user_id',u,
    'vial_id',p_vial_id,
    'name',trim(p_name),
    'dose_value',p_dose_value,
    'dose_unit',p_dose_unit,
    'syringe_capacity',p_syringe_capacity,
    'frequency',p_frequency,
    'weekdays',to_jsonb(canonical_weekdays),
    'start_date',p_start_date,
    'time_of_day',p_time_of_day,
    'refill_at',p_refill_at,
    'status','active',
    'version',1,
    'deleted_at',null
  );
  intent:=jsonb_build_object(
    'mutation','create',
    'entity_type','routine',
    'entity_id',p_routine_id,
    'routine_version_id',p_routine_version_id,
    'local',local_snapshot
  );
  fingerprint:=intent;

  -- Ordem global: conta; ledger/operação; Frasco. Compatível com D1.
  perform 1 from public.profiles where id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;
  if auth.uid() is distinct from u or p_expected_user is distinct from auth.uid() then
    raise exception 'Conta alterada durante a operação';
  end if;

  select * into op from public.domain_mutation_operations
    where user_id=u and operation_id=p_operation_id;
  if found then
    if op.intent_fingerprint is distinct from fingerprint then
      raise exception 'UUID de operação reutilizado com intenção diferente';
    end if;
    return jsonb_set(op.result,'{replay}','true'::jsonb,false);
  end if;

  -- Replay não repete a mutação nem depende de acesso comercial futuro. Uma
  -- operação nova, porém, sempre consulta a autoridade de entitlement vigente.
  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;

  select * into existing from public.routines where id=p_routine_id;
  if found then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ENTITY_ALREADY_EXISTS',
      'entity_type','routine','entity_id',p_routine_id,'version',1,
      'routine_version_id',p_routine_version_id,'snapshot',null,
      'local',local_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'create',fingerprint,'conflict',result);
    return result;
  end if;

  if exists(select 1 from public.routine_versions where id=p_routine_version_id) then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ROUTINE_VERSION_ID_UNAVAILABLE',
      'entity_type','routine','entity_id',p_routine_id,'version',1,
      'routine_version_id',p_routine_version_id,'snapshot',null,
      'local',local_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'create',fingerprint,'conflict',result);
    return result;
  end if;

  select * into available_vial from public.vials
    where user_id=u and id=p_vial_id and active and deleted_at is null
    for update;
  if not found then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','VIAL_NOT_AVAILABLE',
      'entity_type','routine','entity_id',p_routine_id,'version',1,
      'routine_version_id',p_routine_version_id,'snapshot',null,
      'local',local_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'create',fingerprint,'conflict',result);
    return result;
  end if;

  insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
    frequency,weekdays,start_date,time_of_day,refill_at,status,version,deleted_at)
  values(p_routine_id,u,p_vial_id,trim(p_name),p_dose_value,p_dose_unit,p_syringe_capacity,
    p_frequency,canonical_weekdays,p_start_date,p_time_of_day,p_refill_at,'active',1,null)
  returning * into created;

  confirmed_snapshot:=public.pepday_routine_snapshot(created);
  insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  values(p_routine_version_id,u,p_routine_id,1,confirmed_snapshot);

  result:=jsonb_build_object(
    'outcome','success','replay',false,'entity_type','routine',
    'entity_id',p_routine_id,'version',1,
    'routine_version_id',p_routine_version_id,
    'snapshot',confirmed_snapshot,'routine',confirmed_snapshot
  );
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values(u,p_operation_id,'routine',p_routine_id,'create',fingerprint,'success',result);
  return result;
end $$;

revoke all on function public.create_routine_versioned(
  uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time,integer
) from public,anon,authenticated;
grant execute on function public.create_routine_versioned(
  uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time,integer
) to authenticated;

commit;
