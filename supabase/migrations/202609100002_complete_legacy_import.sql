-- Incremental A4. Aplicar UMA vez, somente em pepday-v3-test.
-- Não reaplica a instalação; nenhum registro existente é removido.
begin;

-- Identidade do legado por conta: UUIDs de outra conta nunca são reutilizados.
-- source_record conserva inclusive done, doseHistory e history, sem inventar eventos.
create table public.legacy_import_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('vial','routine')),
  legacy_id uuid not null,
  target_id uuid not null,
  import_id uuid not null references public.local_data_imports(id),
  source_record jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,kind,legacy_id), unique(user_id,kind,target_id)
);
alter table public.legacy_import_records enable row level security;
revoke all on public.legacy_import_records from public,anon,authenticated;
grant select on public.legacy_import_records to authenticated;
create policy owner_read on public.legacy_import_records for select to authenticated
  using ((select auth.uid())=user_id);

-- Recibo privado, limitado aos IDs contidos no snapshot desta importação.
-- Também verifica vínculos, versão inicial e movimento de saldo importado.
create function public.get_local_import_receipt(p_import_id uuid,p_expected_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); i public.local_data_imports; result jsonb;
begin
  if u is null or p_expected_user is distinct from u then raise exception 'Conta inválida'; end if;
  select * into i from public.local_data_imports where id=p_import_id and user_id=u;
  if not found then raise exception 'Importação não encontrada'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',m.kind,'legacy_id',m.legacy_id,
    'target_id',m.target_id,'verified',case when m.kind='vial' then
      exists(select 1 from public.vials v where v.user_id=u and v.id=m.target_id)
      and exists(select 1 from public.vial_movements v where v.user_id=u and v.vial_id=m.target_id and v.kind='import')
    else exists(select 1 from public.routines r join public.vials v on v.user_id=r.user_id and v.id=r.vial_id
      where r.user_id=u and r.id=m.target_id)
      and exists(select 1 from public.routine_versions r where r.user_id=u and r.routine_id=m.target_id and r.version=1)
    end) order by m.kind,m.legacy_id),'[]'::jsonb) into result
  from public.legacy_import_records m
  where m.user_id=u and (
    (m.kind='vial' and exists(select 1 from jsonb_array_elements(coalesce((i.source_snapshot->'raw'->>'pepday_v2_vials')::jsonb,'[]')) x where (x->>'id')::uuid=m.legacy_id))
    or (m.kind='routine' and exists(select 1 from jsonb_array_elements(coalesce((i.source_snapshot->'raw'->>'pepday_v1_routines')::jsonb,'[]')) x where (x->>'id')::uuid=m.legacy_id)));
  return jsonb_build_object('import_id',i.id,'user_id',u,'source_hash',i.source_hash,
    'status',i.status,'completed_at',i.completed_at,'records',result,'verification',i.verification);
end $$;
revoke all on function public.get_local_import_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_local_import_receipt(uuid,uuid) to authenticated;

create function public.complete_local_import(p_import_id uuid,p_expected_user uuid,p_hash text,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); i public.local_data_imports; vs jsonb; rs jsonb; x jsonb;
  old public.legacy_import_records; target uuid; vial_target uuid; legacy uuid;
  weekdays_value integer[]; receipt jsonb; imported integer:=0; reused integer:=0;
