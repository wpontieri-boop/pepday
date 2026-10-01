-- Ajustes jurídicos V3 TEST: consentimento específico para dados sensíveis.
-- Contas existentes devem renovar os aceites; não há backfill presumido de consentimento.
begin;

alter table public.profiles
  add column sensitive_data_consent_at timestamptz,
  add column sensitive_data_consent_version text,
  add constraint profiles_sensitive_consent_pair
    check ((sensitive_data_consent_at is null) = (sensitive_data_consent_version is null));

drop function if exists public.complete_onboarding(
  text,text,text,boolean,text,text,boolean
);

create function public.complete_onboarding(
  p_name text,
  p_country text,
  p_timezone text,
  p_adult boolean,
  p_terms_version text,
  p_privacy_version text,
  p_sensitive_consent boolean,
  p_sensitive_consent_version text,
  p_marketing boolean default false
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  if p_adult is distinct from true
    or p_sensitive_consent is distinct from true
    or p_name is null or length(trim(p_name)) not between 1 and 200
    or p_country is null or p_country !~ '^[A-Z]{2}$'
    or coalesce(trim(p_terms_version),'')=''
    or coalesce(trim(p_privacy_version),'')=''
    or coalesce(trim(p_sensitive_consent_version),'')='' then
    raise exception 'Cadastro e aceites incompletos';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Fuso horário inválido';
  end if;

  update public.profiles
  set name=trim(p_name),
      country=p_country,
      timezone=p_timezone,
      is_adult_confirmed=true,
      terms_accepted_at=stamp,
      terms_version=trim(p_terms_version),
      privacy_accepted_at=stamp,
      privacy_version=trim(p_privacy_version),
      sensitive_data_consent_at=stamp,
      sensitive_data_consent_version=trim(p_sensitive_consent_version),
      updated_at=stamp
  where id=u;
  update public.settings
  set marketing_opt_in=coalesce(p_marketing,false),
      marketing_accepted_at=case when p_marketing then stamp else null end,
      version=version+1,
      updated_at=stamp
  where user_id=u;

  insert into public.audit_logs(user_id,action)
  values
    (u,'onboarding_completed'),
    (u,'sensitive_data_consent_granted');
end $$;

revoke all on function public.complete_onboarding(
  text,text,text,boolean,text,text,boolean,text,boolean
) from public,anon,authenticated;
grant execute on function public.complete_onboarding(
  text,text,text,boolean,text,text,boolean,text,boolean
) to authenticated;

create or replace function public.start_trial() returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  t public.trials;
  stamp timestamptz:=statement_timestamp();
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  select * into t from public.trials where user_id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;
  if t.trial_used then return public.get_entitlement(); end if;
  if not exists(
    select 1 from public.profiles
    where id=u
      and is_adult_confirmed
      and terms_accepted_at is not null
      and privacy_accepted_at is not null
      and sensitive_data_consent_at is not null
  ) then
    raise exception 'Conclua o cadastro antes do teste';
  end if;
  if (public.get_entitlement()->>'pro')::boolean then return public.get_entitlement(); end if;

  update public.trials
  set trial_used=true,
      started_at=stamp,
      ends_at=stamp+interval '7 days',
      updated_at=stamp
  where user_id=u;

  update public.subscriptions
  set status='trial',updated_at=stamp
  where user_id=u;
  insert into public.audit_logs(user_id,action)
  values(u,'trial_started');

  return public.get_entitlement();
end $$;

revoke all on function public.start_trial() from public,anon,authenticated;
grant execute on function public.start_trial() to authenticated;

commit;
