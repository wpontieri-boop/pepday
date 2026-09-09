-- PepDay V3.0 / Bloco A. Aplicar apenas em projeto Supabase de homologação.
-- A interface V2.9 ainda não chama estas tabelas/funções.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', email text not null,
  country text not null default 'BR', timezone text not null default 'America/Sao_Paulo',
  role text not null default 'user' check (role in ('user','admin')),
  is_adult_confirmed boolean not null default false,
  terms_accepted_at timestamptz, terms_version text,
  privacy_accepted_at timestamptz, privacy_version text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'free' check (status in ('free','trial','pro_active','pro_expired')),
  plan text not null default 'free' check (plan in ('free','monthly','annual')),
  access_override text check (access_override is null or access_override='admin'),
  provider text, provider_subscription_id text unique,
  started_at timestamptz, current_period_start timestamptz, current_period_end timestamptz,
  grace_until timestamptz, cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  trial_used boolean not null default false,
  started_at timestamptz, ends_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((not trial_used and started_at is null and ends_at is null) or
         (trial_used and started_at is not null and ends_at=started_at+interval '7 days'))
);

create table public.vials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  initial_mg numeric not null check (initial_mg>0 and initial_mg<1000000000),
  remaining_mg numeric not null check (remaining_mg>=0 and remaining_mg<=initial_mg),
  water_ml numeric not null check (water_ml>0 and water_ml<1000000000),
  concentration numeric generated always as (initial_mg/water_ml) stored,
  prepared_on date not null, cost numeric check (cost>=0 and cost<1000000000),
  active boolean not null default true,
  version bigint not null default 1 check (version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, unique(user_id,id)
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  vial_id uuid not null, name text not null check(length(trim(name)) between 1 and 200),
  dose_value numeric not null check(dose_value>0 and dose_value<1000000000),
  dose_unit text not null check(dose_unit in ('mg','mcg')),
  syringe_capacity integer not null check(syringe_capacity in (30,50,100)),
  frequency text not null check(frequency in ('daily','alternate','5on2off','weekdays')),
  weekdays integer[] not null default '{}', start_date date not null, time_of_day time,
  refill_at integer not null default 3 check(refill_at in (2,3,4,5)),
  status text not null default 'active' check(status in ('active','inactive')),
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, unique(user_id,id),
  foreign key(user_id,vial_id) references public.vials(user_id,id),
  check(weekdays <@ array[0,1,2,3,4,5,6]),
  check(frequency<>'weekdays' or cardinality(weekdays)>0)
);

create table public.routine_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  routine_id uuid not null, version bigint not null check(version>0),
  snapshot jsonb not null, effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id,routine_id,version), unique(user_id,id),
  foreign key(user_id,routine_id) references public.routines(user_id,id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null, routine_id uuid not null, routine_version_id uuid not null,
  vial_id uuid not null, scheduled_date date not null, applied_at timestamptz not null,
  dose_value numeric not null check(dose_value>0 and dose_value<1000000000),
  dose_unit text not null check(dose_unit in ('mg','mcg')),
  dose_mg numeric not null check(dose_mg>0 and dose_mg<1000000000),
  volume_ml numeric not null check(volume_ml>0 and volume_ml<1000000000),
  ui numeric not null check(ui>0 and ui<=100),
  concentration numeric not null check(concentration>0 and concentration<1000000000),
  balance_before numeric not null check(balance_before>=dose_mg),
  balance_after numeric not null check(balance_after>=0 and balance_after=balance_before-dose_mg),
  undone_at timestamptz, undo_operation_id uuid,
  created_at timestamptz not null default now(),
  unique(user_id,operation_id), unique(user_id,undo_operation_id), unique(user_id,id),
  foreign key(user_id,routine_id) references public.routines(user_id,id),
  foreign key(user_id,routine_version_id) references public.routine_versions(user_id,id),
  foreign key(user_id,vial_id) references public.vials(user_id,id),
  check((undone_at is null)=(undo_operation_id is null))
);
create unique index applications_one_active_day on public.applications(user_id,routine_id,scheduled_date)
  where undone_at is null;

create table public.vial_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null, vial_id uuid not null, application_id uuid,
  kind text not null check(kind in ('opening','application','undo','adjustment','import')),
  delta_mg numeric not null, balance_before numeric not null check(balance_before>=0),
  balance_after numeric not null check(balance_after>=0 and balance_after=balance_before+delta_mg),
  created_at timestamptz not null default now(), unique(user_id,operation_id),
  foreign key(user_id,vial_id) references public.vials(user_id,id),
  foreign key(user_id,application_id) references public.applications(user_id,id)
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  routine_reminders boolean not null default false, refill_alerts boolean not null default false,
  account_security_notices boolean not null default true,
  marketing_opt_in boolean not null default false, marketing_accepted_at timestamptz,
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(not marketing_opt_in or marketing_accepted_at is not null)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  action text not null, operation_id uuid,
  created_at timestamptz not null default now()
  -- Sem doses, nomes de substâncias, tokens ou payloads em logs.
);

create table public.local_data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  source_version text not null default '2.9',
  status text not null default 'staged' check(status in ('staged','review_required','completed')),
  source_snapshot jsonb not null,
  -- Snapshot é conteúdo privado do usuário, nunca um audit log.
  verification jsonb, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,source_hash),
  check((status='completed')=(completed_at is not null))
);

-- Permissões explícitas: dados de domínio são lidos pelo dono; mutações passarão
-- exclusivamente por RPCs transacionais/versionadas do Bloco B. Nenhum CRUD aberto.
do $$
declare t text;
begin
  foreach t in array array['profiles','subscriptions','trials','vials','routines',
    'routine_versions','applications','vial_movements','settings','audit_logs','local_data_imports'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    if t<>'audit_logs' then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid())=%I)',
        t,case when t='profiles' then 'id' else 'user_id' end);
    end if;
  end loop;
