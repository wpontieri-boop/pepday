-- P1+P2 PROD promotion authorized by owner on 08/10/2026. No TEST data, no P3.
-- Sources preserved below; only environment/issuer guards change. Gates default OFF.
begin;
do $$begin
 if to_regclass('public.partners') is not null then raise exception 'PARTNERS_ALREADY_EXISTS_RECONCILE';end if;
 if md5(pg_get_functiondef('public.claim_card_acquisition(timestamptz)'::regprocedure))<>'4b66fcb9c9c68b33883ab10ad95dc03a'
 or md5(pg_get_functiondef('public.get_entitlement()'::regprocedure))<>'329cdee20d77a221ec365af6a4fb0de6'
 or md5(pg_get_functiondef('public.export_my_data()'::regprocedure))<>'185c06d43cb30c0015b731aafaaf4bf6' then raise exception 'COMMERCIAL_BASELINE_CHANGED_RECONCILE';end if;
end $$;

-- Approved stage: 20261006213126_partners_p1_test
-- Approved TEST stage promoted to PROD; no commercial changes.

do $$begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url'
    and decrypted_secret='https://oslefjmwfnddxlotalxu.supabase.co') then
    raise exception 'PARTNERS_PRODUCTION_ONLY';
  end if;
end $$;

create table public.partner_config(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.partner_config values(true,false);
create table public.partners(
  id uuid primary key default gen_random_uuid(),
  public_name text not null check(length(trim(public_name)) between 2 and 100),
  partner_type text not null check(partner_type in ('loja','promotor','influenciador','campanha')),
  city text not null default '' check(length(city)<=80),
  description text not null default '' check(length(description)<=160),
  slug text not null unique check(slug ~ '^[a-z0-9-]{2,100}$'),
  public_code text not null unique check(public_code ~ '^[A-Z0-9]{8}$'),
  status text not null default 'draft' check(status in ('draft','active','suspended','archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create index partners_creator_idx on public.partners(created_by);
create index partners_active_name_idx on public.partners(status,lower(public_name));
create table public.partner_private_profiles(
  partner_id uuid primary key references public.partners(id) on delete restrict,
  legal_name text not null default '' check(length(legal_name)<=160),
  document text unique,
  email text not null default '' check(length(email)<=254),
  phone text not null default '' check(length(phone)<=30),
  pix_type text check(pix_type in ('cpf','cnpj','email','phone','random')),
  pix_key text,
  payee_name text,
  version integer not null default 0,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz
);
create index partner_private_verifier_idx on public.partner_private_profiles(verified_by);
create table public.partner_commission_rules(
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  version integer not null,
  commission_percent numeric(5,2) not null check(commission_percent between 0 and 100),
  mode text not null default 'first_payment' check(mode='first_payment'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  unique(partner_id,version)
);
create index partner_rules_creator_idx on public.partner_commission_rules(created_by);
create table public.partner_stepup_tickets(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  partner_id uuid not null references public.partners(id) on delete cascade,
  payload_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index partner_stepup_actor_idx on public.partner_stepup_tickets(actor_id);
create index partner_stepup_partner_idx on public.partner_stepup_tickets(partner_id);
create table public.partner_search_quota(
  bucket timestamptz primary key,
  requests integer not null
);
do $$declare t text;begin
  foreach t in array array['partner_config','partners','partner_private_profiles','partner_commission_rules','partner_stepup_tickets','partner_search_quota'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create function public.partner_admin_assert(p_write boolean default false,p_owner boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare level text; sid uuid;
begin
  if coalesce(auth.jwt()->>'iss','')<>'https://oslefjmwfnddxlotalxu.supabase.co/auth/v1' then
    raise exception 'PARTNERS_PRODUCTION_ONLY' using errcode='42501';
  end if;
  level:=public.admin_assert_access(p_write,p_owner);
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then
    raise exception 'PARTNER_SESSION_REVOKED' using errcode='42501';
  end if;
  if not exists(select 1 from public.partner_config where enabled) then
    raise exception 'PARTNERS_DISABLED' using errcode='42501';
  end if;
  return level;
end $$;

-- Numeric CPF and numeric/alphanumeric CNPJ; checksum is not identity verification.
create function public.partner_document_valid(p_document text) returns boolean
language plpgsql immutable set search_path='' as $$
declare d text:=upper(p_document); total integer; digit integer; i integer; j integer; weight integer;
begin
  if d is null or d ~ '^([0-9])\1+$' then return false; end if;
  if d ~ '^[0-9]{11}$' then
    for j in 10..11 loop
      total:=0;
      for i in 1..j-1 loop total:=total+substr(d,i,1)::integer*(j+1-i); end loop;
      digit:=(total*10)%11; if digit=10 then digit:=0; end if;
      if digit<>substr(d,j,1)::integer then return false; end if;
    end loop;
    return true;
  elsif d ~ '^[A-Z0-9]{12}[0-9]{2}$' then
    for j in 13..14 loop
      total:=0; weight:=2;
      for i in reverse j-1..1 loop
        total:=total+(ascii(substr(d,i,1))-48)*weight;
        weight:=case when weight=9 then 2 else weight+1 end;
      end loop;
      digit:=case when total%11<2 then 0 else 11-total%11 end;
      if digit<>substr(d,j,1)::integer then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

create function public.admin_list_partners(p_query text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare level text;begin
  level:=public.partner_admin_assert(false,false);
  if length(p_query)>100 then raise exception 'PARTNER_INVALID_QUERY'; end if;
  return coalesce((select jsonb_agg(item order by item->>'public_name') from (
    select jsonb_build_object('id',p.id,'public_name',p.public_name,'partner_type',p.partner_type,
      'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code,'status',p.status,
      'commission_percent',(select r.commission_percent from public.partner_commission_rules r where r.partner_id=p.id order by version desc limit 1),
      'financial_ready',v.verified_at is not null,
      'contact',case when level='viewer' then null else jsonb_build_object('email',v.email,'phone',v.phone) end,
      'document_masked',case when level='viewer' then null when v.document is null then null else '••••'||right(v.document,4) end) item
    from public.partners p join public.partner_private_profiles v on v.partner_id=p.id
    where strpos(lower(p.public_name||' '||p.city||' '||p.public_code),lower(trim(coalesce(p_query,''))))>0
    order by p.public_name,p.id limit 100
  ) s),'[]'::jsonb);
end $$;

create function public.admin_save_partner(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid:=p_id; base text; suffix text; short_code text; old_status text;
begin
  perform public.partner_admin_assert(true,false);
  if jsonb_typeof(p_data)<>'object' or p_data is null or (p_data-array['public_name','partner_type','city','description','email','phone'])<>'{}'::jsonb
    or length(trim(coalesce(p_data->>'public_name','')))<2
    or length(coalesce(p_data->>'email',''))>254 or length(coalesce(p_data->>'phone',''))>30 then raise exception 'PARTNER_INVALID_DATA'; end if;
  if coalesce(p_data->>'email','')<>'' and (p_data->>'email')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'PARTNER_INVALID_EMAIL'; end if;
  if pid is null then
    pid:=gen_random_uuid(); suffix:=replace(pid::text,'-','');
    base:=trim(both '-' from regexp_replace(lower(translate(p_data->>'public_name','áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+','-','g'));
    if length(base)<2 then base:='parceiro'; end if;
    base:=left(base,60);
    -- Advisory lock serializes identical names; UUID suffix protects every collision.
    perform pg_advisory_xact_lock(hashtextextended(base,0));
    if exists(select 1 from public.partners where slug=left(base,60)) then base:=left(base,60)||'-'||suffix; end if;
    loop
      short_code:=upper(left(replace(gen_random_uuid()::text,'-',''),8));
      perform pg_advisory_xact_lock(hashtextextended(short_code,1));
      exit when not exists(select 1 from public.partners where public_code=short_code);
    end loop;
    insert into public.partners(id,public_name,partner_type,city,description,slug,public_code,created_by)
    values(pid,trim(p_data->>'public_name'),p_data->>'partner_type',trim(coalesce(p_data->>'city','')),trim(coalesce(p_data->>'description','')),left(base,100),short_code,auth.uid());
    insert into public.partner_private_profiles(partner_id,email,phone) values(pid,lower(trim(coalesce(p_data->>'email',''))),trim(coalesce(p_data->>'phone','')));
  else
    select status into old_status from public.partners where id=pid for update;
    if old_status is null or old_status='archived' then raise exception 'PARTNER_NOT_EDITABLE'; end if;
    update public.partners set public_name=trim(p_data->>'public_name'),partner_type=p_data->>'partner_type',city=trim(coalesce(p_data->>'city','')),description=trim(coalesce(p_data->>'description','')),updated_at=statement_timestamp() where id=pid;
    update public.partner_private_profiles set email=lower(trim(coalesce(p_data->>'email',''))),phone=trim(coalesce(p_data->>'phone','')) where partner_id=pid;
  end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_saved',jsonb_build_object('partner_id',pid,'created',p_id is null));
  return pid;
end $$;

create function public.admin_prepare_partner_stepup(p_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare proof jsonb; method text; stamp numeric; pwd boolean:=false; totp boolean:=false; ticket uuid;
begin
  perform public.partner_admin_assert(true,true);
  for proof in select value from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) loop
    method:=proof->>'method';
    if (proof->>'timestamp') ~ '^[0-9]+$' then
      stamp:=(proof->>'timestamp')::numeric;
      if stamp between extract(epoch from statement_timestamp())-300 and extract(epoch from statement_timestamp())+5 then
        pwd:=pwd or method='password'; totp:=totp or method='totp';
      end if;
    end if;
  end loop;
  if not pwd or not totp then raise exception 'PARTNER_RECENT_PASSWORD_TOTP_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified' and factor_type='totp') then raise exception 'PARTNER_TOTP_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.partners where id=p_id and status<>'archived') or jsonb_typeof(p_payload)<>'object' or p_payload is null or octet_length(p_payload::text)>4096 then raise exception 'PARTNER_INVALID_TARGET'; end if;
  delete from public.partner_stepup_tickets where actor_id=auth.uid() and (expires_at<statement_timestamp() or used_at is not null);
  insert into public.partner_stepup_tickets(actor_id,session_id,partner_id,payload_hash,expires_at)
  values(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_id,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),statement_timestamp()+interval '5 minutes') returning id into ticket;
  return ticket;
end $$;

create function public.admin_configure_partner(p_id uuid,p_payload jsonb,p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d text; pct numeric; v integer; old_pct numeric; changed integer;
begin
  perform public.partner_admin_assert(true,true);
  perform 1 from public.partners where id=p_id and status<>'archived' for update;
  if not found then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (p_payload-array['legal_name','document','pix_type','pix_key','payee_name','commission_percent','reason'])<>'{}'::jsonb then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  d:=upper(regexp_replace(coalesce(p_payload->>'document',''),'[. /-]','','g'));
  if not public.partner_document_valid(d) or length(trim(coalesce(p_payload->>'legal_name',''))) not between 2 and 160
    or length(trim(coalesce(p_payload->>'payee_name',''))) not between 2 and 160
    or coalesce(p_payload->>'reason','') not in ('configuracao_inicial','ajuste_contratual','correcao_pagamento')
    or coalesce(p_payload->>'commission_percent','')!~ '^([0-9]{1,3})(\.[0-9]{1,2})?$' then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  pct:=(p_payload->>'commission_percent')::numeric;
  if pct<0 or pct>100 then raise exception 'PARTNER_INVALID_PERCENT'; end if;
  if length(coalesce(p_payload->>'pix_key','')) not between 3 and 254 or
    (case p_payload->>'pix_type'
      when 'cpf' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>11
      when 'cnpj' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>14
      when 'email' then (p_payload->>'pix_key')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      when 'phone' then (p_payload->>'pix_key')!~ '^\+[0-9]{10,15}$'
      when 'random' then (p_payload->>'pix_key')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      else true end) then raise exception 'PARTNER_INVALID_PIX'; end if;
  update public.partner_stepup_tickets set used_at=statement_timestamp()
    where id=p_ticket and actor_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid and partner_id=p_id
      and used_at is null and expires_at>statement_timestamp()
      and payload_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501'; end if;
  select coalesce(max(version),0)+1 into v from public.partner_commission_rules where partner_id=p_id;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  update public.partner_private_profiles set legal_name=trim(p_payload->>'legal_name'),document=d,
    pix_type=p_payload->>'pix_type',pix_key=trim(p_payload->>'pix_key'),payee_name=trim(p_payload->>'payee_name'),version=version+1,verified_by=auth.uid(),verified_at=statement_timestamp() where partner_id=p_id;
  insert into public.partner_commission_rules(partner_id,version,commission_percent,created_by) values(p_id,v,pct,auth.uid());
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_financial_configured',
    jsonb_build_object('partner_id',p_id,'rule_version',v,'old_percent',old_pct,'new_percent',pct,'document_masked','••••'||right(d,4),'payment_profile_changed',true,'reason',p_payload->>'reason'));
  return jsonb_build_object('configured',true,'rule_version',v);
end $$;

create function public.admin_set_partner_status(p_id uuid,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare old text;begin
  perform public.partner_admin_assert(true,false);
  if p_status is null or p_status not in ('active','suspended','archived') or p_reason is null or p_reason not in ('cadastro_concluido','pausa_comercial','encerramento','ajuste_cadastral') then raise exception 'PARTNER_INVALID_STATUS'; end if;
  select status into old from public.partners where id=p_id for update;
  if old is null or old='archived' then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_status='active' and not exists(select 1 from public.partner_private_profiles v
      where v.partner_id=p_id and v.verified_at is not null and v.email<>'' and v.phone<>''
        and exists(select 1 from public.partner_commission_rules r where r.partner_id=p_id)) then raise exception 'PARTNER_FINANCIAL_CONFIGURATION_REQUIRED'; end if;
  update public.partners set status=p_status,updated_at=statement_timestamp() where id=p_id;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_status_changed',jsonb_build_object('partner_id',p_id,'from',old,'to',p_status,'reason',p_reason));
end $$;

-- Only the constrained public Edge may invoke this; global quota cannot be spoofed by client IP headers.
create function public.partner_public_search(p_query text default '',p_ref text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer; bucket_at timestamptz:=date_trunc('minute',statement_timestamp());
begin
  if not exists(select 1 from public.partner_config where enabled) then return jsonb_build_object('enabled',false,'partners','[]'::jsonb); end if;
  if length(coalesce(p_query,''))>80 or length(coalesce(p_ref,''))>100 then raise exception 'PARTNER_INVALID_QUERY'; end if;
  delete from public.partner_search_quota where bucket<bucket_at-interval '2 minutes';
  insert into public.partner_search_quota values(bucket_at,1) on conflict(bucket) do update set requests=partner_search_quota.requests+1 returning requests into n;
  if n>120 then return jsonb_build_object('enabled',true,'limited',true,'partners','[]'::jsonb); end if;
  return jsonb_build_object('enabled',true,'partners',coalesce((select jsonb_agg(item) from (
    select jsonb_build_object('id',id,'public_name',public_name,'partner_type',partner_type,'city',city,'description',description,'slug',slug,'public_code',public_code) item
    from public.partners where status='active' and
      ((p_ref<>'' and (slug=lower(p_ref) or public_code=upper(p_ref))) or
       (p_ref='' and length(trim(p_query))>=2 and strpos(lower(public_name||' '||city||' '||description),lower(trim(p_query)))>0))
    order by public_name,id limit 10
  ) s),'[]'::jsonb));
end $$;

revoke all on function public.partner_admin_assert(boolean,boolean), public.partner_document_valid(text),
  public.admin_list_partners(text),public.admin_save_partner(uuid,jsonb),public.admin_prepare_partner_stepup(uuid,jsonb),
  public.admin_configure_partner(uuid,jsonb,uuid),public.admin_set_partner_status(uuid,text,text),public.partner_public_search(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_partners(text),public.admin_save_partner(uuid,jsonb),public.admin_prepare_partner_stepup(uuid,jsonb),
  public.admin_configure_partner(uuid,jsonb,uuid),public.admin_set_partner_status(uuid,text,text) to authenticated;
grant execute on function public.partner_public_search(text,text) to service_role;



-- Approved stage: 20261007013353_partners_p1_ux_session
-- Approved TEST stage promoted to PROD; no commercial changes.

do $$begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url'
    and decrypted_secret='https://oslefjmwfnddxlotalxu.supabase.co') then
    raise exception 'PARTNERS_PRODUCTION_ONLY';
  end if;
end $$;

alter table public.partners add column first_activated_at timestamptz;
-- Conservative backfill protects previously operational partners, including suspended ones.
update public.partners set first_activated_at=updated_at where status<>'draft'
  or exists(select 1 from public.admin_audit_logs a where a.action='partner_status_changed'
    and a.metadata->>'partner_id'=partners.id::text and a.metadata->>'to'='active');
alter table public.partner_private_profiles add column contact_name text not null default '' check(length(contact_name)<=120);
-- A valid login is bounded by server session creation AND signed password/TOTP proofs.
-- Token refresh or a later MFA challenge cannot extend the eight-hour window.
create function public.partner_assert_operational_login() returns void
language plpgsql security definer set search_path='' as $$
declare proof jsonb; stamp numeric; pwd boolean:=false; totp boolean:=false;
begin
  if not exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid
    and user_id=auth.uid() and created_at>statement_timestamp()-interval '8 hours'
    and created_at<=statement_timestamp()+interval '5 seconds'
    and (not_after is null or not_after>statement_timestamp())) then
    raise exception 'PARTNER_LOGIN_EXPIRED' using errcode='42501';
  end if;
  for proof in select value from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) loop
    if (proof->>'timestamp') ~ '^[0-9]+$' then
      stamp:=(proof->>'timestamp')::numeric;
      if stamp>extract(epoch from statement_timestamp())-28800 and stamp<=extract(epoch from statement_timestamp())+5 then
        pwd:=pwd or proof->>'method'='password'; totp:=totp or proof->>'method'='totp';
      end if;
    end if;
  end loop;
  if not pwd or not totp or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified' and factor_type='totp') then
    raise exception 'PARTNER_LOGIN_EXPIRED' using errcode='42501';
  end if;
end $$;
revoke all on function public.partner_assert_operational_login() from public,anon,authenticated,service_role;

create or replace function public.partner_admin_assert(p_write boolean default false,p_owner boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare level text; sid uuid;
begin
  if coalesce(auth.jwt()->>'iss','')<>'https://oslefjmwfnddxlotalxu.supabase.co/auth/v1' then
    raise exception 'PARTNERS_PRODUCTION_ONLY' using errcode='42501';
  end if;
  level:=public.admin_assert_access(p_write,p_owner);
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then
    raise exception 'PARTNER_SESSION_REVOKED' using errcode='42501';
  end if;
  if not exists(select 1 from public.partner_config where enabled) then
    raise exception 'PARTNERS_DISABLED' using errcode='42501';
  end if;
  perform public.partner_assert_operational_login();
  return level;
end $$;
create or replace function public.admin_list_partners(p_query text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare level text;begin
  level:=public.partner_admin_assert(false,false);
  if length(p_query)>100 then raise exception 'PARTNER_INVALID_QUERY'; end if;
  return coalesce((select jsonb_agg(item order by item->>'public_name') from (
    select jsonb_build_object('id',p.id,'public_name',p.public_name,'partner_type',p.partner_type,
      'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code,'status',p.status,
      'commission_percent',(select r.commission_percent from public.partner_commission_rules r where r.partner_id=p.id order by version desc limit 1),
      'financial_ready',v.verified_at is not null,'requires_stepup',p.first_activated_at is not null,
      'contact',case when level='viewer' then null else jsonb_build_object('name',v.contact_name,'email',v.email,'phone',v.phone) end,
      'document_masked',case when level='viewer' then null when v.document is null then null else '••••'||right(v.document,4) end) item
    from public.partners p join public.partner_private_profiles v on v.partner_id=p.id
    where strpos(lower(p.public_name||' '||p.city||' '||p.public_code),lower(trim(coalesce(p_query,''))))>0
    order by p.public_name,p.id limit 100
  ) s),'[]'::jsonb);
end $$;
create or replace function public.admin_save_partner(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid:=p_id; base text; suffix text; short_code text; old_status text;
begin
  perform public.partner_admin_assert(true,false);
  if jsonb_typeof(p_data)<>'object' or p_data is null or (p_data-array['public_name','partner_type','city','description','email','phone','contact_name'])<>'{}'::jsonb
    or length(trim(coalesce(p_data->>'public_name','')))<2
    or length(coalesce(p_data->>'contact_name',''))>120 or length(coalesce(p_data->>'email',''))>254 or length(coalesce(p_data->>'phone',''))>30 then raise exception 'PARTNER_INVALID_DATA'; end if;
  if coalesce(p_data->>'email','')<>'' and (p_data->>'email')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'PARTNER_INVALID_EMAIL'; end if;
  if pid is null then
    pid:=gen_random_uuid(); suffix:=replace(pid::text,'-','');
    base:=trim(both '-' from regexp_replace(lower(translate(p_data->>'public_name','áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+','-','g'));
    if length(base)<2 then base:='parceiro'; end if;
    base:=left(base,60);
    -- Advisory lock serializes identical names; UUID suffix protects every collision.
    perform pg_advisory_xact_lock(hashtextextended(base,0));
    if exists(select 1 from public.partners where slug=left(base,60)) then base:=left(base,60)||'-'||suffix; end if;
    loop
      short_code:=upper(left(replace(gen_random_uuid()::text,'-',''),8));
      perform pg_advisory_xact_lock(hashtextextended(short_code,1));
      exit when not exists(select 1 from public.partners where public_code=short_code);
    end loop;
    insert into public.partners(id,public_name,partner_type,city,description,slug,public_code,created_by)
    values(pid,trim(p_data->>'public_name'),p_data->>'partner_type',trim(coalesce(p_data->>'city','')),trim(coalesce(p_data->>'description','')),left(base,100),short_code,auth.uid());
    insert into public.partner_private_profiles(partner_id,contact_name,email,phone) values(pid,trim(coalesce(p_data->>'contact_name','')),lower(trim(coalesce(p_data->>'email',''))),trim(coalesce(p_data->>'phone','')));
  else
    select status into old_status from public.partners where id=pid for update;
    if old_status is null or old_status='archived' then raise exception 'PARTNER_NOT_EDITABLE'; end if;
    update public.partners set public_name=trim(p_data->>'public_name'),partner_type=p_data->>'partner_type',city=trim(coalesce(p_data->>'city','')),description=trim(coalesce(p_data->>'description','')),updated_at=statement_timestamp() where id=pid;
    update public.partner_private_profiles set contact_name=trim(coalesce(p_data->>'contact_name','')),email=lower(trim(coalesce(p_data->>'email',''))),phone=trim(coalesce(p_data->>'phone','')) where partner_id=pid;
  end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_saved',jsonb_build_object('partner_id',pid,'created',p_id is null));
  return pid;
end $$;
create or replace function public.admin_configure_partner(p_id uuid,p_payload jsonb,p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d text; pct numeric; v integer; old_pct numeric; changed integer; critical boolean;
begin
  perform public.partner_admin_assert(true,true);
  perform 1 from public.partners where id=p_id and status<>'archived' for update;
  if not found then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (p_payload-array['legal_name','document','pix_type','pix_key','payee_name','commission_percent','reason'])<>'{}'::jsonb then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  d:=upper(regexp_replace(coalesce(p_payload->>'document',''),'[. /-]','','g'));
  if not public.partner_document_valid(d) or length(trim(coalesce(p_payload->>'legal_name',''))) not between 2 and 160
    or length(trim(coalesce(p_payload->>'payee_name',''))) not between 2 and 160
    or coalesce(p_payload->>'reason','') not in ('configuracao_inicial','ajuste_contratual','correcao_pagamento')
    or coalesce(p_payload->>'commission_percent','')!~ '^([0-9]{1,3})(\.[0-9]{1,2})?$' then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  pct:=(p_payload->>'commission_percent')::numeric;
  if pct<0 or pct>100 then raise exception 'PARTNER_INVALID_PERCENT'; end if;
  if length(coalesce(p_payload->>'pix_key','')) not between 3 and 254 or
    (case p_payload->>'pix_type'
      when 'cpf' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>11
      when 'cnpj' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>14
      when 'email' then (p_payload->>'pix_key')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      when 'phone' then (p_payload->>'pix_key')!~ '^\+[0-9]{10,15}$'
      when 'random' then (p_payload->>'pix_key')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      else true end) then raise exception 'PARTNER_INVALID_PIX'; end if;
  select first_activated_at is not null into critical from public.partners where id=p_id;
  if critical and p_ticket is null then raise exception 'PARTNER_STEPUP_REQUIRED' using errcode='42501'; end if;
  if critical or p_ticket is not null then
  update public.partner_stepup_tickets set used_at=statement_timestamp()
    where id=p_ticket and actor_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid and partner_id=p_id
      and used_at is null and expires_at>statement_timestamp()
      and payload_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501'; end if;
  end if;
  select coalesce(max(version),0)+1 into v from public.partner_commission_rules where partner_id=p_id;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  update public.partner_private_profiles set legal_name=trim(p_payload->>'legal_name'),document=d,
    pix_type=p_payload->>'pix_type',pix_key=trim(p_payload->>'pix_key'),payee_name=trim(p_payload->>'payee_name'),version=version+1,verified_by=auth.uid(),verified_at=statement_timestamp() where partner_id=p_id;
  insert into public.partner_commission_rules(partner_id,version,commission_percent,created_by) values(p_id,v,pct,auth.uid());
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_financial_configured',
    jsonb_build_object('partner_id',p_id,'rule_version',v,'old_percent',old_pct,'new_percent',pct,'document_masked','••••'||right(d,4),'authorization',case when critical then 'critical_stepup' when p_ticket is not null then 'explicit_stepup' else 'operational_login' end,'payment_profile_changed',true,'reason',p_payload->>'reason'));
  return jsonb_build_object('configured',true,'rule_version',v);
end $$;
create or replace function public.admin_set_partner_status(p_id uuid,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare old text;begin
  perform public.partner_admin_assert(true,false);
  if p_status is null or p_status not in ('active','suspended','archived') or p_reason is null or p_reason not in ('cadastro_concluido','pausa_comercial','encerramento','ajuste_cadastral') then raise exception 'PARTNER_INVALID_STATUS'; end if;
  select status into old from public.partners where id=p_id for update;
  if old is null or old='archived' then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_status='active' and not exists(select 1 from public.partner_private_profiles v
      where v.partner_id=p_id and v.verified_at is not null and v.email<>'' and v.phone<>''
        and exists(select 1 from public.partner_commission_rules r where r.partner_id=p_id)) then raise exception 'PARTNER_FINANCIAL_CONFIGURATION_REQUIRED'; end if;
  update public.partners set status=p_status,first_activated_at=case when p_status='active' then coalesce(first_activated_at,statement_timestamp()) else first_activated_at end,updated_at=statement_timestamp() where id=p_id;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_status_changed',jsonb_build_object('partner_id',p_id,'from',old,'to',p_status,'reason',p_reason));
end $$;



-- Approved stage: 20261007022142_partners_financial_patch
-- Approved TEST stage promoted to PROD; no commercial changes.

do $$begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url'
    and decrypted_secret='https://oslefjmwfnddxlotalxu.supabase.co') then
    raise exception 'PARTNERS_PRODUCTION_ONLY';
  end if;
end $$;

drop function public.admin_list_partners(text);
create function public.admin_list_partners(p_query text default '',p_include_archived boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare level text;begin
  level:=public.partner_admin_assert(false,false);
  if length(p_query)>100 then raise exception 'PARTNER_INVALID_QUERY'; end if;
  return coalesce((select jsonb_agg(item order by case item->>'status' when 'active' then 0 when 'draft' then 1 when 'suspended' then 2 else 3 end,item->>'public_name',item->>'id') from (
    select jsonb_build_object('id',p.id,'public_name',p.public_name,'partner_type',p.partner_type,
      'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code,'status',p.status,
      'commission_percent',(select r.commission_percent from public.partner_commission_rules r where r.partner_id=p.id order by version desc limit 1),
      'financial_ready',v.verified_at is not null,'requires_stepup',p.first_activated_at is not null,
      'financial',case when level='owner' and v.verified_at is not null then jsonb_build_object('legal_name',v.legal_name,'document_masked','••••'||right(v.document,4),'payee_name_masked','••••••••','pix_type',v.pix_type,'pix_key_masked',case when length(v.pix_key)>8 then '••••'||right(v.pix_key,4) else '••••••••' end) else null end,
      'contact',case when level='viewer' then null else jsonb_build_object('name',v.contact_name,'email',v.email,'phone',v.phone) end,
      'document_masked',case when level='viewer' then null when v.document is null then null else '••••'||right(v.document,4) end) item
    from public.partners p join public.partner_private_profiles v on v.partner_id=p.id
    where (coalesce(p_include_archived,false) or p.status<>'archived') and strpos(lower(p.public_name||' '||p.city||' '||p.public_code),lower(trim(coalesce(p_query,''))))>0
    order by case p.status when 'active' then 0 when 'draft' then 1 when 'suspended' then 2 else 3 end,p.public_name,p.id limit 100
  ) s),'[]'::jsonb);
end $$;
revoke all on function public.admin_list_partners(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_partners(text,boolean) to authenticated;

create or replace function public.admin_configure_partner(p_id uuid,p_payload jsonb,p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d text; pct numeric; v integer; old_pct numeric; changed integer; critical boolean; requested jsonb:=p_payload; profile public.partner_private_profiles%rowtype; profile_changed boolean;
begin
  perform public.partner_admin_assert(true,true);
  perform 1 from public.partners where id=p_id and status<>'archived' for update;
  if not found then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (p_payload-array['legal_name','document','pix_type','pix_key','payee_name','commission_percent','reason'])<>'{}'::jsonb then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  -- Keep the caller's patch for ticket binding. Omitted fields come only from the locked server row.
  -- Explicit null/empty values are invalid replacements, never an instruction to erase/retain data.
  if octet_length(p_payload::text)>4096 or not (p_payload ? 'reason')
    or (p_payload-'reason')='{}'::jsonb
    or exists(select 1 from jsonb_each(p_payload) e where jsonb_typeof(e.value) not in ('string','number') or e.value='null'::jsonb)
    then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  if (p_payload ? 'pix_type') and not (p_payload ? 'pix_key') then raise exception 'PARTNER_INVALID_PIX'; end if;
  select * into strict profile from public.partner_private_profiles where partner_id=p_id for update;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  p_payload:=jsonb_build_object('legal_name',profile.legal_name,'document',profile.document,
    'payee_name',profile.payee_name,'pix_type',profile.pix_type,'pix_key',profile.pix_key,
    'commission_percent',old_pct)||p_payload;
  d:=upper(regexp_replace(coalesce(p_payload->>'document',''),'[. /-]','','g'));
  if not public.partner_document_valid(d) or length(trim(coalesce(p_payload->>'legal_name',''))) not between 2 and 160
    or length(trim(coalesce(p_payload->>'payee_name',''))) not between 2 and 160
    or coalesce(p_payload->>'reason','') not in ('configuracao_inicial','ajuste_contratual','correcao_pagamento')
    or coalesce(p_payload->>'commission_percent','')!~ '^([0-9]{1,3})(\.[0-9]{1,2})?$' then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  pct:=(p_payload->>'commission_percent')::numeric;
  if pct<0 or pct>100 then raise exception 'PARTNER_INVALID_PERCENT'; end if;
  if length(coalesce(p_payload->>'pix_key','')) not between 3 and 254 or
    (case p_payload->>'pix_type'
      when 'cpf' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>11
      when 'cnpj' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>14
      when 'email' then (p_payload->>'pix_key')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      when 'phone' then (p_payload->>'pix_key')!~ '^\+[0-9]{10,15}$'
      when 'random' then (p_payload->>'pix_key')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      else true end) then raise exception 'PARTNER_INVALID_PIX'; end if;
  select first_activated_at is not null into critical from public.partners where id=p_id;
  if critical and p_ticket is null then raise exception 'PARTNER_STEPUP_REQUIRED' using errcode='42501'; end if;
  if critical or p_ticket is not null then
  update public.partner_stepup_tickets set used_at=statement_timestamp()
    where id=p_ticket and actor_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid and partner_id=p_id
      and used_at is null and expires_at>statement_timestamp()
      and payload_hash=encode(sha256(convert_to(requested::text,'UTF8')),'hex');
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501'; end if;
  end if;
  select coalesce(max(version),0)+1 into v from public.partner_commission_rules where partner_id=p_id;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  profile_changed:=row(profile.legal_name,profile.document,profile.pix_type,profile.pix_key,profile.payee_name)
    is distinct from row(trim(p_payload->>'legal_name'),d,p_payload->>'pix_type',trim(p_payload->>'pix_key'),trim(p_payload->>'payee_name'));
  if profile_changed or profile.verified_at is null then
  update public.partner_private_profiles set legal_name=trim(p_payload->>'legal_name'),document=d,
    pix_type=p_payload->>'pix_type',pix_key=trim(p_payload->>'pix_key'),payee_name=trim(p_payload->>'payee_name'),version=version+1,verified_by=auth.uid(),verified_at=statement_timestamp() where partner_id=p_id;
  end if;
  if old_pct is distinct from pct then
  insert into public.partner_commission_rules(partner_id,version,commission_percent,created_by) values(p_id,v,pct,auth.uid());
  else v:=v-1; end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_financial_configured',
    jsonb_build_object('partner_id',p_id,'rule_version',v,'old_percent',old_pct,'new_percent',pct,'document_masked','••••'||right(d,4),'authorization',case when critical then 'critical_stepup' when p_ticket is not null then 'explicit_stepup' else 'operational_login' end,'payment_profile_changed',profile_changed,'reason',p_payload->>'reason'));
  return jsonb_build_object('configured',true,'rule_version',v);
end $$;



-- Approved stage: 20261008202729_partners_p2_test
-- Approved TEST stage promoted to PROD; no commercial changes.

do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://oslefjmwfnddxlotalxu.supabase.co') then raise exception 'PARTNERS_PRODUCTION_ONLY';end if;
end $$;
alter table public.partner_config add column referral_enabled boolean not null default false;
create table public.partner_referral_intents(
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 partner_id uuid not null references public.partners(id) on delete restrict,
 source text not null check(source in ('link','code','manual')),
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default (statement_timestamp()+interval '30 days'),
 superseded_at timestamptz,superseded_reason text check(superseded_reason in ('replaced','cleared')),consumed_at timestamptz,
 check(expires_at=created_at+interval '30 days'),
 check(not(superseded_at is not null and consumed_at is not null))
);
create index partner_intents_partner_idx on public.partner_referral_intents(partner_id,created_at);
create index partner_intents_expiry_idx on public.partner_referral_intents(expires_at) where consumed_at is null and superseded_at is null;
create table public.partner_attributions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references public.profiles(id) on delete set null,
 card_grant_id uuid unique references public.card_pro_grants(id) on delete set null,
 partner_id uuid references public.partners(id) on delete restrict,
 rule_id uuid references public.partner_commission_rules(id) on delete restrict,
 rule_version integer,commission_percent numeric(5,2),
 intent_id uuid unique references public.partner_referral_intents(id) on delete restrict,
 source text not null check(source in ('link','code','manual','none','historical_none')),
 locked_at timestamptz not null default statement_timestamp(),
 check((partner_id is null and rule_id is null and rule_version is null and commission_percent is null and intent_id is null and source in ('none','historical_none')) or
       (partner_id is not null and rule_id is not null and rule_version is not null and commission_percent is not null and commission_percent between 0 and 100 and intent_id is not null and source in ('link','code','manual')))
);
create index partner_attributions_partner_idx on public.partner_attributions(partner_id,locked_at);
create index partner_attributions_rule_idx on public.partner_attributions(rule_id);
create function public.partner_attribution_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'user_id'-'card_grant_id')<>(to_jsonb(old)-'user_id'-'card_grant_id')
    or (new.user_id is distinct from old.user_id and new.user_id is not null)
    or (new.card_grant_id is distinct from old.card_grant_id and new.card_grant_id is not null) then
  raise exception 'PARTNER_ATTRIBUTION_LOCKED';
 end if;
 return new;
end $$;
revoke all on function public.partner_attribution_immutable() from public,anon,authenticated,service_role;
create trigger partner_attribution_lock before update on public.partner_attributions for each row execute function public.partner_attribution_immutable();
create table public.partner_click_events(
 event_id uuid primary key,
 partner_id uuid not null references public.partners(id) on delete restrict,
 source text not null check(source in ('link','code')),
 created_at timestamptz not null default statement_timestamp()
);
create index partner_clicks_partner_idx on public.partner_click_events(partner_id,created_at);
create index partner_clicks_time_idx on public.partner_click_events(created_at);
create table public.partner_click_daily(
 partner_id uuid not null references public.partners(id) on delete restrict,
 day date not null,clicks bigint not null default 0,primary key(partner_id,day)
);
do $$declare t text;begin
 foreach t in array array['partner_referral_intents','partner_attributions','partner_click_events','partner_click_daily'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
-- Existing grants are sealed WITHOUT retroactive partner assignment or new grants.
insert into public.partner_attributions(user_id,card_grant_id,source,locked_at)
select user_id,id,'historical_none',granted_at from public.card_pro_grants;

create function public.partner_referral_action(p_action text,p_ref text default '',p_source text default 'link',p_previous_token text default '',p_confirm_swap boolean default false,p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.partner_referral_intents; candidate public.partners; token text; found_data jsonb; quota jsonb; stamp timestamptz:=statement_timestamp(); added integer;
begin
 if not exists(select 1 from public.partner_config where enabled and referral_enabled) then return jsonb_build_object('enabled',false);end if;
 if p_action not in ('intent','inspect','clear') or p_action is null or length(coalesce(p_ref,''))>100 or p_source is null or p_source not in ('link','code','manual') then raise exception 'REFERRAL_INVALID_REQUEST';end if;
 quota:=public.partner_public_search('','');
 if coalesce((quota->>'limited')::boolean,false) then return jsonb_build_object('enabled',true,'limited',true);end if;
 if coalesce(p_previous_token,'') ~ '^[a-f0-9]{64}$' then
  select * into previous from public.partner_referral_intents where token_hash=encode(sha256(convert_to(p_previous_token,'UTF8')),'hex') for update;
 end if;
 if previous.id is not null and (previous.consumed_at is not null or previous.superseded_at is not null) then return jsonb_build_object('enabled',true,'code','INTENT_UNAVAILABLE');end if;
 if p_action='clear' then
  update public.partner_referral_intents set superseded_at=stamp,superseded_reason='cleared' where id=previous.id and consumed_at is null;
  return jsonb_build_object('enabled',true,'code','CLEARED');
 end if;
 if p_action='inspect' then
  if previous.id is null or previous.expires_at<=stamp then return jsonb_build_object('enabled',true,'code','INTENT_EXPIRED_OR_MISSING');end if;
  select * into candidate from public.partners where id=previous.partner_id and status='active' for share;
 else
  select * into candidate from public.partners where status='active' and
   ((p_source='code' and public_code=upper(p_ref)) or (p_source in ('link','manual') and slug=lower(p_ref))) for share;
 end if;
 if candidate.id is null then return jsonb_build_object('enabled',true,'code','PARTNER_UNAVAILABLE');end if;
 found_data:=jsonb_build_object('public_name',candidate.public_name,'city',candidate.city,'description',candidate.description,'partner_type',candidate.partner_type,'slug',candidate.slug,'public_code',candidate.public_code);
 if p_action='inspect' then return jsonb_build_object('enabled',true,'code','VALID','partner',found_data,'source',previous.source,'expires_at',previous.expires_at);end if;
 if previous.id is not null and previous.expires_at>stamp and previous.source in ('link','code') and p_source='manual' and previous.partner_id<>candidate.id and not coalesce(p_confirm_swap,false) then
  return jsonb_build_object('enabled',true,'code','CONFIRM_SWAP_REQUIRED','partner',found_data);
 end if;
 -- Clicks are directional and deduplicated separately from intents/conversions.
 if p_source in ('link','code') and p_event_id is not null then
  insert into public.partner_click_events(event_id,partner_id,source) values(p_event_id,candidate.id,p_source) on conflict do nothing;
  get diagnostics added=row_count;
  if added=1 then insert into public.partner_click_daily values(candidate.id,(stamp at time zone 'UTC')::date,1) on conflict(partner_id,day) do update set clicks=partner_click_daily.clicks+1;end if;
 end if;
 delete from public.partner_click_events where created_at<stamp-interval '30 days';
 if previous.id is not null and previous.expires_at>stamp and previous.partner_id=candidate.id and previous.source=p_source then
  return jsonb_build_object('enabled',true,'code','VALID','token',p_previous_token,'partner',found_data,'source',previous.source,'expires_at',previous.expires_at);
 end if;
 update public.partner_referral_intents set superseded_at=stamp,superseded_reason='replaced' where id=previous.id and consumed_at is null;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.partner_referral_intents(token_hash,partner_id,source,created_at,expires_at)
 values(encode(sha256(convert_to(token,'UTF8')),'hex'),candidate.id,p_source,stamp,stamp+interval '30 days');
 return jsonb_build_object('enabled',true,'code','CREATED','token',token,'partner',found_data,'source',p_source,'expires_at',stamp+interval '30 days');
end $$;
revoke all on function public.partner_referral_action(text,text,text,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.partner_referral_action(text,text,text,text,boolean,uuid) to service_role;

-- Preserve the existing commercial core verbatim, but close direct invocation.
alter function public.claim_card_acquisition(timestamptz) rename to claim_card_acquisition_core_p2;
revoke all on function public.claim_card_acquisition_core_p2(timestamptz) from public,anon,authenticated,service_role;
create function public.partner_claim_card(p_first_seen_at timestamptz,p_intent_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); intent public.partner_referral_intents; partner public.partners; rule public.partner_commission_rules; grant_row public.card_pro_grants; result jsonb; old_grant uuid; stamp timestamptz:=statement_timestamp();
begin
 if u is null then raise exception 'Autenticação necessária';end if;
 -- Same lock order for every caller, including legacy. Account isolation via auth.uid.
 perform 1 from public.profiles where id=u for update;
 if not found then raise exception 'Conta não inicializada';end if;
 select id into old_grant from public.card_pro_grants where user_id=u;
 if old_grant is null and exists(select 1 from public.partner_config where enabled and referral_enabled)
    and coalesce(p_intent_token,'') ~ '^[a-f0-9]{64}$' then
  select * into intent from public.partner_referral_intents where token_hash=encode(sha256(convert_to(p_intent_token,'UTF8')),'hex') for update;
  if intent.id is not null and intent.consumed_at is null and intent.superseded_at is null and intent.expires_at>clock_timestamp() then
   select * into partner from public.partners where id=intent.partner_id and status='active' for share;
   if partner.id is not null then select * into rule from public.partner_commission_rules where partner_id=partner.id order by version desc limit 1;end if;
  end if;
 end if;
 result:=public.claim_card_acquisition_core_p2(p_first_seen_at);
 select * into grant_row from public.card_pro_grants where user_id=u;
 if grant_row.id is not null and not exists(select 1 from public.partner_attributions where user_id=u) then
  -- Recheck expiry after waiting for legacy locks. No partner = valid benefit with sealed absence.
  if old_grant is null and partner.id is not null and rule.id is not null and intent.expires_at>clock_timestamp() then
   insert into public.partner_attributions(user_id,card_grant_id,partner_id,rule_id,rule_version,commission_percent,intent_id,source,locked_at)
   values(u,grant_row.id,partner.id,rule.id,rule.version,rule.commission_percent,intent.id,intent.source,stamp);
   update public.partner_referral_intents set consumed_at=stamp where id=intent.id;
  else
   insert into public.partner_attributions(user_id,card_grant_id,source,locked_at) values(u,grant_row.id,case when old_grant is null then 'none' else 'historical_none' end,stamp);
  end if;
 end if;
 return result;
end $$;
revoke all on function public.partner_claim_card(timestamptz,text) from public,anon,authenticated,service_role;
create function public.claim_card_acquisition(p_first_seen_at timestamptz default null) returns jsonb
language sql security definer set search_path='' as $$select public.partner_claim_card(p_first_seen_at,null)$$;
create function public.claim_partner_card_acquisition(p_intent_token text default null,p_first_seen_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; attribution public.partner_attributions; partner public.partners;
begin
 result:=public.partner_claim_card(p_first_seen_at,p_intent_token);
 select * into attribution from public.partner_attributions where user_id=auth.uid();
 select * into partner from public.partners where id=attribution.partner_id;
 return result||jsonb_build_object('partner_locked',attribution.id is not null,'partner',case when partner.id is null then null else jsonb_build_object('public_name',partner.public_name,'city',partner.city,'description',partner.description) end);
end $$;
revoke all on function public.claim_card_acquisition(timestamptz),public.claim_partner_card_acquisition(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.claim_card_acquisition(timestamptz),public.claim_partner_card_acquisition(text,timestamptz) to authenticated;

create function public.admin_partner_referral_metrics() returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=statement_timestamp();begin
 perform public.partner_admin_assert(false,false);
 delete from public.partner_click_events where created_at<stamp-interval '30 days';
 return jsonb_build_object('enabled',(select referral_enabled from public.partner_config),'clicks',(select coalesce(sum(clicks),0) from public.partner_click_daily),
 'intents_created',(select count(*) from public.partner_referral_intents),
 'intents_replaced',(select count(*) from public.partner_referral_intents where superseded_reason='replaced'),
 'intents_expired',(select count(*) from public.partner_referral_intents where expires_at<=stamp and consumed_at is null and superseded_at is null),
 'intents_consumed',(select count(*) from public.partner_referral_intents where consumed_at is not null),
 'benefits_with_partner',(select count(*) from public.partner_attributions where partner_id is not null),
 'benefits_without_partner',(select count(*) from public.partner_attributions where source='none'),
 'partners',coalesce((select jsonb_agg(jsonb_build_object('public_name',p.public_name,'slug',p.slug,'activations',coalesce(a.activations,0),'clicks',coalesce(c.clicks,0))) from public.partners p
 left join (select partner_id,count(*) activations from public.partner_attributions where partner_id is not null group by partner_id) a on a.partner_id=p.id
 left join (select partner_id,sum(clicks) clicks from public.partner_click_daily group by partner_id) c on c.partner_id=p.id
 where a.activations>0 or c.clicks>0),'[]'::jsonb));
end $$;
revoke all on function public.admin_partner_referral_metrics() from public,anon,authenticated,service_role;
grant execute on function public.admin_partner_referral_metrics() to authenticated;



-- Approved stage: 20261008210119_partners_p2_privacy
-- Approved TEST stage promoted to PROD; no commercial changes.

do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://oslefjmwfnddxlotalxu.supabase.co') then raise exception 'PARTNERS_PRODUCTION_ONLY';end if;
end $$;
alter function public.export_my_data() rename to export_my_data_core_p2;
revoke all on function public.export_my_data_core_p2() from public,anon,authenticated,service_role;
create function public.export_my_data() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.export_my_data_core_p2();
 return result||jsonb_build_object('partner_attribution',(
  select jsonb_build_object('source',a.source,'locked_at',a.locked_at,'partner',case when p.id is null then null else
   jsonb_build_object('public_name',p.public_name,'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code) end)
  from public.partner_attributions a left join public.partners p on p.id=a.partner_id where a.user_id=auth.uid()
 ));
end $$;
revoke all on function public.export_my_data() from public,anon,authenticated,service_role;
grant execute on function public.export_my_data() to authenticated;



-- Approved stage: 20261008221143_partners_p2_locked_read
-- Approved TEST stage promoted to PROD; no commercial changes.

create function public.get_my_partner_attribution() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'Autenticação necessária' using errcode='42501';end if;
 select jsonb_build_object('partner_locked',true,'partner',case when p.id is null then null
  else jsonb_build_object('public_name',p.public_name,'city',p.city,'description',p.description) end)
 into result from public.partner_attributions a
 left join public.partners p on p.id=a.partner_id where a.user_id=u;
 return coalesce(result,jsonb_build_object('partner_locked',false,'partner',null));
end $$;
revoke all on function public.get_my_partner_attribution() from public,anon,authenticated,service_role;
grant execute on function public.get_my_partner_attribution() to authenticated;
comment on function public.get_my_partner_attribution() is 'Own public attribution only; read-only, no card grant or referral mutation.';


commit;
