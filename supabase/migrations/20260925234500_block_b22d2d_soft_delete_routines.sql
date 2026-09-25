-- PepDay V3.0 / Bloco B2.2-D2-D. Aplicar uma vez, somente em pepday-v3-test.
-- Soft-delete versionado de Rotinas. Nao altera Frascos, Applications ou historico.
begin;

create function public.soft_delete_routine_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_routine_id uuid,
  p_new_routine_version_id uuid,
  p_expected_version bigint,
  p_base jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  entitlement jsonb;
  op public.domain_mutation_operations;
  current_routine public.routines;
  deleted_routine public.routines;
  intent jsonb;
  fingerprint jsonb;
  remote_snapshot jsonb;
  local_snapshot jsonb;
  confirmed_snapshot jsonb;
  result jsonb;
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
    or octet_length(p_base::text)>65536 then
    raise exception 'Snapshot invalido';
  end if;

  intent:=jsonb_build_object(
    'mutation','soft_delete','entity_type','routine','entity_id',p_routine_id,
    'new_routine_version_id',p_new_routine_version_id,
    'expected_version',p_expected_version,'base',p_base
  );
  fingerprint:=intent;
  local_snapshot:=p_base||jsonb_build_object(
    'status','inactive',
    'deleted_at',jsonb_build_object('$intent','server_statement_timestamp')
  );

  -- Ordem global D2: profile -> ledger/operacao -> routine. Nao ha lock de Frasco.
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
      'base',p_base,'local',local_snapshot,'remote',null,
      'routine_version_id',p_new_routine_version_id,'snapshot',null
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end if;

  remote_snapshot:=public.pepday_routine_snapshot(current_routine);
  if current_routine.deleted_at is not null then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ENTITY_DELETED',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',p_new_routine_version_id,'snapshot',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end if;
  if current_routine.version is distinct from p_expected_version then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','STALE_VERSION',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',p_new_routine_version_id,'snapshot',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'soft_delete',fingerprint,'conflict',result);
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
    values(u,p_operation_id,'routine',p_routine_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end if;

  if auth.uid() is distinct from u or p_expected_user is distinct from auth.uid() then
    raise exception 'Conta alterada durante a operacao';
  end if;

  -- A subtransacao converte colisao concorrente do UUID da versao em conflito
  -- estavel e desfaz o UPDATE antes de registrar o resultado no ledger.
  begin
    update public.routines set
      status='inactive',deleted_at=statement_timestamp(),
      version=version+1,updated_at=statement_timestamp()
      where user_id=u and id=p_routine_id and version=p_expected_version
        and deleted_at is null
      returning * into deleted_routine;
    if not found then
      raise exception 'Versao da Rotina mudou durante a operacao';
    end if;

    confirmed_snapshot:=public.pepday_routine_snapshot(deleted_routine);
    insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
    values(p_new_routine_version_id,u,p_routine_id,deleted_routine.version,confirmed_snapshot);
  exception when unique_violation then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ROUTINE_VERSION_ID_UNAVAILABLE',
      'entity_type','routine','entity_id',p_routine_id,
      'expected_version',p_expected_version,'remote_version',current_routine.version,
      'base',p_base,'local',local_snapshot,'remote',remote_snapshot,
      'routine_version_id',p_new_routine_version_id,'snapshot',remote_snapshot
    );
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values(u,p_operation_id,'routine',p_routine_id,'soft_delete',fingerprint,'conflict',result);
    return result;
  end;

  result:=jsonb_build_object(
    'outcome','success','replay',false,
    'entity_type','routine','entity_id',p_routine_id,
    'version',deleted_routine.version,
    'routine_version_id',p_new_routine_version_id,
    'snapshot',confirmed_snapshot,'routine',confirmed_snapshot
  );
  insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
    mutation_type,intent_fingerprint,outcome,result)
  values(u,p_operation_id,'routine',p_routine_id,'soft_delete',fingerprint,'success',result);
  return result;
end $$;

revoke all on function public.soft_delete_routine_versioned(
  uuid,uuid,uuid,uuid,bigint,jsonb
) from public,anon,authenticated;
grant execute on function public.soft_delete_routine_versioned(
  uuid,uuid,uuid,uuid,bigint,jsonb
) to authenticated;

commit;
