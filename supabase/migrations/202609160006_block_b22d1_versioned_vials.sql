-- PepDay V3.0 / Bloco B2.2-D1. Aplicar uma vez, somente em pepday-v3-test.
-- CRUD versionado de Frascos. Não altera as RPCs transacionais da B2.1.
begin;

alter table public.vials
  add column edit_version bigint not null default 1 check (edit_version>0);

create table public.domain_mutation_operations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('vial')),
  entity_id uuid not null,
  mutation_type text not null check (mutation_type in ('create','update','soft_delete')),
  -- JSONB fornece ordenação canônica de chaves e igualdade semântica de números.
  intent_fingerprint jsonb not null,
  outcome text not null check (outcome in ('success','conflict')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
create index domain_mutation_operations_entity
  on public.domain_mutation_operations(user_id,entity_type,entity_id,created_at);

alter table public.domain_mutation_operations enable row level security;
revoke all on public.domain_mutation_operations from public,anon,authenticated;

-- Snapshot canônico: saldo é retornado pela autoridade remota, mas jamais aceito
-- como campo editável pelas RPCs de update/delete.
create function public.pepday_vial_snapshot(p_vial public.vials) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',p_vial.id,
    'user_id',p_vial.user_id,
    'name',p_vial.name,
    'initial_mg',p_vial.initial_mg,
    'remaining_mg',p_vial.remaining_mg,
    'water_ml',p_vial.water_ml,
    'concentration',p_vial.concentration,
    'prepared_on',p_vial.prepared_on,
    'cost',p_vial.cost,
    'active',p_vial.active,
    'version',p_vial.version,
    'edit_version',p_vial.edit_version,
    'created_at',p_vial.created_at,
    'updated_at',p_vial.updated_at,
    'deleted_at',p_vial.deleted_at
  )
$$;
revoke all on function public.pepday_vial_snapshot(public.vials) from public,anon,authenticated;

create function public.create_vial_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_vial_id uuid,
  p_name text,
  p_initial_mg numeric,
  p_water_ml numeric,
  p_prepared_on date,
  p_cost numeric default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); entitlement jsonb; op public.domain_mutation_operations;
  existing public.vials; created public.vials; intent jsonb; fingerprint jsonb;
  local_snapshot jsonb; result jsonb;
begin
  if u is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_expected_user is distinct from u then raise exception 'Conta alterada durante a operação'; end if;
  if p_operation_id is null or p_vial_id is null then raise exception 'Intenção incompleta'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 200
    or p_initial_mg is null or p_initial_mg<=0 or p_initial_mg>=1000000000
    or p_water_ml is null or p_water_ml<=0 or p_water_ml>=1000000000
    or p_prepared_on is null
    or (p_cost is not null and (p_cost<0 or p_cost>=1000000000)) then
    raise exception 'Frasco inválido';
  end if;
  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;

  local_snapshot:=jsonb_build_object('id',p_vial_id,'user_id',u,'name',trim(p_name),
    'initial_mg',p_initial_mg,'remaining_mg',p_initial_mg,'water_ml',p_water_ml,
    'prepared_on',p_prepared_on,'cost',p_cost,'active',true,'edit_version',1);
  intent:=jsonb_build_object('mutation','create','entity_type','vial','entity_id',p_vial_id,
    'local',local_snapshot);
  fingerprint:=intent;

  -- Lock de conta serializa creates mesmo sem linha de Frasco existente.
  perform 1 from public.profiles where id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;

  select * into op from public.domain_mutation_operations
    where user_id=u and operation_id=p_operation_id;
  if found then
    if op.intent_fingerprint is distinct from fingerprint then
      raise exception 'UUID de operação reutilizado com intenção diferente';
    end if;
    return jsonb_set(op.result,'{replay}','true'::jsonb,false);
  end if;

  select * into existing from public.vials where id=p_vial_id;
  if found then
    if existing.user_id is distinct from u then
      raise exception 'Identificador de Frasco indisponível';
    end if;
    result:=jsonb_build_object('outcome','conflict','replay',false,
      'code','ENTITY_ALREADY_EXISTS','entity_type','vial','entity_id',p_vial_id,
      'expected_version',0,'remote_version',existing.edit_version,
      'base',null,'local',local_snapshot,'remote',public.pepday_vial_snapshot(existing));
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'vial',p_vial_id,'create',fingerprint,'conflict',result);
    return result;
  end if;

  insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on,cost,
    active,version,edit_version)
  values(p_vial_id,u,trim(p_name),p_initial_mg,p_initial_mg,p_water_ml,p_prepared_on,p_cost,
    true,1,1) returning * into created;
  result:=jsonb_build_object('outcome','success','replay',false,'entity_type','vial',
    'entity_id',p_vial_id,'vial',public.pepday_vial_snapshot(created));
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values(u,p_operation_id,'vial',p_vial_id,'create',fingerprint,'success',result);
  return result;
end $$;
revoke all on function public.create_vial_versioned(uuid,uuid,uuid,text,numeric,numeric,date,numeric)
  from public,anon,authenticated;
