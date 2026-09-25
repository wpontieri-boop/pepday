-- PepDay V3.0 / Bloco B2.2-D2-A. Aplicar uma vez, somente em pepday-v3-test.
-- Schema e invariantes de Rotinas. Não cria RPCs de mutação e não altera B2.1/D1.
begin;

-- Preflight 1: toda Rotina existente deve possuir exatamente sua versão corrente.
do $$
declare diagnostics jsonb;
begin
  select jsonb_agg(to_jsonb(issue) order by issue.user_id,issue.routine_id)
  into diagnostics
  from (
    select r.user_id,r.id routine_id,r.version expected_version
    from public.routines r
    left join public.routine_versions rv on rv.user_id=r.user_id
      and rv.routine_id=r.id and rv.version=r.version
    where rv.id is null
    order by r.user_id,r.id
    limit 20
  ) issue;
  if diagnostics is not null then
    raise exception using errcode='23514',
      message='D2-A PREFLIGHT: Rotina sem versão corrente correspondente',
      detail=diagnostics::text;
  end if;
end $$;

-- Preflight 2: a identidade gravada nos snapshots legados deve continuar
-- correspondendo às colunas relacionais. Nada é reescrito ou normalizado aqui.
do $$
declare diagnostics jsonb;
begin
  select jsonb_agg(to_jsonb(issue) order by issue.user_id,issue.routine_id,issue.version)
  into diagnostics
  from (
    select rv.user_id,rv.routine_id,rv.id routine_version_id,rv.version
    from public.routine_versions rv
    where rv.snapshot->>'user_id' is distinct from rv.user_id::text
      or rv.snapshot->>'id' is distinct from rv.routine_id::text
      or case when coalesce(rv.snapshot->>'version','') ~ '^[1-9][0-9]*$'
        then (rv.snapshot->>'version')::bigint is distinct from rv.version
        else true end
    order by rv.user_id,rv.routine_id,rv.version
    limit 20
  ) issue;
  if diagnostics is not null then
    raise exception using errcode='23514',
      message='D2-A PREFLIGHT: identidade incompatível em routine_versions',
      detail=diagnostics::text;
  end if;
end $$;

-- Preflight 3: as FKs separadas atuais não garantem que a versão pertence à
-- mesma Rotina da Application. Rejeitar qualquer anomalia antes da FK composta.
do $$
declare diagnostics jsonb;
begin
  select jsonb_agg(to_jsonb(issue) order by issue.user_id,issue.application_id)
  into diagnostics
  from (
    select a.user_id,a.id application_id,a.routine_id,a.routine_version_id
    from public.applications a
    left join public.routine_versions rv on rv.user_id=a.user_id
      and rv.routine_id=a.routine_id and rv.id=a.routine_version_id
    where rv.id is null
    order by a.user_id,a.id
    limit 20
  ) issue;
  if diagnostics is not null then
    raise exception using errcode='23514',
      message='D2-A PREFLIGHT: Application aponta para versão de outra Rotina ou conta',
      detail=diagnostics::text;
  end if;
end $$;

-- Preflight 4: a nova constraint permite Rotina pausada sem deleted_at, mas
-- toda exclusão lógica existente deve estar inativa.
do $$
declare diagnostics jsonb;
begin
  select jsonb_agg(to_jsonb(issue) order by issue.user_id,issue.routine_id)
  into diagnostics
  from (
    select r.user_id,r.id routine_id,r.status,r.deleted_at
    from public.routines r
    where r.deleted_at is not null and r.status<>'inactive'
    order by r.user_id,r.id
    limit 20
  ) issue;
  if diagnostics is not null then
    raise exception using errcode='23514',
      message='D2-A PREFLIGHT: Rotina excluída logicamente ainda está ativa',
      detail=diagnostics::text;
  end if;
end $$;

-- Preserva integralmente o ledger D1 e apenas amplia o domínio permitido.
alter table public.domain_mutation_operations
  drop constraint domain_mutation_operations_entity_type_check;
alter table public.domain_mutation_operations
  add constraint domain_mutation_operations_entity_type_check
  check(entity_type in ('vial','routine')) not valid;
alter table public.domain_mutation_operations
  validate constraint domain_mutation_operations_entity_type_check;

alter table public.routines
  add constraint routines_deleted_requires_inactive
  check(deleted_at is null or status='inactive') not valid;
alter table public.routines
  validate constraint routines_deleted_requires_inactive;

-- Necessária para a FK composta de Applications. As unicidades anteriores são
-- mantidas porque também sustentam os contratos já aplicados.
alter table public.routine_versions
  add constraint routine_versions_owner_routine_id_unique
  unique(user_id,routine_id,id);

