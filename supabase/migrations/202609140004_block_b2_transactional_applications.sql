-- PepDay V3.0 / Bloco B2.1. Aplicar uma vez, somente em pepday-v3-test.
-- Operações históricas: aplicação, movimento, saldo e undo atômicos/idempotentes.
begin;

alter table public.vial_movements
  add constraint vial_movements_application_link check (
    (kind in ('application','undo') and application_id is not null)
    or (kind not in ('application','undo') and application_id is null)
  ),
  add constraint vial_movements_delta_direction check (
    (kind='application' and delta_mg<0)
    or (kind='undo' and delta_mg>0)
    or kind not in ('application','undo')
  );

create unique index vial_movements_one_application
  on public.vial_movements(user_id,application_id) where kind='application';
create unique index vial_movements_one_undo
  on public.vial_movements(user_id,application_id) where kind='undo';

create function public.register_application(
  p_operation_id uuid,
  p_expected_user uuid,
  p_routine_id uuid,
  p_routine_version_id uuid,
  p_vial_id uuid,
  p_scheduled_date date,
  p_applied_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); stamp timestamptz:=statement_timestamp();
  entitlement jsonb; a public.applications; m public.vial_movements;
  r public.routines; rv public.routine_versions; v public.vials;
  original_value numeric; original_unit text; normalized_mg numeric;
  used_concentration numeric; used_volume numeric; used_ui numeric; capacity integer;
  before_balance numeric; after_balance numeric;
begin
  if u is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_expected_user is distinct from u then raise exception 'Conta alterada durante a operação'; end if;
  if p_operation_id is null or p_routine_id is null or p_routine_version_id is null
    or p_vial_id is null or p_scheduled_date is null then raise exception 'Intenção incompleta'; end if;
  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;

  select * into a from public.applications where user_id=u and operation_id=p_operation_id;
  if found then
    if a.routine_id is distinct from p_routine_id
      or a.routine_version_id is distinct from p_routine_version_id
      or a.vial_id is distinct from p_vial_id
      or a.scheduled_date is distinct from p_scheduled_date
      or (p_applied_at is not null and a.applied_at is distinct from p_applied_at) then
      raise exception 'UUID de operação reutilizado com intenção diferente';
    end if;
    select * into m from public.vial_movements
      where user_id=u and application_id=a.id and kind='application';
    if not found or m.operation_id is distinct from p_operation_id
      or m.delta_mg is distinct from -a.dose_mg
      or m.balance_before is distinct from a.balance_before
      or m.balance_after is distinct from a.balance_after then
      raise exception 'Integridade da aplicação inválida';
    end if;
    return jsonb_build_object('replay',true,'application',to_jsonb(a),'movement',to_jsonb(m),
      'vial',jsonb_build_object('id',a.vial_id,'remaining_mg',m.balance_after));
  end if;

  select * into r from public.routines
    where user_id=u and id=p_routine_id and deleted_at is null;
  if not found then raise exception 'Rotina não encontrada'; end if;
  select * into rv from public.routine_versions
    where user_id=u and id=p_routine_version_id and routine_id=p_routine_id;
  if not found or jsonb_typeof(rv.snapshot) is distinct from 'object' then
    raise exception 'Versão da rotina não encontrada';
  end if;
  if coalesce(rv.snapshot->>'vial_id','') is distinct from p_vial_id::text
    or jsonb_typeof(rv.snapshot->'dose_value') is distinct from 'number'
    or rv.snapshot->>'dose_unit' not in ('mg','mcg')
    or jsonb_typeof(rv.snapshot->'syringe_capacity') is distinct from 'number' then
    raise exception 'Snapshot da rotina inválido';
  end if;

  original_value:=(rv.snapshot->>'dose_value')::numeric;
  original_unit:=rv.snapshot->>'dose_unit';
  capacity:=(rv.snapshot->>'syringe_capacity')::integer;
  if original_value<=0 or original_value>=1000000000 or capacity not in (30,50,100) then
    raise exception 'Snapshot da rotina inválido';
  end if;
  normalized_mg:=original_value/case when original_unit='mcg' then 1000::numeric else 1::numeric end;

  -- O lock do frasco serializa saldo e operações concorrentes do mesmo estoque.
  select * into v from public.vials
    where user_id=u and id=p_vial_id and deleted_at is null and active for update;
  if not found then raise exception 'Frasco não encontrado ou inativo'; end if;

  -- Releitura obrigatória: outra transação pode ter concluído o mesmo UUID durante o lock.
  select * into a from public.applications where user_id=u and operation_id=p_operation_id;
  if found then
    if a.routine_id is distinct from p_routine_id
      or a.routine_version_id is distinct from p_routine_version_id
      or a.vial_id is distinct from p_vial_id
      or a.scheduled_date is distinct from p_scheduled_date
      or (p_applied_at is not null and a.applied_at is distinct from p_applied_at) then
      raise exception 'UUID de operação reutilizado com intenção diferente';
    end if;
    select * into m from public.vial_movements
      where user_id=u and application_id=a.id and kind='application';
    if not found then raise exception 'Integridade da aplicação inválida'; end if;
    return jsonb_build_object('replay',true,'application',to_jsonb(a),'movement',to_jsonb(m),
      'vial',jsonb_build_object('id',a.vial_id,'remaining_mg',m.balance_after));
  end if;
  if exists(select 1 from public.applications x where x.user_id=u
    and x.routine_id=p_routine_id and x.scheduled_date=p_scheduled_date and x.undone_at is null) then
    raise exception 'Já existe aplicação ativa para esta rotina e data';
  end if;

  used_concentration:=v.concentration;
  used_volume:=normalized_mg/used_concentration;
  used_ui:=used_volume*100::numeric;
  if normalized_mg<=0 or normalized_mg>=1000000000 or used_volume<=0
    or used_ui<=0 or used_ui>capacity or used_ui>100 then
    raise exception 'Dose incompatível com a preparação ou seringa';
  end if;
  if v.remaining_mg<normalized_mg then raise exception 'Saldo insuficiente'; end if;
  before_balance:=v.remaining_mg;
  after_balance:=before_balance-normalized_mg;

  insert into public.applications(user_id,operation_id,routine_id,routine_version_id,vial_id,
    scheduled_date,applied_at,dose_value,dose_unit,dose_mg,volume_ml,ui,concentration,
    balance_before,balance_after)
  values(u,p_operation_id,p_routine_id,p_routine_version_id,p_vial_id,p_scheduled_date,
    coalesce(p_applied_at,stamp),original_value,original_unit,normalized_mg,used_volume,used_ui,
    used_concentration,before_balance,after_balance) returning * into a;
  insert into public.vial_movements(user_id,operation_id,vial_id,application_id,kind,delta_mg,
    balance_before,balance_after)
  values(u,p_operation_id,p_vial_id,a.id,'application',-normalized_mg,before_balance,after_balance)
  returning * into m;
  update public.vials set remaining_mg=after_balance,version=version+1,updated_at=stamp
    where user_id=u and id=p_vial_id returning * into v;

  return jsonb_build_object('replay',false,'application',to_jsonb(a),'movement',to_jsonb(m),
    'vial',jsonb_build_object('id',a.vial_id,'remaining_mg',m.balance_after));
