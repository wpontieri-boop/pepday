-- P1 TEST only: no benefit attribution, billing, commission or payout mutation.
begin;
do $$begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url'
    and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then
    raise exception 'PARTNERS_TEST_ONLY';
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
  if coalesce(auth.jwt()->>'iss','')<>'https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1' then
    raise exception 'PARTNERS_TEST_ONLY' using errcode='42501';
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
commit;