create index applications_owner_routine_version_idx
  on public.applications(user_id,routine_id,routine_version_id);
alter table public.applications
  add constraint applications_owner_routine_version_fkey
  foreign key(user_id,routine_id,routine_version_id)
  references public.routine_versions(user_id,routine_id,id) not valid;
alter table public.applications
  validate constraint applications_owner_routine_version_fkey;

-- Atende a consulta do D1 que bloqueia inativação de Frasco com Rotina ativa.
create index routines_active_vial_idx
  on public.routines(user_id,vial_id)
  where status='active' and deleted_at is null;

-- Snapshot funcional explícito. Não depende de to_jsonb(routines), não inclui
-- timestamps técnicos e normaliza weekdays para ordem crescente sem duplicatas.
create function public.pepday_routine_snapshot(p_routine public.routines)
returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'id',p_routine.id,
    'user_id',p_routine.user_id,
    'vial_id',p_routine.vial_id,
    'name',p_routine.name,
    'dose_value',p_routine.dose_value,
    'dose_unit',p_routine.dose_unit,
    'syringe_capacity',p_routine.syringe_capacity,
    'frequency',p_routine.frequency,
    'weekdays',to_jsonb(array(
      select distinct day from unnest(p_routine.weekdays) day order by day
    )),
    'start_date',p_routine.start_date,
    'time_of_day',p_routine.time_of_day,
    'refill_at',p_routine.refill_at,
    'status',p_routine.status,
    'version',p_routine.version,
    'deleted_at',p_routine.deleted_at
  )
$$;
revoke all on function public.pepday_routine_snapshot(public.routines)
  from public,anon,authenticated;

-- routine_versions é append-only para o aplicativo. DELETE continua disponível
-- somente a papéis privilegiados e aos cascades de exclusão/privacidade.
create function public.pepday_prevent_routine_version_update()
returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'routine_versions é imutável; crie uma nova versão'
    using errcode='55000';
end $$;
revoke all on function public.pepday_prevent_routine_version_update()
  from public,anon,authenticated;
create trigger routine_versions_block_update
before update on public.routine_versions
for each row execute function public.pepday_prevent_routine_version_update();

-- A checagem diferida permite INSERT da Rotina seguido do snapshot na mesma
-- transação (inclusive na importação legada já aprovada).
create function public.pepday_assert_routine_current_version()
returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(
    select 1 from public.routine_versions rv
    where rv.user_id=new.user_id and rv.routine_id=new.id and rv.version=new.version
  ) then
    raise exception 'Rotina sem versão corrente correspondente'
      using errcode='23514',
        detail=jsonb_build_object('user_id',new.user_id,'routine_id',new.id,
          'version',new.version)::text;
  end if;
  return null;
end $$;
revoke all on function public.pepday_assert_routine_current_version()
  from public,anon,authenticated;
create constraint trigger routines_current_version_guard
after insert or update on public.routines
deferrable initially deferred
for each row execute function public.pepday_assert_routine_current_version();

-- DELETE direto da versão corrente também não pode deixar uma Rotina órfã.
-- No cascade de privacidade a Rotina já não existe quando a checagem diferida
-- ocorre, portanto a exclusão integral da conta continua permitida.
create function public.pepday_assert_version_keeps_current_routine()
returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  checked_user uuid:=coalesce(new.user_id,old.user_id);
  checked_routine uuid:=coalesce(new.routine_id,old.routine_id);
  current_version bigint;
begin
  select r.version into current_version from public.routines r
  where r.user_id=checked_user and r.id=checked_routine;
  if found and not exists(
    select 1 from public.routine_versions rv
    where rv.user_id=checked_user and rv.routine_id=checked_routine
      and rv.version=current_version
  ) then
    raise exception 'Rotina sem versão corrente correspondente'
      using errcode='23514',
        detail=jsonb_build_object('user_id',checked_user,'routine_id',checked_routine,
          'version',current_version)::text;
  end if;
  return null;
end $$;
revoke all on function public.pepday_assert_version_keeps_current_routine()
  from public,anon,authenticated;
create constraint trigger routine_versions_current_guard
after insert or delete on public.routine_versions
deferrable initially deferred
for each row execute function public.pepday_assert_version_keeps_current_routine();

-- Reafirma o modelo já aprovado: leitura pelo dono e nenhuma escrita direta.
revoke insert,update,delete on public.routines,public.routine_versions,
  public.domain_mutation_operations from public,anon,authenticated;

commit;
