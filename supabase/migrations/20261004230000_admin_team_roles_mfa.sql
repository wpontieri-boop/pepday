-- PepDay V3 — equipe administrativa com OWNER / ADMIN / VIEWER e MFA obrigatório.
begin;

create table public.admin_memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  access_level text not null check (access_level in ('owner','admin','viewer')),
  active boolean not null default true,
  password_configured boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create unique index admin_memberships_single_active_owner
  on public.admin_memberships ((1))
  where access_level='owner' and active;

alter table public.admin_memberships enable row level security;
revoke all on public.admin_memberships from public,anon,authenticated;

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(trim(action)) between 3 and 120),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp()
);

alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from public,anon,authenticated;

do $$
declare
  admin_count integer;
  seed_id uuid;
begin
  select count(*) into admin_count
  from public.profiles where role='admin';

  if admin_count<>1 then
    raise exception 'Bootstrap OWNER exige exatamente uma conta admin atual; encontrado %',admin_count;
  end if;

  select id into seed_id
  from public.profiles where role='admin'
  limit 1;

  insert into public.admin_memberships(user_id,access_level,active,password_configured,created_by)
  values(seed_id,'owner',true,false,seed_id);
end $$;

create or replace function public.get_admin_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  m public.admin_memberships;
  p public.profiles;
  aal text:=coalesce(auth.jwt()->>'aal','aal1');
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  select * into p from public.profiles where id=u;
  select * into m from public.admin_memberships where user_id=u;

  if p.id is null or p.role<>'admin' or m.user_id is null or not m.active then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  return jsonb_build_object(
    'user_id',u,
    'email',p.email,
    'name',p.name,
    'access_level',m.access_level,
    'password_configured',m.password_configured,
    'aal',aal,
    'mfa_verified',aal='aal2',
    'can_write',m.access_level in ('owner','admin'),
    'can_manage_team',m.access_level='owner'
  );
end $$;

revoke all on function public.get_admin_context() from public,anon,authenticated;
grant execute on function public.get_admin_context() to authenticated;

create or replace function public.admin_assert_access(
  p_write boolean default false,
  p_owner_only boolean default false
) returns text
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  level text;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
    raise exception 'Autenticação em dois fatores necessária' using errcode='42501';
  end if;

  select m.access_level into level
  from public.admin_memberships m
  join public.profiles p on p.id=m.user_id
  where m.user_id=u and m.active and p.role='admin';

  if level is null then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  if p_owner_only and level<>'owner' then
    raise exception 'Acesso de proprietário necessário' using errcode='42501';
  end if;

  if p_write and level='viewer' then
    raise exception 'Acesso somente leitura' using errcode='42501';
  end if;

  return level;
end $$;

revoke all on function public.admin_assert_access(boolean,boolean) from public,anon,authenticated;

create or replace function public.admin_mark_password_configured() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  m public.admin_memberships;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  select * into m from public.admin_memberships where user_id=u and active for update;
  if m.user_id is null then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  update public.admin_memberships
  set password_configured=true,updated_at=statement_timestamp()
  where user_id=u;

  insert into public.admin_audit_logs(actor_user_id,target_user_id,action)
  values(u,u,'admin_password_configured');

  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.admin_mark_password_configured() from public,anon,authenticated;
grant execute on function public.admin_mark_password_configured() to authenticated;

create or replace function public.get_admin_team() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  result jsonb;
begin
  perform public.admin_assert_access(false,true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,
    'email',p.email,
    'name',p.name,
    'access_level',m.access_level,
    'active',m.active,
    'password_configured',m.password_configured,
    'created_at',m.created_at,
    'updated_at',m.updated_at
  ) order by case m.access_level when 'owner' then 0 when 'admin' then 1 else 2 end,p.email),'[]'::jsonb)
  into result
  from public.admin_memberships m
  join public.profiles p on p.id=m.user_id;

  return result;
end $$;

revoke all on function public.get_admin_team() from public,anon,authenticated;
grant execute on function public.get_admin_team() to authenticated;

