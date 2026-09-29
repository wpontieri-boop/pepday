-- PepDay V3.0 / Bloco C — códigos promocionais de acesso PRO.
-- Mantém acesso promocional separado de trial e assinatura paga.
begin;

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  duration_days integer not null check (duration_days in (30,60,90)),
  max_redemptions integer not null check (max_redemptions between 1 and 100000),
  redemption_count integer not null default 0 check (redemption_count>=0 and redemption_count<=max_redemptions),
  valid_from timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  exclusive_user_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (code=upper(trim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{3,31}$'),
  check (expires_at is null or expires_at>valid_from)
);

create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete restrict,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  code_snapshot text not null,
  duration_days integer not null check (duration_days in (30,60,90)),
  redeemed_at timestamptz not null default statement_timestamp(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(promo_code_id,user_id),
  check (ends_at=starts_at+make_interval(days=>duration_days))
);

create index promo_codes_active_lookup
  on public.promo_codes(active,code);
create index promo_redemptions_user_window
  on public.promo_redemptions(user_id,starts_at,ends_at);
create index promo_redemptions_code_redeemed
  on public.promo_redemptions(promo_code_id,redeemed_at desc);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes from public,anon,authenticated,service_role;
revoke all on public.promo_redemptions from public,anon,authenticated,service_role;

create or replace function public.get_entitlement() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  s public.subscriptions;
  t public.trials;
  p public.profiles;
  r public.promo_redemptions;
  stamp timestamptz:=statement_timestamp();
  paid_end timestamptz;
begin
  if u is null then
    return jsonb_build_object('status','free','pro',false,'source','anonymous',
      'trial_used',false,'trial_available',false,'server_now',stamp);
  end if;

  select * into p from public.profiles where id=u;
  select * into s from public.subscriptions where user_id=u;
  select * into t from public.trials where user_id=u;
  select * into r
    from public.promo_redemptions
    where user_id=u and starts_at<=stamp and ends_at>stamp
    order by ends_at desc limit 1;

  if p.id is null or s.id is null or t.id is null then
    raise exception 'Conta não inicializada';
  end if;

  paid_end:=greatest(coalesce(s.current_period_end,'-infinity'::timestamptz),
    coalesce(s.grace_until,'-infinity'::timestamptz));

  if p.role='admin' and s.access_override='admin' then
    return jsonb_build_object('status','pro_active','pro',true,'source','admin',
      'trial_used',t.trial_used,'trial_available',false,'server_now',stamp);
  elsif s.status='pro_active' and paid_end>stamp then
    return jsonb_build_object('status','pro_active','pro',true,'source','subscription',
      'trial_used',t.trial_used,'trial_available',false,'started_at',s.started_at,
      'ends_at',paid_end,'server_now',stamp);
  elsif r.id is not null then
    return jsonb_build_object('status','pro_active','pro',true,'source','promo',
      'trial_used',t.trial_used,'trial_available',false,'started_at',r.starts_at,
      'ends_at',r.ends_at,'server_now',stamp,'promo_code',r.code_snapshot);
  elsif t.trial_used and t.ends_at>stamp then
    return jsonb_build_object('status','trial','pro',true,'source','trial',
      'trial_used',true,'trial_available',false,'started_at',t.started_at,
      'ends_at',t.ends_at,'server_now',stamp);
  elsif t.trial_used then
    return jsonb_build_object('status','pro_expired','pro',false,'source','trial',
      'trial_used',true,'trial_available',false,'started_at',t.started_at,
      'ends_at',t.ends_at,'server_now',stamp);
  elsif s.status in ('pro_active','pro_expired') then
    return jsonb_build_object('status','pro_expired','pro',false,'source','subscription',
      'trial_used',false,'trial_available',false,'started_at',s.started_at,
      'ends_at',nullif(paid_end,'-infinity'::timestamptz),'server_now',stamp);
  end if;

  return jsonb_build_object('status','free','pro',false,'source','account',
    'trial_used',false,'trial_available',true,'server_now',stamp);
end $$;
revoke all on function public.get_entitlement() from public,anon,authenticated;
grant execute on function public.get_entitlement() to authenticated;
create or replace function public.redeem_promo_code(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  pc public.promo_codes;
  t public.trials;
  s public.subscriptions;
  stamp timestamptz:=statement_timestamp();
  promo_start timestamptz;
  promo_end timestamptz;
  paid_end timestamptz;
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  if p_code is null or length(trim(p_code))=0 then raise exception 'Informe um código promocional'; end if;

  if not exists(
    select 1 from public.profiles
    where id=u and is_adult_confirmed and terms_accepted_at is not null and privacy_accepted_at is not null
  ) then raise exception 'Conclua o cadastro antes de usar um código'; end if;

  if exists(select 1 from public.promo_redemptions where user_id=u) then
    raise exception 'Esta conta já utilizou um código promocional';
  end if;

  select * into pc from public.promo_codes
    where code=upper(trim(p_code)) for update;
  if pc.id is null then raise exception 'Código promocional inválido'; end if;
  if not pc.active then raise exception 'Este código promocional está desativado'; end if;
  if pc.valid_from>stamp then raise exception 'Este código promocional ainda não está disponível'; end if;
  if pc.expires_at is not null and pc.expires_at<=stamp then raise exception 'Este código promocional expirou'; end if;
  if pc.redemption_count>=pc.max_redemptions then
    raise exception 'Este código promocional atingiu o limite de usos';
  end if;
  if pc.exclusive_user_id is not null and pc.exclusive_user_id<>u then
    raise exception 'Este código promocional não está disponível para esta conta';
  end if;

  select * into s from public.subscriptions where user_id=u for update;
  select * into t from public.trials where user_id=u for update;
  if s.id is null or t.id is null then raise exception 'Conta não inicializada'; end if;

  paid_end:=greatest(coalesce(s.current_period_end,'-infinity'::timestamptz),
    coalesce(s.grace_until,'-infinity'::timestamptz));
  if s.status='pro_active' and paid_end>stamp then
    raise exception 'Sua assinatura PRO já está ativa';
  end if;

  promo_start:=case when t.trial_used and t.ends_at>stamp then t.ends_at else stamp end;
  promo_end:=promo_start+make_interval(days=>pc.duration_days);

  insert into public.promo_redemptions(
    promo_code_id,user_id,code_snapshot,duration_days,redeemed_at,starts_at,ends_at
  ) values (
    pc.id,u,pc.code,pc.duration_days,stamp,promo_start,promo_end
  );

  update public.promo_codes
    set redemption_count=redemption_count+1,updated_at=stamp
    where id=pc.id;

  insert into public.audit_logs(user_id,action) values(u,'promo_redeemed');

  return jsonb_build_object(
    'code','PROMO_REDEEMED',
    'promo_code',pc.code,
    'duration_days',pc.duration_days,
    'starts_at',promo_start,
    'ends_at',promo_end,
    'entitlement',public.get_entitlement()
  );
end $$;
revoke all on function public.redeem_promo_code(text) from public,anon,authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;

create or replace function public.admin_create_promo_code(
  p_code text,
  p_duration_days integer,
  p_max_redemptions integer,
  p_expires_at timestamptz default null,
  p_exclusive_email text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  normalized_code text:=upper(trim(coalesce(p_code,'')));
  exclusive_id uuid;
  created public.promo_codes;
  stamp timestamptz:=statement_timestamp();
begin
  if u is null or not exists(select 1 from public.profiles where id=u and role='admin') then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  if normalized_code !~ '^[A-Z0-9][A-Z0-9_-]{3,31}$' then
    raise exception 'Código promocional inválido';
  end if;
  if p_duration_days not in (30,60,90) then
    raise exception 'Duração promocional inválida';
  end if;
  if p_max_redemptions is null or p_max_redemptions not between 1 and 100000 then
    raise exception 'Limite de usos inválido';
  end if;
  if p_expires_at is not null and p_expires_at<=stamp then
    raise exception 'A validade precisa estar no futuro';
  end if;

  if nullif(trim(coalesce(p_exclusive_email,'')),'') is not null then
    select id into exclusive_id from public.profiles
      where lower(email)=lower(trim(p_exclusive_email)) limit 1;
    if exclusive_id is null then raise exception 'Conta exclusiva não encontrada'; end if;
  end if;

  insert into public.promo_codes(
    code,duration_days,max_redemptions,expires_at,exclusive_user_id,active,created_by
  ) values (
    normalized_code,p_duration_days,p_max_redemptions,p_expires_at,exclusive_id,true,u
  ) returning * into created;

  insert into public.audit_logs(user_id,action) values(u,'promo_code_created');

  return jsonb_build_object(
    'code',created.code,'duration_days',created.duration_days,
    'max_redemptions',created.max_redemptions,'redemption_count',created.redemption_count,
    'active',created.active,'expires_at',created.expires_at,
    'exclusive',created.exclusive_user_id is not null,'created_at',created.created_at
  );
end $$;
revoke all on function public.admin_create_promo_code(text,integer,integer,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.admin_create_promo_code(text,integer,integer,timestamptz,text)
  to authenticated;

create or replace function public.admin_set_promo_code_active(
  p_code text,p_active boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  changed public.promo_codes;
begin
  if u is null or not exists(select 1 from public.profiles where id=u and role='admin') then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  if p_active is null then raise exception 'Estado inválido'; end if;

  update public.promo_codes
    set active=p_active,updated_at=statement_timestamp()
    where code=upper(trim(coalesce(p_code,'')))
    returning * into changed;
  if changed.id is null then raise exception 'Código promocional não encontrado'; end if;

  insert into public.audit_logs(user_id,action)
    values(u,case when p_active then 'promo_code_activated' else 'promo_code_deactivated' end);
  return jsonb_build_object('code',changed.code,'active',changed.active);
end $$;
revoke all on function public.admin_set_promo_code_active(text,boolean)
  from public,anon,authenticated;
grant execute on function public.admin_set_promo_code_active(text,boolean)
  to authenticated;

create or replace function public.get_admin_promo_codes() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  result jsonb;
begin
  if u is null or not exists(select 1 from public.profiles where id=u and role='admin') then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code',pc.code,
    'duration_days',pc.duration_days,
    'max_redemptions',pc.max_redemptions,
    'redemption_count',pc.redemption_count,
    'remaining',greatest(pc.max_redemptions-pc.redemption_count,0),
    'active',pc.active,
    'valid_from',pc.valid_from,
    'expires_at',pc.expires_at,
    'exclusive',pc.exclusive_user_id is not null,
    'created_at',pc.created_at
  ) order by pc.created_at desc),'[]'::jsonb)
  into result
  from public.promo_codes pc;

  return result;
end $$;
revoke all on function public.get_admin_promo_codes() from public,anon,authenticated;
grant execute on function public.get_admin_promo_codes() to authenticated;
create or replace function public.get_admin_promo_redemptions(p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  result jsonb;
begin
  if u is null or not exists(select 1 from public.profiles where id=u and role='admin') then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',r.user_id,
    'email',p.email,
    'name',p.name,
    'redeemed_at',r.redeemed_at,
    'starts_at',r.starts_at,
    'ends_at',r.ends_at
  ) order by r.redeemed_at desc),'[]'::jsonb)
  into result
  from public.promo_redemptions r
  join public.promo_codes pc on pc.id=r.promo_code_id
  join public.profiles p on p.id=r.user_id
  where pc.code=upper(trim(coalesce(p_code,'')));

  return result;
end $$;
revoke all on function public.get_admin_promo_redemptions(text) from public,anon,authenticated;
grant execute on function public.get_admin_promo_redemptions(text) to authenticated;

commit;