end $$;

create function public.pepday_bootstrap_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,email) values(new.id,coalesce(new.email,''));
  insert into public.subscriptions(user_id) values(new.id);
  insert into public.trials(user_id) values(new.id);
  insert into public.settings(user_id) values(new.id);
  return new;
end $$;
revoke all on function public.pepday_bootstrap_user() from public,anon,authenticated;
create trigger pepday_auth_created after insert on auth.users
for each row execute function public.pepday_bootstrap_user();

-- Contas já criadas no projeto antes desta migração também recebem estado FREE.
insert into public.profiles(id,email) select id,coalesce(email,'') from auth.users on conflict do nothing;
insert into public.subscriptions(user_id) select id from public.profiles on conflict do nothing;
insert into public.trials(user_id) select id from public.profiles on conflict do nothing;
insert into public.settings(user_id) select id from public.profiles on conflict do nothing;

create function public.complete_onboarding(p_name text,p_country text,p_timezone text,
  p_adult boolean,p_terms_version text,p_privacy_version text,p_marketing boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); stamp timestamptz:=now();
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  if p_adult is distinct from true or p_name is null or length(trim(p_name)) not between 1 and 200
    or p_country is null or p_country !~ '^[A-Z]{2}$'
    or coalesce(trim(p_terms_version),'')='' or coalesce(trim(p_privacy_version),'')='' then
    raise exception 'Cadastro e aceites incompletos';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Fuso horário inválido';
  end if;
  update public.profiles set name=trim(p_name),country=p_country,timezone=p_timezone,
    is_adult_confirmed=true,terms_accepted_at=stamp,terms_version=p_terms_version,
    privacy_accepted_at=stamp,privacy_version=p_privacy_version,updated_at=stamp where id=u;
  update public.settings set marketing_opt_in=coalesce(p_marketing,false),
    marketing_accepted_at=case when p_marketing then stamp else null end,
    version=version+1,updated_at=stamp where user_id=u;
  insert into public.audit_logs(user_id,action) values(u,'onboarding_completed');
end $$;
revoke all on function public.complete_onboarding(text,text,text,boolean,text,text,boolean) from public,anon,authenticated;
grant execute on function public.complete_onboarding(text,text,text,boolean,text,text,boolean) to authenticated;

create function public.get_entitlement() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); s public.subscriptions; t public.trials; p public.profiles;
begin
  if u is null then return jsonb_build_object('status','free','pro',false); end if;
  select * into p from public.profiles where id=u;
  select * into s from public.subscriptions where user_id=u;
  select * into t from public.trials where user_id=u;
  if p.role='admin' and s.access_override='admin' then
    return jsonb_build_object('status','pro_active','pro',true,'source','admin');
  elsif s.status='pro_active' and greatest(s.current_period_end,s.grace_until)>now() then
    return jsonb_build_object('status','pro_active','pro',true,'source','subscription',
      'ends_at',greatest(s.current_period_end,s.grace_until));
  elsif t.trial_used and t.ends_at>now() then
    return jsonb_build_object('status','trial','pro',true,'source','trial','ends_at',t.ends_at);
  end if;
  return jsonb_build_object('status',case when t.trial_used or s.status in ('pro_active','pro_expired')
    then 'pro_expired' else 'free' end,'pro',false,'trial_used',coalesce(t.trial_used,false));
end $$;
revoke all on function public.get_entitlement() from public,anon,authenticated;
grant execute on function public.get_entitlement() to authenticated;

create function public.start_trial() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t public.trials; stamp timestamptz:=now();
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  -- Serializa requisições concorrentes da mesma conta. Não depende de IP/aparelho.
  select * into t from public.trials where user_id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;
  if t.trial_used then return public.get_entitlement(); end if;
  if not exists(select 1 from public.profiles where id=u and is_adult_confirmed
    and terms_accepted_at is not null and privacy_accepted_at is not null) then
    raise exception 'Conclua o cadastro antes do teste';
  end if;
  if (public.get_entitlement()->>'pro')::boolean then return public.get_entitlement(); end if;
  update public.trials set trial_used=true,started_at=stamp,ends_at=stamp+interval '7 days',
    updated_at=stamp where user_id=u;
  update public.subscriptions set status='trial',updated_at=stamp where user_id=u;
  insert into public.audit_logs(user_id,action) values(u,'trial_started');
  return public.get_entitlement();
end $$;
revoke all on function public.start_trial() from public,anon,authenticated;
grant execute on function public.start_trial() to authenticated;

-- Etapa de recebimento para revisão. Não marca uma migração concluída sem que
-- a conversão e conferência de saldos/histórico tenham sido implementadas.
create function public.stage_local_import(p_hash text,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result uuid; saved jsonb;
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_snapshot is null
    or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>10485760 then
    raise exception 'Snapshot inválido';
  end if;
  insert into public.local_data_imports(user_id,source_hash,source_snapshot,status)
    values(u,p_hash,p_snapshot,'staged') on conflict(user_id,source_hash) do nothing;
  select id,source_snapshot into result,saved from public.local_data_imports
    where user_id=u and source_hash=p_hash;
  if saved<>p_snapshot then raise exception 'Identificador reutilizado com conteúdo diferente'; end if;
  return result;
end $$;
revoke all on function public.stage_local_import(text,jsonb) from public,anon,authenticated;
grant execute on function public.stage_local_import(text,jsonb) to authenticated;

-- Não há RPC pública de promoção a admin nem política de leitura global.
commit;