create or replace function public.admin_set_team_member(
  p_email text,
  p_access_level text,
  p_active boolean default true
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  target public.profiles;
  prior public.admin_memberships;
  stamp timestamptz:=statement_timestamp();
begin
  perform public.admin_assert_access(true,true);

  if nullif(trim(coalesce(p_email,'')),'') is null then
    raise exception 'E-mail obrigatório';
  end if;
  if p_access_level not in ('admin','viewer') then
    raise exception 'Nível administrativo inválido';
  end if;

  select * into target from public.profiles
  where lower(email)=lower(trim(p_email))
  limit 1;

  if target.id is null then
    raise exception 'Conta PepDay não encontrada. Crie/convide a conta antes de conceder acesso.';
  end if;

  select * into prior from public.admin_memberships where user_id=target.id;

  if prior.access_level='owner' then
    raise exception 'O OWNER não pode ser alterado por esta ação' using errcode='42501';
  end if;

  update public.profiles set role='admin',updated_at=stamp where id=target.id;

  insert into public.admin_memberships(
    user_id,access_level,active,password_configured,created_by,created_at,updated_at
  ) values(
    target.id,p_access_level,coalesce(p_active,true),false,u,stamp,stamp
  )
  on conflict(user_id) do update set
    access_level=excluded.access_level,
    active=excluded.active,
    created_by=coalesce(public.admin_memberships.created_by,excluded.created_by),
    updated_at=stamp;

  insert into public.admin_audit_logs(actor_user_id,target_user_id,action,metadata)
  values(
    u,target.id,
    case when coalesce(p_active,true) then 'admin_team_member_upserted' else 'admin_team_member_disabled' end,
    jsonb_build_object('access_level',p_access_level,'email',lower(trim(p_email)))
  );

  return jsonb_build_object(
    'ok',true,
    'user_id',target.id,
    'email',target.email,
    'access_level',p_access_level,
    'active',coalesce(p_active,true)
  );
end $$;

revoke all on function public.admin_set_team_member(text,text,boolean) from public,anon,authenticated;
grant execute on function public.admin_set_team_member(text,text,boolean) to authenticated;

create or replace function public.admin_disable_team_member(
  p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  prior public.admin_memberships;
begin
  perform public.admin_assert_access(true,true);

  select * into prior from public.admin_memberships where user_id=p_user_id for update;
  if prior.user_id is null then
    raise exception 'Membro administrativo não encontrado';
  end if;
  if prior.access_level='owner' then
    raise exception 'O OWNER não pode ser removido' using errcode='42501';
  end if;

  update public.admin_memberships
  set active=false,updated_at=statement_timestamp()
  where user_id=p_user_id;

  update public.profiles
  set role='user',updated_at=statement_timestamp()
  where id=p_user_id;

  insert into public.admin_audit_logs(actor_user_id,target_user_id,action,metadata)
  values(u,p_user_id,'admin_team_member_disabled',jsonb_build_object('prior_level',prior.access_level));

  return jsonb_build_object('ok',true,'user_id',p_user_id);
end $$;

revoke all on function public.admin_disable_team_member(uuid) from public,anon,authenticated;
grant execute on function public.admin_disable_team_member(uuid) to authenticated;

create or replace function public.get_admin_audit_logs(
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb;
begin
  perform public.admin_assert_access(false,true);
  if p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Limite de auditoria inválido';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'actor_email',actor.email,
    'target_email',target.email,
    'action',x.action,
    'metadata',x.metadata,
    'created_at',x.created_at
  ) order by x.created_at desc),'[]'::jsonb)
  into result
  from (
    select * from public.admin_audit_logs order by created_at desc limit p_limit
  ) x
  join public.profiles actor on actor.id=x.actor_user_id
  left join public.profiles target on target.id=x.target_user_id;

  return result;
end $$;

revoke all on function public.get_admin_audit_logs(integer) from public,anon,authenticated;
grant execute on function public.get_admin_audit_logs(integer) to authenticated;

-- Preserve existing, tested business logic behind hardened access wrappers.
alter function public.get_admin_acquisition_metrics(integer)
  rename to get_admin_acquisition_metrics_legacy;
alter function public.get_admin_pwa_metrics(integer)
  rename to get_admin_pwa_metrics_legacy;
alter function public.get_admin_card_campaign_metrics(integer)
  rename to get_admin_card_campaign_metrics_legacy;
alter function public.get_admin_promo_codes()
  rename to get_admin_promo_codes_legacy;
