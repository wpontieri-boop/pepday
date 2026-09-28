-- PepDay V3.0 / Bloco B2.2-D3. Aplicar uma vez, somente em pepday-v3-test.
-- Ajuste manual de saldo como evento histórico atômico/idempotente.
begin;

alter table public.domain_mutation_operations
  drop constraint domain_mutation_operations_mutation_type_check;
alter table public.domain_mutation_operations
  add constraint domain_mutation_operations_mutation_type_check
  check(mutation_type in ('create','update','soft_delete','adjustment')) not valid;
alter table public.domain_mutation_operations
  validate constraint domain_mutation_operations_mutation_type_check;

create function public.adjust_vial_balance_versioned(
  p_operation_id uuid,
  p_expected_user uuid,
  p_vial_id uuid,
  p_expected_balance numeric,
  p_new_balance numeric
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); entitlement jsonb; op public.domain_mutation_operations;
  current_vial public.vials; updated public.vials; movement public.vial_movements;
  fingerprint jsonb; remote_snapshot jsonb; result jsonb; delta numeric;
begin
  if u is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_expected_user is distinct from u then raise exception 'Conta alterada durante a operação'; end if;
  if p_operation_id is null or p_vial_id is null or p_expected_balance is null
    or p_new_balance is null or p_expected_balance<0 or p_new_balance<0
    or p_expected_balance>=1000000000 or p_new_balance>=1000000000 then
    raise exception 'Intenção de ajuste inválida';
  end if;

  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;

  fingerprint:=jsonb_build_object(
    'mutation','adjustment','entity_type','vial','entity_id',p_vial_id,
    'expected_balance',p_expected_balance,'new_balance',p_new_balance
  );

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

  if current_vial.deleted_at is not null then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','ENTITY_DELETED',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_balance',p_expected_balance,'remote_balance',current_vial.remaining_mg,
      'remote',remote_snapshot
    );
    insert into public.domain_mutation_operations(
      user_id,operation_id,entity_type,entity_id,mutation_type,intent_fingerprint,outcome,result
    ) values(u,p_operation_id,'vial',p_vial_id,'adjustment',fingerprint,'conflict',result);
    return result;
  end if;

  if current_vial.remaining_mg is distinct from p_expected_balance then
    result:=jsonb_build_object(
      'outcome','conflict','replay',false,'code','STALE_BALANCE',
      'entity_type','vial','entity_id',p_vial_id,
      'expected_balance',p_expected_balance,'remote_balance',current_vial.remaining_mg,
      'remote',remote_snapshot
    );
    insert into public.domain_mutation_operations(
      user_id,operation_id,entity_type,entity_id,mutation_type,intent_fingerprint,outcome,result
    ) values(u,p_operation_id,'vial',p_vial_id,'adjustment',fingerprint,'conflict',result);
    return result;
  end if;

  if p_new_balance>current_vial.initial_mg then
    raise exception 'Saldo ajustado não pode exceder a quantidade inicial';
  end if;
  if p_new_balance is not distinct from current_vial.remaining_mg then
    result:=jsonb_build_object(
      'outcome','success','replay',false,'entity_type','vial','entity_id',p_vial_id,
      'vial',remote_snapshot,'movement',null
    );
    insert into public.domain_mutation_operations(
      user_id,operation_id,entity_type,entity_id,mutation_type,intent_fingerprint,outcome,result
    ) values(u,p_operation_id,'vial',p_vial_id,'adjustment',fingerprint,'success',result);
    return result;
  end if;

  delta:=p_new_balance-current_vial.remaining_mg;
  update public.vials set
    remaining_mg=p_new_balance,
    version=version+1,
    updated_at=statement_timestamp()
    where user_id=u and id=p_vial_id
    returning * into updated;

  insert into public.vial_movements(
    user_id,operation_id,vial_id,application_id,kind,
    delta_mg,balance_before,balance_after
  ) values(
    u,p_operation_id,p_vial_id,null,'adjustment',
    delta,current_vial.remaining_mg,p_new_balance
  ) returning * into movement;

  result:=jsonb_build_object(
    'outcome','success','replay',false,'entity_type','vial','entity_id',p_vial_id,
    'vial',public.pepday_vial_snapshot(updated),'movement',to_jsonb(movement)
  );
  insert into public.domain_mutation_operations(
    user_id,operation_id,entity_type,entity_id,mutation_type,intent_fingerprint,outcome,result
  ) values(u,p_operation_id,'vial',p_vial_id,'adjustment',fingerprint,'success',result);
  return result;
end $$;

revoke all on function public.adjust_vial_balance_versioned(uuid,uuid,uuid,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.adjust_vial_balance_versioned(uuid,uuid,uuid,numeric,numeric)
  to authenticated;

commit;