end $$;
revoke all on function public.register_application(uuid,uuid,uuid,uuid,uuid,date,timestamptz)
  from public,anon,authenticated;
grant execute on function public.register_application(uuid,uuid,uuid,uuid,uuid,date,timestamptz)
  to authenticated;

create function public.undo_application(
  p_undo_operation_id uuid,
  p_expected_user uuid,
  p_application_id uuid,
  p_undone_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); stamp timestamptz:=statement_timestamp(); entitlement jsonb;
  a public.applications; original public.vial_movements; inverse public.vial_movements; v public.vials;
  before_balance numeric; after_balance numeric;
begin
  if u is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_expected_user is distinct from u then raise exception 'Conta alterada durante a operação'; end if;
  if p_undo_operation_id is null or p_application_id is null then raise exception 'Intenção incompleta'; end if;
  entitlement:=public.get_entitlement();
  if coalesce((entitlement->>'pro')::boolean,false) is not true
    or entitlement->>'status' not in ('trial','pro_active') then
    raise exception 'Acesso PRO necessário' using errcode='42501';
  end if;

  select * into a from public.applications
    where user_id=u and undo_operation_id=p_undo_operation_id;
  if found then
    if a.id is distinct from p_application_id
      or (p_undone_at is not null and a.undone_at is distinct from p_undone_at) then
      raise exception 'UUID de Undo reutilizado com intenção diferente';
    end if;
    select * into inverse from public.vial_movements
      where user_id=u and application_id=a.id and kind='undo';
    if not found or inverse.operation_id is distinct from p_undo_operation_id
      or inverse.delta_mg is distinct from a.dose_mg then
      raise exception 'Integridade do Undo inválida';
    end if;
    return jsonb_build_object('replay',true,'application',to_jsonb(a),'movement',to_jsonb(inverse),
      'vial',jsonb_build_object('id',a.vial_id,'remaining_mg',inverse.balance_after));
  end if;

  select * into a from public.applications
    where user_id=u and id=p_application_id for update;
  if not found then raise exception 'Aplicação não encontrada'; end if;
  if a.undone_at is not null then
    if a.undo_operation_id=p_undo_operation_id then
      select * into inverse from public.vial_movements
        where user_id=u and application_id=a.id and kind='undo';
      if not found then raise exception 'Integridade do Undo inválida'; end if;
      return jsonb_build_object('replay',true,'application',to_jsonb(a),'movement',to_jsonb(inverse),
        'vial',jsonb_build_object('id',a.vial_id,'remaining_mg',inverse.balance_after));
    end if;
    raise exception 'Aplicação já desfeita por outra operação';
  end if;
  select * into original from public.vial_movements
    where user_id=u and application_id=a.id and kind='application';
  if not found or original.operation_id is distinct from a.operation_id
    or original.delta_mg is distinct from -a.dose_mg
    or original.balance_before is distinct from a.balance_before
    or original.balance_after is distinct from a.balance_after then
    raise exception 'Integridade da aplicação inválida';
  end if;

  select * into v from public.vials where user_id=u and id=a.vial_id for update;
  if not found then raise exception 'Frasco não encontrado'; end if;
  before_balance:=v.remaining_mg;
  after_balance:=before_balance+a.dose_mg;
  if after_balance>v.initial_mg then raise exception 'Undo excederia a quantidade inicial do frasco'; end if;

  update public.applications set undone_at=coalesce(p_undone_at,stamp),
    undo_operation_id=p_undo_operation_id where user_id=u and id=a.id returning * into a;
  insert into public.vial_movements(user_id,operation_id,vial_id,application_id,kind,delta_mg,
    balance_before,balance_after)
  values(u,p_undo_operation_id,a.vial_id,a.id,'undo',a.dose_mg,before_balance,after_balance)
  returning * into inverse;
  update public.vials set remaining_mg=after_balance,version=version+1,updated_at=stamp
    where user_id=u and id=a.vial_id returning * into v;

  return jsonb_build_object('replay',false,'application',to_jsonb(a),'movement',to_jsonb(inverse),
    'vial',jsonb_build_object('id',a.vial_id,'remaining_mg',inverse.balance_after));
end $$;
revoke all on function public.undo_application(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.undo_application(uuid,uuid,uuid,timestamptz)
  to authenticated;

commit;