alter function public.get_admin_promo_redemptions(text)
  rename to get_admin_promo_redemptions_legacy;
alter function public.admin_generate_promo_code(integer,timestamptz,text)
  rename to admin_generate_promo_code_legacy;
alter function public.admin_set_promo_code_active(text,boolean)
  rename to admin_set_promo_code_active_legacy;

revoke all on function public.get_admin_acquisition_metrics_legacy(integer) from public,anon,authenticated;
revoke all on function public.get_admin_pwa_metrics_legacy(integer) from public,anon,authenticated;
revoke all on function public.get_admin_card_campaign_metrics_legacy(integer) from public,anon,authenticated;
revoke all on function public.get_admin_promo_codes_legacy() from public,anon,authenticated;
revoke all on function public.get_admin_promo_redemptions_legacy(text) from public,anon,authenticated;
revoke all on function public.admin_generate_promo_code_legacy(integer,timestamptz,text) from public,anon,authenticated;
revoke all on function public.admin_set_promo_code_active_legacy(text,boolean) from public,anon,authenticated;

create function public.get_admin_acquisition_metrics(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_assert_access(false,false);
  return public.get_admin_acquisition_metrics_legacy(p_days);
end $$;

create function public.get_admin_pwa_metrics(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_assert_access(false,false);
  return public.get_admin_pwa_metrics_legacy(p_days);
end $$;

create function public.get_admin_card_campaign_metrics(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_assert_access(false,false);
  return public.get_admin_card_campaign_metrics_legacy(p_days);
end $$;

create function public.get_admin_promo_codes() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_assert_access(false,false);
  return public.get_admin_promo_codes_legacy();
end $$;

create function public.get_admin_promo_redemptions(p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_assert_access(false,false);
  return public.get_admin_promo_redemptions_legacy(p_code);
end $$;

create function public.admin_generate_promo_code(
  p_duration_days integer,
  p_expires_at timestamptz default null,
  p_exclusive_email text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  result jsonb;
  level text;
begin
  level:=public.admin_assert_access(true,false);
  result:=public.admin_generate_promo_code_legacy(p_duration_days,p_expires_at,p_exclusive_email);
  insert into public.admin_audit_logs(actor_user_id,action,metadata)
  values(u,'promo_code_generated',jsonb_build_object(
    'access_level',level,
    'duration_days',p_duration_days,
    'exclusive',nullif(trim(coalesce(p_exclusive_email,'')),'') is not null
  ));
  return result;
end $$;

create function public.admin_set_promo_code_active(
  p_code text,
  p_active boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  result jsonb;
  level text;
begin
  level:=public.admin_assert_access(true,false);
  result:=public.admin_set_promo_code_active_legacy(p_code,p_active);
  insert into public.admin_audit_logs(actor_user_id,action,metadata)
  values(u,'promo_code_status_changed',jsonb_build_object(
    'access_level',level,'code',upper(trim(p_code)),'active',p_active
  ));
  return result;
end $$;

revoke all on function public.get_admin_acquisition_metrics(integer) from public,anon,authenticated;
revoke all on function public.get_admin_pwa_metrics(integer) from public,anon,authenticated;
revoke all on function public.get_admin_card_campaign_metrics(integer) from public,anon,authenticated;
revoke all on function public.get_admin_promo_codes() from public,anon,authenticated;
revoke all on function public.get_admin_promo_redemptions(text) from public,anon,authenticated;
revoke all on function public.admin_generate_promo_code(integer,timestamptz,text) from public,anon,authenticated;
revoke all on function public.admin_set_promo_code_active(text,boolean) from public,anon,authenticated;

grant execute on function public.get_admin_acquisition_metrics(integer) to authenticated;
grant execute on function public.get_admin_pwa_metrics(integer) to authenticated;
grant execute on function public.get_admin_card_campaign_metrics(integer) to authenticated;
grant execute on function public.get_admin_promo_codes() to authenticated;
grant execute on function public.get_admin_promo_redemptions(text) to authenticated;
grant execute on function public.admin_generate_promo_code(integer,timestamptz,text) to authenticated;
grant execute on function public.admin_set_promo_code_active(text,boolean) to authenticated;

commit;