begin
  if u is null or p_expected_user is distinct from u then raise exception 'Conta inválida'; end if;
  if p_mode is null or p_mode not in ('import','merge') then raise exception 'Escolha importar ou mesclar'; end if;
  -- Serializa importações simultâneas da conta, inclusive snapshots diferentes.
  perform 1 from public.profiles where id=u for update;
  if not exists(select 1 from public.profiles where id=u and is_adult_confirmed
    and terms_accepted_at is not null and privacy_accepted_at is not null) then
    raise exception 'Conclua o cadastro antes de importar'; end if;
  select * into i from public.local_data_imports where id=p_import_id and user_id=u for update;
  if not found or i.source_hash is distinct from p_hash then raise exception 'Importação inválida'; end if;
  if i.status='completed' then return public.get_local_import_receipt(i.id,u); end if;
  if i.source_snapshot->>'sourceVersion' is distinct from '2.9'
    or jsonb_typeof(i.source_snapshot->'raw') is distinct from 'object' then
    raise exception 'Snapshot V2.9 inválido'; end if;
  vs:=coalesce((i.source_snapshot->'raw'->>'pepday_v2_vials')::jsonb,'[]');
  rs:=coalesce((i.source_snapshot->'raw'->>'pepday_v1_routines')::jsonb,'[]');
  if jsonb_typeof(vs) is distinct from 'array' or jsonb_typeof(rs) is distinct from 'array' then
    raise exception 'Listas inválidas'; end if;
  if jsonb_array_length(vs)+jsonb_array_length(rs) not between 1 and 2000 then
    raise exception 'Importação vazia ou excede 2000 registros'; end if;
  if (select count(*)<>count(distinct (value->>'id')::uuid) from jsonb_array_elements(vs))
    or (select count(*)<>count(distinct (value->>'id')::uuid) from jsonb_array_elements(rs)) then
    raise exception 'Identificadores ausentes ou repetidos'; end if;
  if p_mode='import' and (exists(select 1 from public.vials where user_id=u)
    or exists(select 1 from public.routines where user_id=u)) then
    raise exception 'Já há dados na conta. Escolha mesclar com segurança'; end if;

  for x in select value from jsonb_array_elements(vs) loop
    legacy:=(x->>'id')::uuid;
    if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'name') is distinct from 'string'
      or jsonb_typeof(x->'initialMg') is distinct from 'number'
      or jsonb_typeof(x->'remainingMg') is distinct from 'number'
      or jsonb_typeof(x->'waterMl') is distinct from 'number'
      or coalesce(x->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or (x ? 'cost' and jsonb_typeof(x->'cost') not in ('number','null'))
      or (x ? 'history' and jsonb_typeof(x->'history') is distinct from 'array') then
      raise exception 'Frasco inválido; revise o legado'; end if;
    select * into old from public.legacy_import_records where user_id=u and kind='vial' and legacy_id=legacy;
    if found then
      if old.source_record<>x then raise exception 'Conflito no legado; nenhum saldo foi sobrescrito'; end if;
      reused:=reused+1; continue;
    end if;
    if exists(select 1 from public.vials where user_id=u and id=legacy) then
      raise exception 'Frasco com identidade já existente; revise antes de mesclar'; end if;
    target:=gen_random_uuid();
    insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on,cost)
      values(target,u,x->>'name',(x->>'initialMg')::numeric,(x->>'remainingMg')::numeric,
        (x->>'waterMl')::numeric,(x->>'date')::date,(x->>'cost')::numeric);
    -- Saldo de abertura na migração, não uma nova aplicação nem reconstrução histórica.
    insert into public.vial_movements(user_id,operation_id,vial_id,kind,delta_mg,balance_before,balance_after)
      values(u,gen_random_uuid(),target,'import',(x->>'remainingMg')::numeric,0,(x->>'remainingMg')::numeric);
    insert into public.legacy_import_records(user_id,kind,legacy_id,target_id,import_id,source_record)
      values(u,'vial',legacy,target,i.id,x);
    imported:=imported+1;
  end loop;
  for x in select value from jsonb_array_elements(rs) loop
    legacy:=(x->>'id')::uuid;
    if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'name') is distinct from 'string'
      or jsonb_typeof(x->'doseValue') is distinct from 'number'
      or jsonb_typeof(x->'syringeCapacity') is distinct from 'number'
      or coalesce(x->>'start','') !~ '^\d{4}-\d{2}-\d{2}$'
      or (x ? 'time' and coalesce(x->>'time','')<>'' and x->>'time' !~ '^\d{2}:\d{2}$')
      or (x ? 'weekdays' and jsonb_typeof(x->'weekdays') is distinct from 'array')
      or (x ? 'done' and jsonb_typeof(x->'done') is distinct from 'array')
      or (x ? 'doseHistory' and jsonb_typeof(x->'doseHistory') is distinct from 'array')
      or (x ? 'refillAt' and jsonb_typeof(x->'refillAt') is distinct from 'number') then
      raise exception 'Rotina inválida; revise o legado'; end if;
    if not exists(select 1 from jsonb_array_elements(vs) v where (v->>'id')::uuid=(x->>'vialId')::uuid) then
      raise exception 'Rotina sem frasco no snapshot'; end if;
    select * into old from public.legacy_import_records where user_id=u and kind='routine' and legacy_id=legacy;
    if found then
      if old.source_record<>x then raise exception 'Conflito na rotina; revisão necessária'; end if;
      reused:=reused+1; continue;
    end if;
    if exists(select 1 from public.routines where user_id=u and id=legacy) then
      raise exception 'Rotina com identidade já existente; revisão necessária'; end if;
    select target_id into vial_target from public.legacy_import_records
      where user_id=u and kind='vial' and legacy_id=(x->>'vialId')::uuid;
    select coalesce(array_agg(value::integer),'{}'::integer[]) into weekdays_value
      from jsonb_array_elements_text(coalesce(x->'weekdays','[]'));
    if (select ((x->>'doseValue')::numeric / case when x->>'doseUnit'='mcg' then 1000 else 1 end)
      /concentration*100>(x->>'syringeCapacity')::integer from public.vials where user_id=u and id=vial_target) then
      raise exception 'Preparação atual excede a seringa; revise a rotina'; end if;
    target:=gen_random_uuid();
    insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
      frequency,weekdays,start_date,time_of_day,refill_at)
      values(target,u,vial_target,x->>'name',(x->>'doseValue')::numeric,x->>'doseUnit',
        (x->>'syringeCapacity')::integer,x->>'frequency',weekdays_value,(x->>'start')::date,
        nullif(x->>'time','')::time,coalesce((x->>'refillAt')::integer,3));
    insert into public.routine_versions(user_id,routine_id,version,snapshot)
      select u,target,1,to_jsonb(r) from public.routines r where user_id=u and id=target;
    insert into public.legacy_import_records(user_id,kind,legacy_id,target_id,import_id,source_record)
      values(u,'routine',legacy,target,i.id,x);
    imported:=imported+1;
  end loop;
  receipt:=public.get_local_import_receipt(i.id,u);
  if jsonb_array_length(receipt->'records')<>jsonb_array_length(vs)+jsonb_array_length(rs)
    or exists(select 1 from jsonb_array_elements(receipt->'records') r where r->>'verified'<>'true') then
    raise exception 'Conferência da importação falhou'; end if;
  update public.local_data_imports set status='completed',completed_at=now(),updated_at=now(),
    verification=jsonb_build_object('vials',jsonb_array_length(vs),'routines',jsonb_array_length(rs),
      'inserted',imported,'reused',reused,'history','preserved_as_legacy','mode',p_mode)
    where id=i.id and user_id=u;
  insert into public.audit_logs(user_id,action,operation_id) values(u,'legacy_import_completed',i.id);
  return public.get_local_import_receipt(i.id,u);
end $$;
revoke all on function public.complete_local_import(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_local_import(uuid,uuid,text,text) to authenticated;
commit;