grant execute on function public.create_vial_versioned(uuid,uuid,uuid,text,numeric,numeric,date,numeric)
  to authenticated;

create function public.update_vial_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_vial_id uuid,
  p_expected_edit_version bigint,
  p_base jsonb,
  p_patch jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); entitlement jsonb; op public.domain_mutation_operations;
  current_vial public.vials; updated public.vials; intent jsonb; fingerprint jsonb;
  remote_snapshot jsonb; local_snapshot jsonb; result jsonb; has_movement boolean;
begin
  if u is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_expected_user is distinct from u then raise exception 'Conta alterada durante a operação'; end if;
  if p_operation_id is null or p_vial_id is null or p_expected_edit_version is null
    or p_expected_edit_version<1 then raise exception 'Intenção incompleta'; end if;
  if jsonb_typeof(p_base) is distinct from 'object' or jsonb_typeof(p_patch) is distinct from 'object'
    or octet_length(p_base::text)>65536 or octet_length(p_patch::text)>65536 then
    raise exception 'Snapshot ou alteração inválida';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) key
    where key not in ('name','cost','prepared_on','active','initial_mg','water_ml')) then
    raise exception 'Campo não permitido na edição de Frasco';
  end if;
  if p_patch ? 'name' and (jsonb_typeof(p_patch->'name') is distinct from 'string'
    or length(trim(p_patch->>'name')) not between 1 and 200) then raise exception 'Nome inválido'; end if;
  if p_patch ? 'cost' and jsonb_typeof(p_patch->'cost') not in ('number','null') then raise exception 'Custo inválido'; end if;
  if p_patch ? 'cost' and jsonb_typeof(p_patch->'cost')='number'
    and ((p_patch->>'cost')::numeric<0 or (p_patch->>'cost')::numeric>=1000000000) then raise exception 'Custo inválido'; end if;
  if p_patch ? 'prepared_on' and (jsonb_typeof(p_patch->'prepared_on') is distinct from 'string'
    or coalesce(p_patch->>'prepared_on','') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Data inválida'; end if;
  if p_patch ? 'active' and jsonb_typeof(p_patch->'active') is distinct from 'boolean' then raise exception 'Status inválido'; end if;
  if p_patch ? 'active' and (p_patch->>'active')::boolean is not true then
    raise exception 'Use a operação de inativação do Frasco';
  end if;
  if p_patch ? 'initial_mg' and (jsonb_typeof(p_patch->'initial_mg') is distinct from 'number'
    or (p_patch->>'initial_mg')::numeric<=0 or (p_patch->>'initial_mg')::numeric>=1000000000) then raise exception 'Quantidade inicial inválida'; end if;
  if p_patch ? 'water_ml' and (jsonb_typeof(p_patch->'water_ml') is distinct from 'number'
    or (p_patch->>'water_ml')::numeric<=0 or (p_patch->>'water_ml')::numeric>=1000000000) then raise exception 'Diluente inválido'; end if;

  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;
  intent:=jsonb_build_object('mutation','update','entity_type','vial','entity_id',p_vial_id,
    'expected_edit_version',p_expected_edit_version,'base',p_base,'patch',p_patch);
  fingerprint:=intent;

  perform 1 from public.profiles where id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;
  select * into op from public.domain_mutation_operations
    where user_id=u and operation_id=p_operation_id;
  if found then
    if op.intent_fingerprint is distinct from fingerprint then
      raise exception 'UUID de operação reutilizado com intenção diferente';
    end if;
    return jsonb_set(op.result,'{replay}','true'::jsonb,false);
  end if;

  select * into current_vial from public.vials
    where user_id=u and id=p_vial_id for update;
  if not found then raise exception 'Frasco não encontrado'; end if;
  remote_snapshot:=public.pepday_vial_snapshot(current_vial);
  local_snapshot:=p_base||p_patch;
  if current_vial.edit_version is distinct from p_expected_edit_version then
    result:=jsonb_build_object('outcome','conflict','replay',false,'code','STALE_VERSION',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_version',p_expected_edit_version,'remote_version',current_vial.edit_version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot);
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'vial',p_vial_id,'update',fingerprint,'conflict',result);
    return result;
  end if;
  if current_vial.deleted_at is not null then
    result:=jsonb_build_object('outcome','conflict','replay',false,'code','ENTITY_DELETED',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_version',p_expected_edit_version,'remote_version',current_vial.edit_version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot);
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'vial',p_vial_id,'update',fingerprint,'conflict',result);
    return result;
  end if;

  select exists(select 1 from public.vial_movements
    where user_id=u and vial_id=p_vial_id) into has_movement;
  if has_movement and ((p_patch ? 'initial_mg' and (p_patch->>'initial_mg')::numeric is distinct from current_vial.initial_mg)
    or (p_patch ? 'water_ml' and (p_patch->>'water_ml')::numeric is distinct from current_vial.water_ml)) then
    raise exception 'Apresentação e diluição não podem mudar após o primeiro movimento';
  end if;
  if p_patch ? 'initial_mg' and (p_patch->>'initial_mg')::numeric<current_vial.remaining_mg then
    raise exception 'Quantidade inicial não pode ser menor que o saldo atual';
  end if;

  update public.vials set
    name=case when p_patch ? 'name' then trim(p_patch->>'name') else name end,
    cost=case when p_patch ? 'cost' then case when jsonb_typeof(p_patch->'cost')='null' then null else (p_patch->>'cost')::numeric end else cost end,
    prepared_on=case when p_patch ? 'prepared_on' then (p_patch->>'prepared_on')::date else prepared_on end,
    active=case when p_patch ? 'active' then (p_patch->>'active')::boolean else active end,
    initial_mg=case when p_patch ? 'initial_mg' then (p_patch->>'initial_mg')::numeric else initial_mg end,
    water_ml=case when p_patch ? 'water_ml' then (p_patch->>'water_ml')::numeric else water_ml end,
    version=version+1,edit_version=edit_version+1,updated_at=statement_timestamp()
    where user_id=u and id=p_vial_id returning * into updated;
  result:=jsonb_build_object('outcome','success','replay',false,'entity_type','vial',
    'entity_id',p_vial_id,'vial',public.pepday_vial_snapshot(updated));
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values(u,p_operation_id,'vial',p_vial_id,'update',fingerprint,'success',result);
  return result;
end $$;
revoke all on function public.update_vial_versioned(uuid,uuid,uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.update_vial_versioned(uuid,uuid,uuid,bigint,jsonb,jsonb)
  to authenticated;

create function public.soft_delete_vial_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_vial_id uuid,
  p_expected_edit_version bigint,
  p_base jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); entitlement jsonb; op public.domain_mutation_operations;
  current_vial public.vials; deleted_vial public.vials; intent jsonb; fingerprint jsonb;
  remote_snapshot jsonb; local_snapshot jsonb; result jsonb;
begin
  if u is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_expected_user is distinct from u then raise exception 'Conta alterada durante a operação'; end if;
  if p_operation_id is null or p_vial_id is null or p_expected_edit_version is null
    or p_expected_edit_version<1 then raise exception 'Intenção incompleta'; end if;
  if jsonb_typeof(p_base) is distinct from 'object' or octet_length(p_base::text)>65536 then
    raise exception 'Snapshot inválido';
  end if;
  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;
  intent:=jsonb_build_object('mutation','soft_delete','entity_type','vial','entity_id',p_vial_id,
    'expected_edit_version',p_expected_edit_version,'base',p_base);
  fingerprint:=intent;

  -- Futuras RPCs de Rotina devem adquirir este mesmo lock de conta antes do
  -- lock do Frasco; isso fecha criação/ativação de Rotina x inativação do Frasco.
  perform 1 from public.profiles where id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;
  select * into op from public.domain_mutation_operations
    where user_id=u and operation_id=p_operation_id;
  if found then
    if op.intent_fingerprint is distinct from fingerprint then
      raise exception 'UUID de operação reutilizado com intenção diferente';
    end if;
    return jsonb_set(op.result,'{replay}','true'::jsonb,false);
  end if;

  select * into current_vial from public.vials
    where user_id=u and id=p_vial_id for update;
  if not found then raise exception 'Frasco não encontrado'; end if;
  remote_snapshot:=public.pepday_vial_snapshot(current_vial);
  local_snapshot:=p_base||jsonb_build_object('active',false);
  if current_vial.edit_version is distinct from p_expected_edit_version then
    result:=jsonb_build_object('outcome','conflict','replay',false,'code','STALE_VERSION',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_version',p_expected_edit_version,'remote_version',current_vial.edit_version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot);
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'vial',p_vial_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end if;
  if current_vial.deleted_at is not null then
    result:=jsonb_build_object('outcome','conflict','replay',false,'code','ENTITY_DELETED',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_version',p_expected_edit_version,'remote_version',current_vial.edit_version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot);
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'vial',p_vial_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end if;
  if exists(select 1 from public.routines where user_id=u and vial_id=p_vial_id
    and status='active' and deleted_at is null) then
    result:=jsonb_build_object('outcome','conflict','replay',false,'code','ACTIVE_ROUTINE_DEPENDENCY',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_version',p_expected_edit_version,'remote_version',current_vial.edit_version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot);
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'vial',p_vial_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end if;

  update public.vials set active=false,deleted_at=statement_timestamp(),
    version=version+1,edit_version=edit_version+1,updated_at=statement_timestamp()
    where user_id=u and id=p_vial_id returning * into deleted_vial;
  result:=jsonb_build_object('outcome','success','replay',false,'entity_type','vial',
    'entity_id',p_vial_id,'vial',public.pepday_vial_snapshot(deleted_vial));
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values(u,p_operation_id,'vial',p_vial_id,'soft_delete',fingerprint,'success',result);
  return result;
end $$;
revoke all on function public.soft_delete_vial_versioned(uuid,uuid,uuid,bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.soft_delete_vial_versioned(uuid,uuid,uuid,bigint,jsonb)
  to authenticated;

commit;
